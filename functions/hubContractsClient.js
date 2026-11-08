'use strict';

/**
 * @fileoverview JSON client for a Hub's contract, federation, and message
 * pages. Base URL, headers, and `fetch` are injectable so a browser page, a
 * desktop app, or GoonCitizen's relay can aim it at any Hub. Session cookies
 * go along (`credentials: 'include'` off-origin, `same-origin` otherwise).
 */

/** @private */
function query (params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl=''] Hub origin (empty = this page's origin)
 * @param {(Object|Function)} [opts.headers] Extra headers, or `(method, path) => headers`
 * @param {Function} [opts.fetch] `fetch` implementation (default the global)
 * @returns {Object}
 */
function createHubContractsClient (opts = {}) {
  const baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
  const fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);

  async function get (path) {
    if (!fetchImpl) throw new Error('fetch unavailable');
    const extra = typeof opts.headers === 'function' ? opts.headers('GET', path) : opts.headers;
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: 'GET',
      credentials: baseUrl ? 'include' : 'same-origin',
      headers: Object.assign({ Accept: 'application/json' }, extra || {})
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    const failed = !res.ok || (body && body.status === 'error');
    if (failed) {
      const err = new Error((body && (body.message || body.error)) || `HTTP ${res.status}`);
      err.status = res.ok ? 404 : res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  const id = (v) => encodeURIComponent(String(v == null ? '' : v));

  return {
    baseUrl,
    /** `GET /federations` → `{ viewer, federations }` */
    listFederations: () => get('/federations'),
    /** `GET /federations/:id` → federation view */
    getFederation: async (federationId) => (await get(`/federations/${id(federationId)}`)).federation,
    /** `GET /federations/:id/messages` → `{ messages, next, more }` */
    federationMessages: (federationId, params = {}) => get(`/federations/${id(federationId)}/messages${query({ since: params.since, limit: params.limit })}`),
    /** `GET /messages` → `{ messages, total, more, next, types }` */
    listMessages: (params = {}) => get(`/messages${query({
      type: Array.isArray(params.type) ? params.type.join(',') : params.type,
      contract: params.contract,
      author: params.author,
      q: params.q,
      before: params.before,
      limit: params.limit
    })}`),
    /** `GET /messages/:id` → message record */
    getMessage: async (messageId) => (await get(`/messages/${id(messageId)}`)).message,
    /** `GET /contracts/:id` → `{ contract, application }` */
    getContract: async (contractId) => {
      const body = await get(`/contracts/${id(contractId)}`);
      return { contract: body.contract || null, application: body.application || null };
    }
  };
}

module.exports = { createHubContractsClient, query };
