'use strict';

/**
 * Message-only string for logging crypto/identity failures — avoids printing full Error stacks
 * (paths, internals) to the browser console.
 * @param {unknown} err
 * @returns {string}
 */
function safeIdentityErr (err) {
  if (err == null) return '';
  if (typeof err.message === 'string' && err.message) return err.message;
  try {
    return String(err);
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Non-sensitive preview for dev-only UI (e.g. Bridge debug render). Avoids dumping full JSON
 * that may include message bodies or wallet-adjacent fields.
 * @param {unknown} value
 * @returns {string}
 */
function safeDebugStatePreview (value) {
  if (value == null) return 'null';
  const t = typeof value;
  if (t !== 'object' || Array.isArray(value)) {
    return t;
  }
  try {
    const keys = Object.keys(value);
    return JSON.stringify({ _type: 'object', keys, keyCount: keys.length });
  } catch (e) {
    return 'object';
  }
}

/**
 * User-facing or Error message from API/unknown value without dumping full JSON (may include tokens, PSBT hints).
 * @param {unknown} val
 * @param {string} [fallback]
 * @returns {string}
 */
function safeBriefMessage (val, fallback = 'Request failed') {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    if (typeof val.message === 'string' && val.message) return val.message;
    if (typeof val.error === 'string' && val.error) return val.error;
  }
  return fallback;
}

/**
 * Log-safe hub / WebSocket URL: host, port, path only — no query (tokens) or hash.
 * @param {unknown} raw
 * @returns {string}
 */
function safeUrlForLog (raw) {
  const s = String(raw || '').trim();
  if (!s) return '(empty)';
  try {
    const withHttp = s.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    const u = new URL(withHttp);
    const host = u.hostname;
    const port = u.port ? `:${u.port}` : '';
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return `${host}${port}${path}`;
  } catch (_) {
    return s.length > 72 ? `${s.slice(0, 36)}…(len ${s.length})` : s;
  }
}

module.exports = {
  safeIdentityErr,
  safeDebugStatePreview,
  safeBriefMessage,
  safeUrlForLog
};
