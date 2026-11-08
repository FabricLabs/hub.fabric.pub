'use strict';

/**
 * @fileoverview Hub Tor onion service settings, `torrc`, and ControlPort
 * helpers (pure; the process side is `services/tor.js`).
 *
 * Settings (`settings.tor`):
 * - `enable` — serve the Hub as a v3 onion service.
 * - `mode` — `managed` (the Hub runs its own `tor`, the default) or `control`
 *   (an existing Tor via its ControlPort, `ADD_ONION`).
 * - `binary` — `tor` executable for `managed` (default `tor` on PATH).
 * - `controlHost` / `controlPort` / `controlPassword` — for `control`
 *   (cookie auth is read from Tor's PROTOCOLINFO).
 * - `peer` — also expose the Fabric Peer port (default true).
 * - `advertise` — publish the address on `GET /services/tor` (default false;
 *   only an admin sees it otherwise, so the onion stays unlinked from the
 *   clearnet Hub unless the operator chooses).
 *
 * Setup keys (STATE `settings`, written by onboarding / `hub setup`):
 * `TOR_ENABLE`, `TOR_MODE`, `TOR_CONTROL_PORT`, `TOR_ADVERTISE`. `FABRIC_TOR*`
 * env vars win over them.
 */

const TOR_MODES = Object.freeze(['managed', 'control']);
const TOR_SETUP_KEYS = Object.freeze(['TOR_ENABLE', 'TOR_MODE', 'TOR_CONTROL_PORT', 'TOR_ADVERTISE']);
const DEFAULT_CONTROL_PORT = 9051;
/** Onion virtual port for HTTP. */
const ONION_HTTP_PORT = 80;

/** @private */
function parseFlag (value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

/**
 * `9051`, `127.0.0.1:9051`, or `host:port` → `{ host, port }`.
 * @param {*} value
 * @returns {({ host: string, port: number })|null}
 */
function parseControlAddress (value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const m = /^(?:\[?([^\]]+?)\]?:)?(\d{1,5})$/.exec(s);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1] || '127.0.0.1', port };
}

/**
 * Normalized `settings.tor`.
 * @param {Object} [tor]
 * @returns {{ enable: boolean, mode: string, binary: string, controlHost: string, controlPort: number, controlPassword: (string|null), peer: boolean, advertise: boolean }}
 */
function normalizeTorSettings (tor = {}) {
  const src = tor && typeof tor === 'object' ? tor : {};
  const mode = TOR_MODES.includes(String(src.mode || '').toLowerCase()) ? String(src.mode).toLowerCase() : 'managed';
  const control = parseControlAddress(src.controlPort);
  const hostInPort = !!control && String(src.controlPort).includes(':');
  return {
    enable: parseFlag(src.enable, false),
    mode,
    binary: String(src.binary || 'tor'),
    controlHost: String((hostInPort && control.host) || src.controlHost || '127.0.0.1'),
    controlPort: control ? control.port : DEFAULT_CONTROL_PORT,
    controlPassword: src.controlPassword ? String(src.controlPassword) : null,
    peer: parseFlag(src.peer, true),
    advertise: parseFlag(src.advertise, false)
  };
}

/**
 * `settings.tor` from `FABRIC_TOR*` env vars (only the ones that are set).
 * @param {Object} [env]
 * @returns {Object}
 */
function torSettingsFromEnv (env = process.env) {
  const out = {};
  if (env.FABRIC_TOR != null && env.FABRIC_TOR !== '') out.enable = parseFlag(env.FABRIC_TOR, false);
  if (env.FABRIC_TOR_MODE) out.mode = env.FABRIC_TOR_MODE;
  if (env.FABRIC_TOR_BIN) out.binary = env.FABRIC_TOR_BIN;
  if (env.FABRIC_TOR_CONTROL_PORT) out.controlPort = env.FABRIC_TOR_CONTROL_PORT;
  if (env.FABRIC_TOR_CONTROL_PASSWORD) out.controlPassword = env.FABRIC_TOR_CONTROL_PASSWORD;
  if (env.FABRIC_TOR_PEER != null && env.FABRIC_TOR_PEER !== '') out.peer = parseFlag(env.FABRIC_TOR_PEER, true);
  if (env.FABRIC_TOR_ADVERTISE != null && env.FABRIC_TOR_ADVERTISE !== '') out.advertise = parseFlag(env.FABRIC_TOR_ADVERTISE, false);
  return out;
}

/**
 * Overlay setup keys (`TOR_*`) on `settings.tor`; env vars still win.
 * @param {Object} hubSettings Hub settings (not mutated)
 * @param {Object} setup STATE `settings` map
 * @param {Object} [env]
 * @returns {Object} new `settings.tor`
 */
function applyTorSetup (hubSettings, setup, env = process.env) {
  const base = Object.assign({}, (hubSettings && hubSettings.tor) || {});
  const src = setup && typeof setup === 'object' ? setup : {};
  if (src.TOR_ENABLE !== undefined) base.enable = parseFlag(src.TOR_ENABLE, false);
  if (src.TOR_MODE) base.mode = src.TOR_MODE;
  if (src.TOR_CONTROL_PORT) base.controlPort = src.TOR_CONTROL_PORT;
  if (src.TOR_ADVERTISE !== undefined) base.advertise = parseFlag(src.TOR_ADVERTISE, false);
  return normalizeTorSettings(Object.assign(base, torSettingsFromEnv(env)));
}

/**
 * Setup keys from an onboarding / `hub setup` body.
 * @param {Object} [body]
 * @returns {Object} `TOR_*` keys
 */
