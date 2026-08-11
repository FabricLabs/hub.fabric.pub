'use strict';

/**
 * HTTP shared-mode helpers. Prefer `@fabric/http/functions/httpSharedMode`.
 * Falls back to a local copy when the published http package lags.
 */
try {
  module.exports = require('@fabric/http/functions/httpSharedMode');
} catch (_) {
  function isHttpSharedModeEnabled (raw) {
    if (raw === undefined || raw === null) return false;
    if (raw === true || raw === 1) return true;
    if (typeof raw === 'string') {
      const s = raw.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    }
    return false;
  }

  function resolveHttpListenHost (opts = {}) {
    const env = opts.env || process.env;
    if (opts.envHost != null) {
      const forced = String(opts.envHost).trim();
      if (forced) return forced;
    } else {
      const keys = Array.isArray(opts.envHostKeys) && opts.envHostKeys.length
        ? opts.envHostKeys
        : ['SC_HTTP_HOST', 'SC_HTTP_INTERFACE'];
      for (const key of keys) {
        const v = String(env[key] || '').trim();
        if (v) return v;
      }
    }
    const explicit = String(opts.host || '').trim();
    if (explicit) return explicit;
    if (String(opts.mode || '') === 'server') return '0.0.0.0';
    if (isHttpSharedModeEnabled(opts.httpSharedMode)) return '0.0.0.0';
    return '127.0.0.1';
  }

  module.exports = { isHttpSharedModeEnabled, resolveHttpListenHost };
}
