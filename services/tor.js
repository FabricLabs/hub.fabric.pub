'use strict';

/**
 * @fileoverview Serve the Hub as a Tor v3 onion service.
 *
 * Onion visitors must never count as local. Tor connects from 127.0.0.1, and
 * the Hub (and `@fabric/http`) grant direct loopback requests local
 * privileges, so Tor is never pointed at the public HTTP port. It gets its own
 * listener on 127.0.0.1 instead, whose sockets are handed to the Hub's HTTP
 * server with no remote address (like a Unix socket): every loopback check
 * fails, rate limits share one `unknown` bucket, and `socket.fabricTransport`
 * is `'tor'`. The Fabric Peer port is forwarded as is; the Peer grants
 * loopback nothing.
 *
 * `managed` runs a private `tor` (own DataDirectory, no SOCKS or control
 * port, exits with the Hub). `control` adds the service to a running Tor over
 * its ControlPort for as long as the connection stays open. Either way the key
 * is the Hub's own (`<store>/tor/hidden_service`, Tor's format), so the
 * address is known before Tor starts and survives restarts and mode changes.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const {
  bootstrapPercent,
  buildTorrc,
  controlQuote,
  normalizeTorSettings,
  onionPorts,
  parseControlReplies,
  parseProtocolInfo
} = require('../functions/hubTor');
const { addOnionKeyBlob, loadOrCreateOnionKey } = require('../functions/torOnionKey');

const RESTART_MIN_MS = 5000;
const RESTART_MAX_MS = 5 * 60 * 1000;
const CONTROL_TIMEOUT_MS = 15000;

class HubTor extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {Object} opts.settings `settings.tor`
   * @param {string} opts.dir Writable directory for keys and Tor state.
   * @param {function(): ?Object} opts.httpServer Current Node `http.Server` (it changes on rebind).
   * @param {?{ port: number, interface: string }} [opts.peer] Fabric Peer listener.
   */
  constructor (opts = {}) {
    super();
    this.settings = normalizeTorSettings(opts.settings);
    this.dir = path.resolve(opts.dir);
    this._httpServer = opts.httpServer;
    this._peer = opts.peer || null;
    this._state = { state: 'stopped', address: null, bootstrap: 0, error: null };
    this._ingress = null;
    this._ingressSockets = new Set();
    this._child = null;
    this._control = null;
    this._stopping = false;
    this._restartMs = RESTART_MIN_MS;
    this._restartTimer = null;
  }

  get address () {
    return this._state.address;
  }

  /**
   * @returns {{ enabled: boolean, mode: string, state: string, address: (string|null), origin: (string|null), bootstrap: number, error: (string|null), ports: number[], advertise: boolean }}
   */
  status () {
    const address = this._state.address;
    return {
      enabled: this.settings.enable,
      mode: this.settings.mode,
      state: this._state.state,
      address,
      origin: address ? `http://${address}` : null,
      bootstrap: this._state.bootstrap,
      error: this._state.error,
      ports: (this._ports || []).map((p) => p.virtualPort),
      advertise: this.settings.advertise
    };
  }

  async start () {
    if (!this.settings.enable) return this;
    if (this._state.state === 'starting' || this._state.state === 'running') return this;
    this._stopping = false;
    this._set({ state: 'starting', error: null, bootstrap: 0 });
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const key = loadOrCreateOnionKey(path.join(this.dir, 'hidden_service'));
      this._key = key;
      this._set({ address: key.address });
      if (key.created) this.emit('log', `New onion address ${key.address}`);
      const ingressPort = await this._listenIngress();
      this._ports = onionPorts({
        ingressPort,
        peerPort: this.settings.peer && this._peer ? this._peer.port : null,
        peerInterface: this._peer && this._peer.interface
      });
      if (this.settings.mode === 'control') await this._startControl();
      else this._startManaged();
    } catch (err) {
      this._fail(err);
    }
    return this;
  }

  async stop () {
    this._stopping = true;
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._restartTimer = null;
    const child = this._child;
    this._child = null;
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 5000);
        child.once('exit', () => { clearTimeout(kill); resolve(); });
        try { child.kill('SIGTERM'); } catch (_) { resolve(); }
      });
    }
    if (this._control) {
      const control = this._control;
      this._control = null;
      try {
        if (this._serviceId) await control.command(`DEL_ONION ${this._serviceId}`);
      } catch (_) {}
      control.close();
    }
    if (this._ingress) {
      const ingress = this._ingress;
      this._ingress = null;
      const closed = new Promise((resolve) => ingress.close(() => resolve()));
      for (const socket of this._ingressSockets) socket.destroy();
      this._ingressSockets.clear();
      await closed;
    }
    this._set({ state: 'stopped', bootstrap: 0 });
    return this;
  }

  /** @private */
  _set (patch) {
    Object.assign(this._state, patch);
    this.emit('status', this.status());
  }

  /** @private */
  _fail (err) {
    const message = err && err.message ? err.message : String(err);
    this._set({ state: 'error', error: message });
    this.emit('warning', message);
  }

  /** @private Tor-only HTTP listener; see the file overview. */
  _listenIngress () {
    if (this._ingress) return Promise.resolve(this._ingress.address().port);
    const server = net.createServer((socket) => {
      const http = this._httpServer && this._httpServer();
      if (!http) {
        socket.destroy();
        return;
      }
      for (const field of ['remoteAddress', 'remotePort', 'remoteFamily']) {
        Object.defineProperty(socket, field, { value: undefined, configurable: true });
      }
      socket.fabricTransport = 'tor';
      this._ingressSockets.add(socket);
      socket.once('close', () => this._ingressSockets.delete(socket));
      http.emit('connection', socket);
    });
    this._ingress = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve(server.address().port);
      });
    });
  }

  /** @private */
  _startManaged () {
    const dataDirectory = path.join(this.dir, 'data');
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const torrc = path.join(this.dir, 'torrc');
    const defaults = path.join(this.dir, 'torrc-defaults');
    fs.writeFileSync(torrc, buildTorrc({
      dataDirectory,
      hiddenServiceDir: path.join(this.dir, 'hidden_service'),
      ports: this._ports,
      ownerPid: process.pid
    }), { mode: 0o600 });
    if (!fs.existsSync(defaults)) fs.writeFileSync(defaults, '', { mode: 0o600 });

    const child = spawn(this.settings.binary, ['-f', torrc, '--defaults-torrc', defaults], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this._child = child;
    let tail = '';
    const onOutput = (chunk) => {
      tail += chunk.toString('utf8');
      const lines = tail.split('\n');
      tail = lines.pop();
      for (const line of lines) this._onTorLine(line);
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', (err) => {
      if (this._child !== child) return;
      this._child = null;
      if (err && err.code === 'ENOENT') {
        this._fail(new Error(`Tor is not installed (no "${this.settings.binary}" on PATH). Install it (brew install tor, apt install tor) or set FABRIC_TOR_BIN.`));
        return;
      }
      this._fail(err);
      this._scheduleRestart();
    });
    child.once('exit', (code, signal) => {
      if (this._child !== child) return;
      this._child = null;
      if (this._stopping) return;
      this._fail(new Error(`tor exited (${signal || `code ${code}`})${this._lastTorError ? `: ${this._lastTorError}` : ''}`));
      this._scheduleRestart();
    });
  }

  /** @private */
  _onTorLine (line) {
    const percent = bootstrapPercent(line);
    if (percent !== null) {
      const wasRunning = this._state.state === 'running';
      this._set({ bootstrap: percent, state: percent >= 100 ? 'running' : this._state.state, error: null });
      if (percent >= 100 && !wasRunning) {
        this._restartMs = RESTART_MIN_MS;
        this.emit('ready', this.status());
      }
      return;
    }
    if (/\[(err|warn)\]/.test(line)) {
      this._lastTorError = line.replace(/^.*?\[(err|warn)\]\s*/, '');
      this.emit('warning', `tor: ${this._lastTorError}`);
    }
  }

  /** @private */
  _scheduleRestart () {
    if (this._stopping || this._restartTimer) return;
    const wait = this._restartMs;
    this._restartMs = Math.min(RESTART_MAX_MS, this._restartMs * 2);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._stopping) return;
      this._set({ state: 'starting', bootstrap: 0 });
      try {
        this._startManaged();
      } catch (err) {
        this._fail(err);
        this._scheduleRestart();
      }
    }, wait);
    if (typeof this._restartTimer.unref === 'function') this._restartTimer.unref();
  }

  /** @private */
  async _startControl () {
    const control = await TorControl.connect(this.settings.controlHost, this.settings.controlPort);
    this._control = control;
    control.once('close', () => {
      if (this._control !== control) return;
      this._control = null;
      this._serviceId = null;
      if (!this._stopping) this._fail(new Error('Tor control connection closed; the onion service is gone until the Hub restarts'));
    });
    await control.authenticate(this.settings.controlPassword);
    const ports = this._ports.map((p) => `Port=${p.virtualPort},${p.target}`).join(' ');
    const reply = await control.command(`ADD_ONION ${addOnionKeyBlob(this._key.secretKey)} Flags=DiscardPK ${ports}`);
    const id = (reply.lines.find((l) => /^ServiceID=/.test(l)) || '').slice('ServiceID='.length);
    if (`${id}.onion` !== this._key.address) {
      throw new Error(`Tor reported ${id}.onion, expected ${this._key.address}`);
    }
    this._serviceId = id;
    let bootstrap = 100;
    try {
      const info = await control.command('GETINFO status/bootstrap-phase');
      const m = /PROGRESS=(\d+)/.exec(info.lines.join(' '));
      if (m) bootstrap = Number(m[1]);
    } catch (_) {}
    this._set({ state: 'running', bootstrap, error: null });
    this.emit('ready', this.status());
  }
}

