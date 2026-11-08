'use strict';

/**
 * @fileoverview Which BIP78 `pj=` endpoints a sender may POST an original to.
 *
 * - `https:`, or `http:` to a `.onion` host (BIP78).
 * - No userinfo and a sane port: `http://x.onion:1@evil.com/pj` sends the
 *   original to `evil.com` in cleartext (rust-payjoin 1.1.0, #1896).
 * - When the Hub itself dials (`privateHosts: false`), no loopback, private,
 *   link-local, or metadata hosts (SSRF).
 * - Off mainnet, `allowInsecure` lets regtest and signet Hubs use plain
 *   `http:` and local hosts.
 */

const MAINNETS = new Set(['', 'main', 'mainnet', 'bitcoin']);

/**
 * @param {string} [networkName]
 * @returns {boolean}
 */
function isMainnet (networkName) {
  return MAINNETS.has(String(networkName || '').trim().toLowerCase());
}

/**
 * True for IPv4/IPv6 literals and names a Hub must not dial on behalf of a URI.
 * @param {string} hostname URL hostname (IPv6 without brackets)
 * @returns {boolean}
 */
function isPrivateHost (hostname) {
  const h = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateHost(mapped[1]);
    // WHATWG URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  // Bare names without a dot (e.g. `router`) resolve on the local network.
  return !h.includes('.');
}

/**
 * Check a BIP78 endpoint.
 * @param {string} pjUrl
 * @param {Object} [opts]
 * @param {string} [opts.networkName] the payer's network (mainnet when omitted)
 * @param {boolean} [opts.allowInsecure] off mainnet only: allow `http:` and local hosts
 * @param {boolean} [opts.privateHosts=true] false when the Hub dials (refuse private hosts)
 * @returns {{ ok: boolean, url: (string|undefined), error: (string|undefined) }}
 */
function checkPayjoinEndpoint (pjUrl, opts = {}) {
  const raw = String(pjUrl || '').trim();
  if (!raw) return { ok: false, error: 'pj endpoint is empty' };
  if (raw.length > 2048) return { ok: false, error: 'pj endpoint is too long' };
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return { ok: false, error: 'pj endpoint is not a URL' };
  }
  if (url.username || url.password || /^[a-z]+:\/\/[^/?#]*@/i.test(raw)) {
    return { ok: false, error: 'pj endpoint must not carry userinfo' };
  }
  if (url.port !== '') {
    const port = Number(url.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'pj endpoint has an invalid port' };
  }
  const insecure = !!opts.allowInsecure && !isMainnet(opts.networkName);
  const host = url.hostname.toLowerCase();
  const onion = host.endsWith('.onion');
  if (url.protocol === 'https:') {
    // ok
  } else if (url.protocol === 'http:') {
    if (!onion && !insecure) return { ok: false, error: 'pj endpoint must use https (or http to a .onion host)' };
  } else {
    return { ok: false, error: `pj endpoint scheme ${url.protocol} is not allowed` };
  }
  if (opts.privateHosts === false && !onion && !insecure && isPrivateHost(host)) {
    return { ok: false, error: `pj endpoint host ${host} is private or local` };
  }
  return { ok: true, url: url.toString() };
}

module.exports = {
  isMainnet,
  isPrivateHost,
  checkPayjoinEndpoint
};
