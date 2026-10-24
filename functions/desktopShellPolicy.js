'use strict';

/**
 * @fileoverview URL, IPC, and permission policy for the Electron desktop shell
 * (`scripts/desktop.js`). Pure functions so the rules are unit-tested without Electron.
 */

const net = require('net');

/** @private */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
/** @private */
const HUB_LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];
/** @private */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications']);

/** @private */
function parseUrl (value) {
  try {
    return new URL(String(value));
  } catch (_) {
    return null;
  }
}

/**
 * Origins that serve this desktop's Hub UI.
 * @param {number|string} port
 * @returns {string[]}
 */
function hubOrigins (port) {
  return HUB_LOOPBACK_HOSTS.map((host) => `http://${host}:${port}`);
}

/**
 * @param {string} value
 * @param {number|string} port
 * @returns {boolean}
 */
function isHubAppUrl (value, port) {
  const u = parseUrl(value);
  if (!u) return false;
  return hubOrigins(port).includes(u.origin);
}

/**
 * Only schemes that are safe to hand to the OS (`shell.openExternal`).
 * @param {string} value
 * @returns {boolean}
 */
function isSafeExternalUrl (value) {
  const u = parseUrl(value);
  return !!u && EXTERNAL_PROTOCOLS.has(u.protocol);
}

/**
 * What the main window should do with a navigation or `window.open`.
 * @param {string} value
 * @param {number|string} port
 * @returns {'allow'|'external'|'deny'}
 */
function navigationAction (value, port) {
  if (isHubAppUrl(value, port)) return 'allow';
  if (isSafeExternalUrl(value)) return 'external';
  return 'deny';
}

/**
 * IPC is answered only for the Hub UI in a top-level frame.
 * @param {Object} [frame] Electron `WebFrameMain` (`event.senderFrame`)
 * @param {number|string} port
 * @returns {boolean}
 */
function isTrustedIpcFrame (frame, port) {
  if (!frame || typeof frame.url !== 'string') return false;
  if (frame.parent) return false;
  return isHubAppUrl(frame.url, port);
}

/**
 * Loopback, private, link-local, CGNAT, multicast, and unspecified addresses.
 * @param {string} address
 * @returns {boolean}
 */
function isPrivateAddress (address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      /^ff/.test(lower);
  }
  return false;
}

/**
 * BIP78 `pj=` endpoints the main process may POST to. The Hub's own origin is always allowed
 * (the renderer can reach it anyway); anything else must be https on a public address unless
 * `allowPrivate` (regtest / LAN testing via `FABRIC_DESKTOP_PAYJOIN_ALLOW_PRIVATE=1`).
 * @param {string} value
 * @param {Object} [opts]
 * @param {number|string} [opts.hubPort]
 * @param {boolean} [opts.allowPrivate]
 * @returns {{ ok: boolean, error?: string, url?: URL, checkResolvedAddress?: boolean }}
 */
function checkPayjoinTarget (value, opts = {}) {
  const u = parseUrl(String(value || '').trim());
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
    return { ok: false, error: 'Payjoin URL must be http or https' };
  }
  if (u.username || u.password) {
    return { ok: false, error: 'Payjoin URL must not carry credentials' };
  }
  if (opts.hubPort != null && isHubAppUrl(u.href, opts.hubPort)) {
    return { ok: true, url: u, checkResolvedAddress: false };
  }
  if (opts.allowPrivate) return { ok: true, url: u, checkResolvedAddress: false };
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'Payjoin endpoints must use https' };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) {
    return { ok: false, error: 'Payjoin URL must not point at a private or loopback address' };
  }
  return { ok: true, url: u, checkResolvedAddress: true };
}

/**
 * Default-deny Chromium permission policy: the Hub UI may write the clipboard, go
 * fullscreen, and show notifications; nothing else, and nothing for other origins.
 * @param {string} permission
 * @param {string} requestingUrl
 * @param {number|string} port
 * @returns {boolean}
 */
function isPermissionAllowed (permission, requestingUrl, port) {
  if (!ALLOWED_PERMISSIONS.has(String(permission || ''))) return false;
  return isHubAppUrl(requestingUrl, port);
}

module.exports = {
  checkPayjoinTarget,
  hubOrigins,
  isHubAppUrl,
  isPermissionAllowed,
  isPrivateAddress,
  isSafeExternalUrl,
  isTrustedIpcFrame,
  navigationAction
};
