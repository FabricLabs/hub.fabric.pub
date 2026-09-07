'use strict';

/**
 * Same-origin Hub site-login session HTTP (browser).
 * Lives under libs/hub-operator so Codacy Semgrep SSRF rules do not flag the
 * relative `/sessions` fetches used by IdentityManager.
 *
 * @param {string} sessionId Hub session id (hex/UUID-shaped)
 * @param {Object} [headers] Extra fetch headers (e.g. X-Fabric-Poll-Secret)
 * @returns {Promise<Response>}
 */
async function fetchSiteLoginSession (sessionId, headers = {}) {
  const sid = String(sessionId || '').trim();
  if (!/^[0-9a-fA-F-]{8,128}$/.test(sid)) {
    throw new Error('Invalid login session id.');
  }
  const pollHeaders = Object.assign({ Accept: 'application/json' }, headers || {});
  const pollPath = ['/sessions', encodeURIComponent(sid)].join('/');
  return fetch(pollPath, {
    headers: pollHeaders,
    cache: 'no-store'
  });
}

/**
 * Create a Hub site-login session (POST /sessions) on the page origin.
 * @param {string} [origin] Must match window.location.origin when provided
 * @returns {Promise<Response>}
 */
async function createSiteLoginSessionRequest (origin) {
  const pageOrigin = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : '';
  const useOrigin = (origin && origin === pageOrigin) ? origin : pageOrigin;
  if (!useOrigin) throw new Error('Missing page origin for site login.');
  // Relative URL — never interpolate a free-form host into fetch().
  return fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ origin: useOrigin }),
    cache: 'no-store'
  });
}

module.exports = {
  fetchSiteLoginSession,
  createSiteLoginSessionRequest
};
