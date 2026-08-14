'use strict';

/**
 * Resolve a public HTTP origin for absolute BIP21 `pj=` URLs.
 * Prefer explicit FABRIC_HUB_PUBLIC_ORIGIN / settings.publicOrigin; otherwise
 * build from hostname + port (http on non-443).
 *
 * @param {object} [opts]
 * @param {string} [opts.publicOrigin]
 * @param {string} [opts.hostname]
 * @param {number|string} [opts.port]
 * @param {string} [opts.protocol] http|https
 * @param {object} [opts.env] process.env override
 * @returns {string} origin without trailing slash, or '' if unknown
 */
function resolvePayjoinPublicOrigin (opts = {}) {
  const env = opts.env || process.env || {};
  const fromEnv = String(env.FABRIC_HUB_PUBLIC_ORIGIN || env.FABRIC_PUBLIC_ORIGIN || '').trim();
  const fromOpts = String(opts.publicOrigin || '').trim();
  let origin = fromOpts || fromEnv;
  if (origin) {
    origin = origin.replace(/\/+$/, '');
    if (/^https?:\/\//i.test(origin)) return origin;
    return `http://${origin}`;
  }

  const hostname = String(opts.hostname || env.FABRIC_HUB_HOSTNAME || env.HOSTNAME || '').trim();
  if (!hostname) return '';

  const protocolRaw = String(opts.protocol || env.FABRIC_HUB_PUBLIC_PROTOCOL || '').trim().toLowerCase();
  const portNum = Number(opts.port != null ? opts.port : (env.FABRIC_HUB_PORT || env.PORT || 0));
  let protocol = protocolRaw === 'https' || protocolRaw === 'http' ? protocolRaw : '';
  if (!protocol) {
    protocol = (portNum === 443) ? 'https' : 'http';
  }

  const omitPort = (protocol === 'https' && (!portNum || portNum === 443)) ||
    (protocol === 'http' && (!portNum || portNum === 80));
  if (omitPort) return `${protocol}://${hostname}`;
  if (!Number.isFinite(portNum) || portNum <= 0) return `${protocol}://${hostname}`;
  return `${protocol}://${hostname}:${portNum}`;
}

/**
 * @param {string} origin
 * @param {string} pathPart absolute path starting with /
 * @returns {string}
 */
function joinOriginPath (origin, pathPart) {
  const base = String(origin || '').replace(/\/+$/, '');
  const path = String(pathPart || '');
  if (!base) return path.startsWith('/') ? path : `/${path}`;
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

module.exports = {
  resolvePayjoinPublicOrigin,
  joinOriginPath
};
