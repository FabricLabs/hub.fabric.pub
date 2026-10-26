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

const fs = require('fs');
const net = require('net');
const path = require('path');

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
 * True when a browser reads this response for another site: a `fetch`, `<script>`, or `<img>`
 * from a cross-site or same-site page (`Sec-Fetch-Site`), or any request whose `Origin` is not
 * this Host. Top-level navigations are not reads; the other site never sees the page.
 * @param {Object} [req]
 * @returns {boolean}
 */
function isCrossOriginRead (req) {
  const h = (req && req.headers) || {};
  const site = String(h['sec-fetch-site'] || '').toLowerCase();
  const mode = String(h['sec-fetch-mode'] || '').toLowerCase();
  if ((site === 'cross-site' || site === 'same-site') && mode !== 'navigate') return true;
  if (!h.origin) return false;
  try {
    return new URL(String(h.origin)).host.toLowerCase() !== String(h.host || '').toLowerCase();
  } catch (_) {
    return true;
  }
}

/**
 * Whether a `config.local.js` source sets the dev browser identity (operator mnemonic or its
 * passphrase) on a line that is not a comment.
 * @param {string} source
 * @returns {boolean}
 */
function setsBrowserIdentity (source) {
  return String(source || '').split('\n').some((line) =>
    !/^\s*(\/\/|\/\*|\*)/.test(line) && /FABRIC_DEV_BROWSER_(SEED|PASSPHRASE)/.test(line));
}

/** @private */
const LOCAL_CONFIG_STUB = '/* config.local.js sets a browser identity, so it is only served to this machine. */\n';

/** @private Requests the SPA fallback may answer with the HTML shell. */
function mayServeShell (req, pathname) {
  if (pathname === '/' || pathname === '/index.html') return true;
  if (path.extname(pathname)) return false;
  const accept = String((req.headers && req.headers.accept) || '');
  return !accept || accept.includes('text/html') || accept.includes('*/*');
}

/**
 * Express middleware that keeps browser secrets on this machine. Mount it ahead of the static
 * roots, which would otherwise serve `/config.local.js` (with the global CORS headers) before
 * any Hub middleware runs.
 *
 * `/config.local.js` may set `window.FABRIC_DEV_BROWSER_SEED`. It is served by this middleware
 * with no CORS headers and `Cross-Origin-Resource-Policy: same-origin`; a request that is not
 * local ({@link isTrustedLoopbackRequest}) or that another site makes from a browser gets a stub
 * instead whenever the file sets that identity. With `inlineIdentity`
 * (`FABRIC_DEV_PUSH_BROWSER_IDENTITY`, mnemonic in the HTML shell) such requests are refused
 * (403) for anything that may be the shell.
 * @param {Object} opts
 * @param {string} opts.configPath Absolute path of `assets/config.local.js`.
 * @param {boolean} [opts.inlineIdentity]
 * @param {string[]} [opts.allowedHosts]
 * @returns {Function}
 */
function createBrowserSecretsGuard (opts = {}) {
  const allowedHosts = opts.allowedHosts || [];
  return function browserSecretsGuard (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = String(req.path || '');
    const local = isTrustedLoopbackRequest(req, { allowedHosts }) && !isCrossOriginRead(req);
    if (pathname === '/config.local.js') {
      let source;
      try {
        source = fs.readFileSync(opts.configPath, 'utf8');
      } catch (_) {
        return next();
      }
      res.status(200);
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(local || !setsBrowserIdentity(source) ? source : LOCAL_CONFIG_STUB);
      return;
    }
    if (opts.inlineIdentity && !local && mayServeShell(req, pathname)) {
      res.status(403);
      res.setHeader('Content-Type', 'text/plain; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send('FABRIC_DEV_PUSH_BROWSER_IDENTITY is on: this Hub only serves its page to this machine.\n');
      return;
    }
    next();
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
  createBrowserSecretsGuard,
  createLoopbackHostGuard,
  hasProxyForwardHeaders,
  hostnameFromHostHeader,
  isCrossOriginRead,
  isLoopbackAddress,
  isRebindSafeHost,
  isTrustedLoopbackRequest,
  setsBrowserIdentity
};