/**
 * Minimal Tor ControlPort client: one command at a time, async events ignored.
 * @private
 */
class TorControl extends EventEmitter {
  static connect (host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Tor ControlPort ${host}:${port} did not answer`));
      }, CONTROL_TIMEOUT_MS);
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Cannot reach Tor ControlPort ${host}:${port} (${err.code || err.message}). Enable ControlPort in torrc or use managed mode.`));
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        resolve(new TorControl(socket));
      });
    });
  }

  constructor (socket) {
    super();
    this.socket = socket;
    this._buffer = '';
    this._pending = [];
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => {});
    socket.on('close', () => {
      for (const p of this._pending.splice(0)) p.reject(new Error('Tor control connection closed'));
      this.emit('close');
    });
  }

  _onData (chunk) {
    const { replies, rest } = parseControlReplies(this._buffer + chunk);
    this._buffer = rest;
    for (const reply of replies) {
      if (reply.code >= 600) continue;
      const p = this._pending.shift();
      if (!p) continue;
      clearTimeout(p.timer);
      if (reply.code >= 200 && reply.code < 300) p.resolve(reply);
      else p.reject(new Error(`Tor refused: ${reply.code} ${reply.lines.join(' ')}`));
    }
  }

  command (line) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Tor did not answer ${line.split(' ')[0]}`)), CONTROL_TIMEOUT_MS);
      this._pending.push({ resolve, reject, timer });
      this.socket.write(`${line}\r\n`);
    });
  }

  async authenticate (password) {
    const info = parseProtocolInfo((await this.command('PROTOCOLINFO 1')).lines);
    if (info.methods.includes('NULL')) return this.command('AUTHENTICATE');
    if (password && info.methods.includes('HASHEDPASSWORD')) return this.command(`AUTHENTICATE ${controlQuote(password)}`);
    if (info.methods.includes('COOKIE') && info.cookieFile) {
      let cookie;
      try {
        cookie = fs.readFileSync(info.cookieFile);
      } catch (err) {
        throw new Error(`Cannot read Tor's control cookie ${info.cookieFile} (${err.code || err.message}); add this user to Tor's group or set FABRIC_TOR_CONTROL_PASSWORD`);
      }
      return this.command(`AUTHENTICATE ${cookie.toString('hex')}`);
    }
    throw new Error(`No usable Tor control auth (offered: ${info.methods.join(', ') || 'none'}); set FABRIC_TOR_CONTROL_PASSWORD`);
  }

  close () {
    try { this.socket.end('QUIT\r\n'); } catch (_) {}
    setTimeout(() => { try { this.socket.destroy(); } catch (_) {} }, 1000).unref();
  }
}

HubTor.TorControl = TorControl;

module.exports = HubTor;