function torSetupFromBody (body) {
  const src = body && typeof body === 'object' ? body : {};
  const enable = parseFlag(src.TOR_ENABLE ?? src.torEnable, false);
  const out = { TOR_ENABLE: enable };
  if (!enable) return out;
  const tor = normalizeTorSettings({
    mode: src.TOR_MODE ?? src.torMode,
    controlPort: src.TOR_CONTROL_PORT ?? src.torControlPort
  });
  out.TOR_MODE = tor.mode;
  if (tor.mode === 'control') out.TOR_CONTROL_PORT = `${tor.controlHost}:${tor.controlPort}`;
  out.TOR_ADVERTISE = parseFlag(src.TOR_ADVERTISE ?? src.torAdvertise, false);
  return out;
}

/**
 * Where Tor should reach the Fabric Peer: loopback when it listens on every interface.
 * @param {string} [iface]
 * @returns {string}
 */
function peerTargetHost (iface) {
  const s = String(iface || '').trim();
  if (!s || s === '0.0.0.0' || s === '::' || s === '[::]') return '127.0.0.1';
  return s;
}

/**
 * Onion virtual ports → local targets.
 * @param {Object} opts
 * @param {number} opts.ingressPort Hub's Tor-only HTTP listener (127.0.0.1)
 * @param {(number|null)} [opts.peerPort] Fabric Peer port, or null to skip
 * @param {string} [opts.peerInterface]
 * @returns {Array<{ virtualPort: number, target: string }>}
 */
function onionPorts (opts) {
  const ports = [{ virtualPort: ONION_HTTP_PORT, target: `127.0.0.1:${opts.ingressPort}` }];
  const peerPort = Number(opts.peerPort);
  if (Number.isInteger(peerPort) && peerPort > 0 && peerPort !== ONION_HTTP_PORT) {
    ports.push({ virtualPort: peerPort, target: `${peerTargetHost(opts.peerInterface)}:${peerPort}` });
  }
  return ports;
}

/** @private torrc values with spaces must be quoted. */
function torrcPath (p) {
  const s = String(p);
  return /[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s;
}

/**
 * `torrc` for a Hub-managed Tor: no SOCKS or control port, one onion service,
 * and Tor exits when the Hub process does (`__OwningControllerProcess`).
 * @param {Object} opts
 * @param {string} opts.dataDirectory
 * @param {string} opts.hiddenServiceDir
 * @param {Array<{ virtualPort: number, target: string }>} opts.ports
 * @param {number} [opts.ownerPid]
 * @returns {string}
 */
function buildTorrc (opts) {
  const lines = [
    '# Written by @fabric/hub on every start; edits are overwritten.',
    `DataDirectory ${torrcPath(opts.dataDirectory)}`,
    'SocksPort 0',
    'ControlPort 0',
    'Log notice stdout',
    `HiddenServiceDir ${torrcPath(opts.hiddenServiceDir)}`,
    'HiddenServiceVersion 3'
  ];
  for (const p of opts.ports) lines.push(`HiddenServicePort ${p.virtualPort} ${p.target}`);
  if (opts.ownerPid) lines.push(`__OwningControllerProcess ${opts.ownerPid}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Bootstrap percentage from a Tor log line, or null.
 * @param {string} line
 * @returns {(number|null)}
 */
function bootstrapPercent (line) {
  const m = /Bootstrapped (\d{1,3})%/.exec(String(line || ''));
  return m ? Math.min(100, Number(m[1])) : null;
}

/**
 * Split a ControlPort byte stream into complete replies.
 * Each reply is `{ code, lines }`; `rest` is the unfinished tail.
 * @param {string} buffer
 * @returns {{ replies: Array<{ code: number, lines: string[] }>, rest: string }}
 */
function parseControlReplies (buffer) {
  const text = String(buffer || '');
  const replies = [];
  let lines = [];
  let replyStart = 0;
  let pos = 0;
  let inData = false;
  for (;;) {
    const nl = text.indexOf('\r\n', pos);
    if (nl < 0) break;
    const line = text.slice(pos, nl);
    pos = nl + 2;
    if (inData) {
      if (line === '.') inData = false;
      else lines.push(line.startsWith('..') ? line.slice(1) : line);
      continue;
    }
    const m = /^(\d{3})([- +])(.*)$/.exec(line);
    if (!m) continue;
    lines.push(m[3]);
    if (m[2] === '+') inData = true;
    else if (m[2] === ' ') {
      replies.push({ code: Number(m[1]), lines });
      lines = [];
      replyStart = pos;
    }
  }
  return { replies, rest: text.slice(replyStart) };
}

/**
 * Auth methods and cookie file from a PROTOCOLINFO reply.
 * @param {string[]} lines
 * @returns {{ methods: string[], cookieFile: (string|null) }}
 */
function parseProtocolInfo (lines) {
  const auth = (lines || []).find((l) => /^AUTH /.test(l)) || '';
  const methods = (/METHODS=([A-Z,]+)/.exec(auth) || [])[1];
  const cookie = /COOKIEFILE="((?:[^"\\]|\\.)*)"/.exec(auth);
  return {
    methods: methods ? methods.split(',') : [],
    cookieFile: cookie ? cookie[1].replace(/\\(.)/g, '$1') : null
  };
}

/**
 * Quote a ControlPort string argument.
 * @param {string} value
 * @returns {string}
 */
function controlQuote (value) {
  return `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
}

module.exports = {
  DEFAULT_CONTROL_PORT,
  ONION_HTTP_PORT,
  TOR_MODES,
  TOR_SETUP_KEYS,
  applyTorSetup,
  bootstrapPercent,
  buildTorrc,
  controlQuote,
  normalizeTorSettings,
  onionPorts,
  parseControlAddress,
  parseControlReplies,
  parseProtocolInfo,
  peerTargetHost,
  torSettingsFromEnv,
  torSetupFromBody
};
