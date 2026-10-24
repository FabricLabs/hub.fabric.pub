'use strict';

/**
 * @fileoverview Which HTTP requests the Hub may treat as "local" (loopback privileges such as
 * `GET /sessions` or JSON-RPC `filePath` ingest), plus the DNS-rebinding guard and the CSP.
 *
 * A loopback socket alone is not enough: a page on `evil.example` can rebind its name to
 * 127.0.0.1, and a reverse proxy (Caddy) on the same host also connects from loopback. A
 * request is local only when the socket is loopback, no proxy forward headers are present,
 * and the `Host` header is something DNS cannot point at us on an attacker's behalf.
 */

const net = require('net');

/** @private */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * @param {string} address
 * @returns {boolean}
 */
function isLoopbackAddress (address) {
  return LOOPBACK_ADDRESSES.has(String(address || ''));
}

/** @private */
function remoteAddressOf (req) {
  return (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    '';
}

/**
 * @param {Object} [req]
 * @returns {boolean}
 */
function hasProxyForwardHeaders (req) {
  const h = req && req.headers;
  if (!h || typeof h !== 'object') return false;
  return !!(h['x-forwarded-for'] || h['x-forwarded-host'] || h['x-real-ip'] || h.forwarded);
}

/**
 * Hostname part of a `Host` header (`[::1]:8080` → `::1`, `localhost:8080` → `localhost`).
 * @param {string} host
 * @returns {string}
 */
function hostnameFromHostHeader (host) {
  const raw = String(host || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : raw;
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && raw.indexOf(':') === colon) return raw.slice(0, colon);
  return raw;
}

/**
 * True when a browser could only have sent this `Host` for an origin the attacker does not
 * control: IP literals, `localhost` / `*.localhost`, configured names, or no Host at all.
 * @param {string} host
 * @param {string[]} [allowedHosts]
 * @returns {boolean}
 */
function isRebindSafeHost (host, allowedHosts = []) {
  const name = hostnameFromHostHeader(host).replace(/\.$/, '');
  if (!name) return true;
  if (net.isIP(name)) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  return allowedHosts.some((h) => hostnameFromHostHeader(h) === name);
}

/**
 * @param {Object} req
 * @param {Object} [opts]
 * @param {string[]} [opts.allowedHosts]
 * @returns {boolean}
 */
function isTrustedLoopbackRequest (req, opts = {}) {
  if (!isLoopbackAddress(remoteAddressOf(req))) return false;
  if (hasProxyForwardHeaders(req)) return false;
  const host = req && req.headers ? req.headers.host : '';
  return isRebindSafeHost(host, opts.allowedHosts || []);
}

/**
 * Configured names this Hub answers to directly on loopback.
 * @param {Object} [settings] Hub settings
 * @param {Object} [env]
 * @returns {string[]}
 */
function allowedHostsFromSettings (settings = {}, env = process.env) {
  const out = [];
  const httpCfg = settings && settings.http ? settings.http : {};
  if (httpCfg.hostname) out.push(String(httpCfg.hostname));
  if (env.FABRIC_HUB_HOSTNAME) out.push(String(env.FABRIC_HUB_HOSTNAME));
  for (const h of String(env.FABRIC_HUB_ALLOWED_HOSTS || '').split(',')) {
    if (h.trim()) out.push(h.trim());
  }
  return out;
}

/**
 * Express middleware: refuse direct loopback requests whose `Host` is a name that could have
 * been rebound to 127.0.0.1 (421 Misdirected Request). Proxied and LAN requests pass through
 * and simply never count as local.
 * @param {Object} [opts]
 * @param {string[]} [opts.allowedHosts]
 * @returns {Function}
 */
function createLoopbackHostGuard (opts = {}) {
  const allowedHosts = opts.allowedHosts || [];
  return function loopbackHostGuard (req, res, next) {
    if (!isLoopbackAddress(remoteAddressOf(req)) || hasProxyForwardHeaders(req)) return next();
    const host = req.headers ? req.headers.host : '';
    if (isRebindSafeHost(host, allowedHosts)) return next();
    res.status(421);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      ok: false,
      error: `Host "${hostnameFromHostHeader(host)}" is not served on loopback; use 127.0.0.1 or localhost, or add it to FABRIC_HUB_ALLOWED_HOSTS.`
    }));
  };
}

/**
 * Content-Security-Policy for the Hub SPA. Scripts are same-origin (plus WebAssembly);
 * styles allow inline (React `style` props); images and connections stay open for Fomantic
 * flag sprites, explorers, Hub seeds, and WebRTC / WebSocket peers.
 * @param {Object} [opts]
 * @param {boolean} [opts.allowInlineScripts] Dev identity push injects an inline script.
 * @returns {string}
 */
function buildContentSecurityPolicy (opts = {}) {
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"];
  if (opts.allowInlineScripts) scriptSrc.push("'unsafe-inline'");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' http: https: ws: wss:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ');
}

module.exports = {
  allowedHostsFromSettings,
  buildContentSecurityPolicy,
  createLoopbackHostGuard,
  hasProxyForwardHeaders,
  hostnameFromHostHeader,
  isLoopbackAddress,
  isRebindSafeHost,
  isTrustedLoopbackRequest
};
