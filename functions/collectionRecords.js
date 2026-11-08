'use strict';

/**
 * @fileoverview Generic collection record pages (`/collections/:kind/:id`) and
 * the canonical page of each kind a Hub serves. Applications extend `KINDS`
 * with their own (GoonCitizen adds group, mission, person, location).
 * Framework free and browser safe.
 */

const { shortId } = require('./federationView');

const KINDS = Object.freeze({
  federation: Object.freeze({ label: 'Federation', collection: 'federations' }),
  contract: Object.freeze({ label: 'Contract', collection: 'contracts' }),
  'fabric-message': Object.freeze({ label: 'Fabric message', collection: 'messages' }),
  document: Object.freeze({ label: 'Document', collection: 'documents' }),
  peer: Object.freeze({ label: 'Peer', collection: 'peers' })
});

const KIND_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(KINDS).map(([kind, meta]) => [kind, meta.collection])
));

/**
 * @param {string} kind
 * @returns {string}
 */
function kindLabel (kind) {
  const k = String(kind || '');
  return (KINDS[k] && KINDS[k].label) || k;
}

/**
 * Does this kind have its own page (`/<collection>/<id>`)?
 * @param {string} kind
 * @returns {boolean}
 */
function hasCanonicalPage (kind) {
  return Object.prototype.hasOwnProperty.call(KIND_ALIASES, String(kind || ''));
}

/** @private */
function normalizeId (id) {
  let s = String(id == null ? '' : id).trim();
  try { s = decodeURIComponent(s); } catch (_) { /* keep raw */ }
  return s;
}

/**
 * Page for a kind and id: the kind's own page, else `/collections/<kind>/<id>`.
 * @param {string} kind
 * @param {*} id
 * @returns {(string|null)}
 */
function hrefFor (kind, id) {
  const k = String(kind || '');
  const recId = normalizeId(id);
  if (!k || !recId) return null;
  if (hasCanonicalPage(k)) return `/${KIND_ALIASES[k]}/${encodeURIComponent(recId)}`;
  return `/collections/${encodeURIComponent(k)}/${encodeURIComponent(recId)}`;
}

/**
 * @param {string} hash Fabric message frame id
 * @returns {(string|null)}
 */
function fabricMessageHref (hash) {
  const s = String(hash || '').trim();
  return s ? hrefFor('fabric-message', s) : null;
}

/** @private Payload fields naming a record of a kind. */
const LINK_FIELDS = Object.freeze([
  ['federationId', 'federation'],
  ['contractId', 'contract'],
  ['contract', 'contract'],
  ['documentId', 'document'],
  ['document', 'document']
]);

/**
 * Pages a payload points at (`federationId`, `contractId`, `documentId`, top
 * level and one level down), deduplicated.
 * @param {Object} payload
 * @returns {Array<{ kind: string, id: string, href: string }>}
 */
function recordLinks (payload) {
  if (!payload || typeof payload !== 'object') return [];
  const out = [];
  const seen = new Set();
  const take = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [field, kind] of LINK_FIELDS) {
      let v = obj[field];
      if (v && typeof v === 'object') v = v.id;
      if (typeof v !== 'string' || !/^[0-9a-zA-Z:_-]{6,128}$/.test(v)) continue;
      const key = `${kind}:${v}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id: v, href: hrefFor(kind, v) });
    }
  };
  take(payload);
  for (const v of Object.values(payload)) take(v);
  return out;
}

/**
 * Empty record shell for a kind and id.
 * @param {string} kind
 * @param {string} id
 * @param {Object} [fields]
 * @returns {Object}
 */
function recordShell (kind, id, fields) {
  return Object.assign({
    type: 'CollectionRecord',
    kind,
    collection: KIND_ALIASES[kind] || kind,
    id,
    title: id,
    subtitle: kindLabel(kind),
    href: hrefFor(kind, id),
    record: null,
    links: [],
    actions: [],
    missing: false
  }, fields || {});
}

/**
 * Load a record through a Hub client ({@link module:functions/hubContractsClient}).
 * A record the client can't find (or the reader may not see) comes back with
 * `missing: true`; kinds the client has no reader for come back as a shell.
 * @param {string} kind
 * @param {*} rawId
 * @param {Object} [client]
 * @returns {Promise<(Object|null)>}
 */
async function load (kind, rawId, client = {}) {
  const k = String(kind || '').trim();
  const id = normalizeId(rawId);
  if (!k || !id) return null;
  const miss = (err) => recordShell(k, id, { missing: true, error: err && err.message ? err.message : null });
  try {
    if (k === 'federation' && typeof client.getFederation === 'function') {
      const f = await client.getFederation(id);
      return recordShell(k, f.id || id, {
        title: f.name || shortId(f.id || id),
        subtitle: `Federation · ${f.network || ''}`.replace(/ · $/, ''),
        record: f,
        links: [{ rel: 'messages', href: `${hrefFor(k, f.id || id)}#messages`, title: 'Messages' }]
      });
    }
    if (k === 'contract' && typeof client.getContract === 'function') {
      const c = await client.getContract(id);
      const tracked = c.application && c.application.tracked;
      const name = (c.contract && (c.contract.name || c.contract.title)) || (tracked && tracked.name) || shortId(id);
      return recordShell(k, id, {
        title: name,
        subtitle: c.application ? 'Application contract' : 'Contract',
        record: c,
        links: c.application ? [{ rel: 'messages', href: `/messages?contract=${encodeURIComponent(id)}`, title: 'Messages' }] : []
      });
    }
    if (k === 'fabric-message' && typeof client.getMessage === 'function') {
      const m = await client.getMessage(id);
      const links = [];
      if (m.parentHref) links.push({ rel: 'parent', href: m.parentHref, title: 'Parent' });
      for (const child of m.children || []) links.push({ rel: 'child', href: child.href, title: child.label });
      return recordShell(k, m.frameId || m.id || id, { title: m.label, subtitle: `Fabric message · #${m.seq}`, record: m, links });
    }
  } catch (err) {
    return miss(err);
  }
  return recordShell(k, id);
}

module.exports = {
  KINDS,
  KIND_ALIASES,
  kindLabel,
  hasCanonicalPage,
  hrefFor,
  fabricMessageHref,
  recordLinks,
  recordShell,
  load
};
