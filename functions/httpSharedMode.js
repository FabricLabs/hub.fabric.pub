'use strict';

/**
 * HTTP shared-mode helpers — prefer `@fabric/http`, keep local fallbacks so Hub
 * can gate shared-mode WebSocket tokens even when the linked http pin is older.
 */

function applySharedModeWebsocketGateLocal (settings = {}, opts = {}) {
  if (!opts.bindAll) return settings;
  const env = opts.env || process.env;
  const ws = Object.assign({}, settings.websocket || {});
  const explicitOff = ws.requireClientToken === false ||
    ws.requireClientToken === 0 ||
    ws.requireClientToken === '0';
  if (explicitOff) return settings;
  // Fail closed at the handshake: require a token, but do not abort Hub
  // start when FABRIC_WS_CLIENT_TOKEN / websocket.clientToken is empty.
  ws.requireClientToken = true;
  const envTok = String(env.FABRIC_WS_CLIENT_TOKEN || '').trim();
  if (envTok && !ws.clientToken) ws.clientToken = envTok;
  return Object.assign({}, settings, { websocket: ws });
}

const DEFAULT_HTTP_LISTEN_ENV_KEYS = Object.freeze([
  'FABRIC_HUB_INTERFACE',
  'INTERFACE',
  'FABRIC_HTTP_INTERFACE'
]);

function isHttpSharedModeEnabledLocal (raw) {
  if (raw === undefined || raw === null) return false;
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

function resolveHttpListenHostLocal (opts = {}) {
  const env = opts.env || process.env;
  if (opts.envHost != null) {
    const forced = String(opts.envHost).trim();
    if (forced) return forced;
  }
  const explicit = String(opts.host || '').trim();
  if (explicit) return explicit;
  const keys = Array.isArray(opts.envHostKeys) && opts.envHostKeys.length
    ? opts.envHostKeys
    : DEFAULT_HTTP_LISTEN_ENV_KEYS;
  for (const key of keys) {
    const v = String(env[key] || '').trim();
    if (v) return v;
  }
  if (String(opts.mode || '') === 'server') return '0.0.0.0';
  if (isHttpSharedModeEnabledLocal(opts.httpSharedMode)) return '0.0.0.0';
  return '127.0.0.1';
}

try {
  const httpMod = require('@fabric/http/functions/httpSharedMode');
  module.exports = {
    DEFAULT_HTTP_LISTEN_ENV_KEYS: Array.isArray(httpMod.DEFAULT_HTTP_LISTEN_ENV_KEYS)
      ? httpMod.DEFAULT_HTTP_LISTEN_ENV_KEYS
      : DEFAULT_HTTP_LISTEN_ENV_KEYS,
    isHttpSharedModeEnabled: typeof httpMod.isHttpSharedModeEnabled === 'function'
      ? httpMod.isHttpSharedModeEnabled
      : isHttpSharedModeEnabledLocal,
    resolveHttpListenHost: typeof httpMod.resolveHttpListenHost === 'function'
      ? httpMod.resolveHttpListenHost
      : resolveHttpListenHostLocal,
    applySharedModeWebsocketGate: typeof httpMod.applySharedModeWebsocketGate === 'function'
      ? httpMod.applySharedModeWebsocketGate
      : applySharedModeWebsocketGateLocal
  };
} catch (_) {
  module.exports = {
    DEFAULT_HTTP_LISTEN_ENV_KEYS,
    isHttpSharedModeEnabled: isHttpSharedModeEnabledLocal,
    resolveHttpListenHost: resolveHttpListenHostLocal,
    applySharedModeWebsocketGate: applySharedModeWebsocketGateLocal
  };
}
