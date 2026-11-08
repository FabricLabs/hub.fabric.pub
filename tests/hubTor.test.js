'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const {
  addOnionKeyBlob,
  generateOnionKey,
  isOnionAddress,
  loadOrCreateOnionKey,
  onionAddressFromPublicKey,
  readHiddenServiceDir
} = require('../functions/torOnionKey');
const {
  applyTorSetup,
  bootstrapPercent,
  buildTorrc,
  normalizeTorSettings,
  onionPorts,
  parseControlReplies,
  parseProtocolInfo,
  torSettingsFromEnv,
  torSetupFromBody
} = require('../functions/hubTor');
const HubTor = require('../services/tor');

function base32Decode (text) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

describe('Tor onion keys', function () {
  let tmp;

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tor-key-'));
  });

  afterEach(function () {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('derives a published onion address from its public key', function () {
    const published = 'duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion';
    const publicKey = base32Decode(published.slice(0, 56)).subarray(0, 32);
    assert.strictEqual(onionAddressFromPublicKey(publicKey), published);
  });

  it('generates keys in Tor\'s expanded form', function () {
    const key = generateOnionKey();
    assert.strictEqual(key.secretKey.length, 64);
    assert.strictEqual(key.publicKey.length, 32);
    assert.strictEqual(key.secretKey[0] & 7, 0);
    assert.strictEqual(key.secretKey[31] & 0xc0, 0x40);
    assert.ok(isOnionAddress(key.address));
    assert.strictEqual(key.address, onionAddressFromPublicKey(key.publicKey));
    assert.ok(addOnionKeyBlob(key.secretKey).startsWith('ED25519-V3:'));
  });

  it('keeps one key per HiddenServiceDir, in Tor\'s file format', function () {
    const dir = path.join(tmp, 'hidden_service');
    const first = loadOrCreateOnionKey(dir);
    const again = loadOrCreateOnionKey(dir);
    assert.strictEqual(first.created, true);
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.address, first.address);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'hostname'), 'utf8'), `${first.address}\n`);
    const secret = fs.readFileSync(path.join(dir, 'hs_ed25519_secret_key'));
    assert.strictEqual(secret.subarray(0, 29).toString('ascii'), '== ed25519v1-secret: type0 ==');
    assert.strictEqual(secret.length, 96);
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
      assert.strictEqual(fs.statSync(path.join(dir, 'hs_ed25519_secret_key')).mode & 0o777, 0o600);
    }
    assert.strictEqual(readHiddenServiceDir(path.join(tmp, 'none')), null);
  });
});

describe('Tor settings', function () {
  it('reads FABRIC_TOR* env', function () {
    assert.deepStrictEqual(torSettingsFromEnv({}), {});
    assert.deepStrictEqual(torSettingsFromEnv({ FABRIC_TOR: '1', FABRIC_TOR_MODE: 'control', FABRIC_TOR_CONTROL_PORT: '9151', FABRIC_TOR_ADVERTISE: 'yes' }), {
      enable: true, mode: 'control', controlPort: '9151', advertise: true
    });
  });

  it('normalizes control addresses, keeping a host given with the port', function () {
    const plain = normalizeTorSettings({});
    assert.strictEqual(plain.enable, false);
    assert.strictEqual(plain.mode, 'managed');
    assert.strictEqual(plain.controlHost, '127.0.0.1');
    assert.strictEqual(plain.controlPort, 9051);
    assert.strictEqual(plain.peer, true);
    assert.strictEqual(plain.advertise, false);
    const remote = normalizeTorSettings({ controlHost: '127.0.0.1', controlPort: '10.0.0.5:9151' });
    assert.strictEqual(remote.controlHost, '10.0.0.5');
    assert.strictEqual(remote.controlPort, 9151);
    const portOnly = normalizeTorSettings({ controlHost: '10.0.0.5', controlPort: 9151 });
    assert.strictEqual(portOnly.controlHost, '10.0.0.5');
    assert.strictEqual(normalizeTorSettings({ mode: 'bogus' }).mode, 'managed');
  });

  it('overlays setup keys, with env winning', function () {
    const settings = { tor: normalizeTorSettings({}) };
    const setup = { TOR_ENABLE: 'true', TOR_MODE: 'control', TOR_CONTROL_PORT: '127.0.0.1:9151', TOR_ADVERTISE: 'false' };
    const tor = applyTorSetup(settings, setup, {});
    assert.strictEqual(tor.enable, true);
    assert.strictEqual(tor.mode, 'control');
    assert.strictEqual(tor.controlPort, 9151);
    assert.strictEqual(applyTorSetup(settings, setup, { FABRIC_TOR: '0' }).enable, false);
    assert.strictEqual(applyTorSetup(settings, setup, { FABRIC_TOR_MODE: 'managed' }).mode, 'managed');
    assert.strictEqual(settings.tor.enable, false);
  });

  it('turns an onboarding body into TOR_* keys', function () {
    assert.deepStrictEqual(torSetupFromBody({}), { TOR_ENABLE: false });
    assert.deepStrictEqual(torSetupFromBody({ TOR_ENABLE: true }), { TOR_ENABLE: true, TOR_MODE: 'managed', TOR_ADVERTISE: false });
    assert.deepStrictEqual(torSetupFromBody({ TOR_ENABLE: 'true', TOR_MODE: 'control', TOR_CONTROL_PORT: '9151', TOR_ADVERTISE: true }), {
      TOR_ENABLE: true, TOR_MODE: 'control', TOR_CONTROL_PORT: '127.0.0.1:9151', TOR_ADVERTISE: true
    });
  });

  it('writes a torrc with no SOCKS or control port', function () {
    const ports = onionPorts({ ingressPort: 40001, peerPort: 7777, peerInterface: '0.0.0.0' });
    assert.deepStrictEqual(ports, [
      { virtualPort: 80, target: '127.0.0.1:40001' },
      { virtualPort: 7777, target: '127.0.0.1:7777' }
    ]);
    assert.deepStrictEqual(onionPorts({ ingressPort: 40001, peerPort: null }), [{ virtualPort: 80, target: '127.0.0.1:40001' }]);
    const torrc = buildTorrc({ dataDirectory: '/x/data', hiddenServiceDir: '/x/hs', ports, ownerPid: 42 });
    assert.match(torrc, /^SocksPort 0$/m);
    assert.match(torrc, /^ControlPort 0$/m);
    assert.match(torrc, /^DataDirectory \/x\/data$/m);
    assert.match(torrc, /^HiddenServiceDir \/x\/hs$/m);
    assert.match(torrc, /^HiddenServicePort 80 127\.0\.0\.1:40001$/m);
    assert.match(torrc, /^HiddenServicePort 7777 127\.0\.0\.1:7777$/m);
    assert.match(torrc, /^__OwningControllerProcess 42$/m);
  });

  it('parses bootstrap lines and control replies', function () {
    assert.strictEqual(bootstrapPercent('Nov 06 [notice] Bootstrapped 45% (requesting_descriptors): Asking'), 45);
    assert.strictEqual(bootstrapPercent('Nov 06 [notice] Opening Socks listener'), null);

    const text = '250-PROTOCOLINFO 1\r\n250-AUTH METHODS=COOKIE,SAFECOOKIE COOKIEFILE="/var/run/tor/control.authcookie"\r\n250-VERSION Tor="0.4.9"\r\n250 OK\r\n' +
      '250+onions/current=\r\nabc\r\n.\r\n250 OK\r\n650 STATUS_CLIENT NOTICE\r\n250-Service';
    const { replies, rest } = parseControlReplies(text);
    assert.strictEqual(replies.length, 3);
    assert.strictEqual(replies[0].code, 250);
    assert.deepStrictEqual(parseProtocolInfo(replies[0].lines), { methods: ['COOKIE', 'SAFECOOKIE'], cookieFile: '/var/run/tor/control.authcookie' });
    assert.strictEqual(replies[2].code, 650);
    assert.strictEqual(rest, '250-Service');
    assert.strictEqual(parseControlReplies(rest + 'ID=abc\r\n250 OK\r\n').replies[0].lines[0], 'ServiceID=abc');
  });
});

