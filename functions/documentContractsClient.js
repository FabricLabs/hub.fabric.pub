'use strict';

/**
 * @fileoverview Browser and Node client for editable documents (document
 * contracts): versions, provenance, making a document editable, and editing.
 * Framework-free; `fetch` and the Hub origin are injectable.
 */

/**
 * @param {Object} [opts]
 * @param {string} [opts.baseUrl] Hub origin; same origin when empty.
 * @param {Function} [opts.fetch]
 * @param {(Object|Function)} [opts.headers] Extra request headers (or a function returning them).
 * @returns {Object}
 */
function createDocumentContractsClient (opts = {}) {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '');
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('fetch is not available');
  const extraHeaders = () => {
    const h = typeof opts.headers === 'function' ? opts.headers() : opts.headers;
    return h && typeof h === 'object' ? h : {};
  };

  async function getJson (path) {
    const res = await doFetch(`${base}${path}`, { headers: Object.assign({}, extraHeaders(), { Accept: 'application/json' }) });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok || !body || body.status === 'error') {
      const err = new Error((body && body.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function rpc (method, params) {
    const res = await doFetch(`${base}/services/rpc`, {
      method: 'POST',
      headers: Object.assign({}, extraHeaders(), { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: [params] })
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!body) throw new Error(`HTTP ${res.status}`);
    if (body.error) throw new Error(String(body.error.message || body.error.data || 'refused'));
    const result = body.result;
    if (!result || result.status === 'error') throw new Error((result && result.message) || 'refused');
    return result;
  }

  const enc = (id) => encodeURIComponent(String(id || ''));

  return {
    /** Versions of a document (its contract history, or the old lineage). */
    revisions: (documentId) => getJson(`/documents/${enc(documentId)}/revisions`),
    /** Provenance of one version (`DocumentProvenance`). */
    provenance: (documentId) => getJson(`/documents/${enc(documentId)}/provenance`),
    /** A document contract by id. */
    contract: (contractId, { frames = false } = {}) => rpc('GetDocumentContract', { contractId, includeFrames: !!frames }),
    /** Make a held document editable (operator). */
    makeEditable: (documentId, { adminToken, editors, note } = {}) => rpc('CreateDocumentContract', { id: documentId, adminToken, editors, note }),
    /**
     * Save a new version replacing `documentId` (operator for editable documents).
     * @param {string} documentId
     * @param {Object} change `{ content | contentBase64, name, mime, note, purchasePriceSats, adminToken }`
     */
    edit: (documentId, change = {}) => rpc('EditDocument', Object.assign({ id: documentId }, change)),
    /** Hand this Hub a signed revision from another editor. */
    submitFrame: (fabric, { adminToken } = {}) => rpc('SubmitDocumentRevisionFrame', { fabric, adminToken })
  };
}

/**
 * Where a version sits in its history, for display.
 * @param {Object} history `ListDocumentRevisionsResult`
 * @param {string} documentId
 * @returns {{ editable: boolean, revision: (number|null), latest: boolean, fork: boolean, newer: (Object|null) }}
 */
function versionStatus (history, documentId) {
  const id = String(documentId || '').toLowerCase();
  if (!history || !history.contractId) {
    return { editable: false, revision: null, latest: true, fork: false, newer: null };
  }
  const revisions = Array.isArray(history.revisions) ? history.revisions : [];
  const forks = Array.isArray(history.forks) ? history.forks : [];
  const onChain = revisions.filter((r) => r.documentIdentifier === id);
  const own = onChain.length ? onChain[onChain.length - 1] : forks.find((r) => r.documentIdentifier === id) || null;
  const head = history.head || revisions[revisions.length - 1] || null;
  const latest = !!(own && head && own.frameId === head.frameId);
  return {
    editable: true,
    revision: own ? own.revision : null,
    latest,
    fork: !onChain.length && !!own,
    newer: !latest && head ? head : null
  };
}

module.exports = {
  createDocumentContractsClient,
  versionStatus
};