describe('HubTor', function () {
  let tmp;
  let httpServer;

  beforeEach(function () {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tor-svc-'));
    httpServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remoteAddress: req.socket.remoteAddress || null, transport: req.socket.fabricTransport || null }));
    });
  });

  afterEach(function () {
    httpServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('hands Tor connections to the Hub with no remote address', async function () {
    const tor = new HubTor({ settings: { enable: true }, dir: tmp, httpServer: () => httpServer });
    const port = await tor._listenIngress();
    try {
      const body = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      assert.deepStrictEqual(body, { remoteAddress: null, transport: 'tor' });
    } finally {
      await tor.stop();
    }
  });

  it('adds and removes the onion service over a ControlPort', async function () {
    const commands = [];
    let serviceId = null;
    const control = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let at;
        while ((at = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          commands.push(line);
          if (line.startsWith('PROTOCOLINFO')) socket.write('250-PROTOCOLINFO 1\r\n250-AUTH METHODS=NULL\r\n250 OK\r\n');
          else if (line === 'AUTHENTICATE') socket.write('250 OK\r\n');
          else if (line.startsWith('ADD_ONION')) socket.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
          else if (line.startsWith('GETINFO')) socket.write('250-status/bootstrap-phase=NOTICE BOOTSTRAP PROGRESS=100 TAG=done\r\n250 OK\r\n');
          else if (line.startsWith('DEL_ONION')) socket.write('250 OK\r\n');
          else if (line === 'QUIT') socket.end('250 closing connection\r\n');
        }
      });
    });
    await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
    const key = loadOrCreateOnionKey(path.join(tmp, 'hidden_service'));
    serviceId = key.address.replace(/\.onion$/, '');
    const tor = new HubTor({
      settings: { enable: true, mode: 'control', controlPort: `127.0.0.1:${control.address().port}` },
      dir: tmp,
      httpServer: () => httpServer,
      peer: { port: 7777, interface: '0.0.0.0' }
    });
    try {
      await tor.start();
      const status = tor.status();
      assert.strictEqual(status.state, 'running', status.error);
      assert.strictEqual(status.address, key.address);
      assert.deepStrictEqual(status.ports, [80, 7777]);
      const add = commands.find((c) => c.startsWith('ADD_ONION'));
      assert.ok(add.includes(addOnionKeyBlob(key.secretKey)));
      assert.ok(add.includes('Flags=DiscardPK'));
      assert.match(add, /Port=80,127\.0\.0\.1:\d+ Port=7777,127\.0\.0\.1:7777$/);
      await tor.stop();
      assert.ok(commands.includes(`DEL_ONION ${serviceId}`));
      assert.strictEqual(tor.status().state, 'stopped');
    } finally {
      await tor.stop();
      control.close();
    }
  });

  it('reports a missing tor binary', async function () {
    const tor = new HubTor({ settings: { enable: true, binary: path.join(tmp, 'no-such-tor') }, dir: tmp, httpServer: () => httpServer });
    const failed = new Promise((resolve) => tor.on('warning', resolve));
    await tor.start();
    const message = await failed;
    assert.match(message, /Tor is not installed/);
    assert.strictEqual(tor.status().state, 'error');
    await tor.stop();
  });
});
