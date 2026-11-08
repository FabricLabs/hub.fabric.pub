'use strict';

/**
 * @fileoverview Fabric message log rows for list and record pages, shared by
 * the Hub's `/messages` routes and any client (Hub UI, GoonCitizen). Framework
 * free and browser safe: input is the Hub log entry
 * `{ id, seq, type, payload, created, parent, frameId }`.
 */

const ZERO_PARENT = '0'.repeat(64);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Payload fields that name another record (a contract, federation, document…).
 * @private
 */
const REF_FIELDS = Object.freeze([
  'contractId',
  'contract',
  'federationId',
  'documentId',
  'document',
  'namespace',
  'requestId',
  'proposalId',
  'id'
]);

/** @private */
function isRefValue (v) {
  return typeof v === 'string' && /^[0-9a-zA-Z:_-]{6,128}$/.test(v);
}

/** @private */
function lowerHex (v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Ids a log entry's payload refers to (top level and one level down), lowercased.
 * @param {Object} entry
 * @returns {string[]}
 */
function entryRefs (entry) {
  const payload = entry && entry.payload && typeof entry.payload === 'object' ? entry.payload : null;
  if (!payload) return [];
  const out = new Set();
  const take = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const field of REF_FIELDS) {
      const v = obj[field];
      if (isRefValue(v)) out.add(v.toLowerCase());
      else if (v && typeof v === 'object' && isRefValue(v.id)) out.add(String(v.id).toLowerCase());
    }
  };
  take(payload);
  for (const v of Object.values(payload)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) take(v);
  }
  return [...out];
}

/**
 * Author of a log entry when its payload names one.
 * @param {Object} entry
 * @returns {(string|null)}
 */
function entryAuthor (entry) {
  const p = entry && entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
  const v = p.author || p.signer || p.from || p.publisher || null;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Human label for a message type: `FederationContractInvite` → `Federation contract invite`.
 * @param {string} type
 * @returns {string}
 */
function messageLabel (type) {
  const s = String(type || '').trim();
  if (!s) return 'Message';
  if (/^[A-Z0-9_]+$/.test(s)) {
    const words = s.toLowerCase().split('_').filter(Boolean).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/\s+/);
  return words.map((w, i) => (i === 0 ? w : (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w : w.toLowerCase()))).join(' ');
}

/**
 * Page for a log entry (its frame id when it has one, else its log id).
 * @param {(Object|string)} entryOrId
 * @returns {string}
 */
function messageHref (entryOrId) {
  const id = typeof entryOrId === 'string'
    ? entryOrId
    : (entryOrId && (entryOrId.frameId || entryOrId.id)) || '';
  return `/messages/${encodeURIComponent(String(id))}`;
}

/**
 * Parent frame id, or null for the genesis parent.
 * @param {Object} entry
 * @returns {(string|null)}
 */
function parentOf (entry) {
  const p = lowerHex(entry && entry.parent);
  return p && p !== ZERO_PARENT ? p : null;
}

/**
 * List row for one log entry (no payload).
 * @param {Object} entry
 * @returns {Object}
 */
function messageRow (entry) {
  const e = entry || {};
  const parent = parentOf(e);
  return {
    id: e.id || null,
    frameId: e.frameId || null,
    seq: Number(e.seq) || 0,
    type: e.type || null,
    label: messageLabel(e.type),
    created: e.created || null,
    parent,
    parentHref: parent ? messageHref(parent) : null,
    author: entryAuthor(e),
    refs: entryRefs(e),
    href: messageHref(e)
  };
}

/** @private */
function clampLimit (limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

/** @private */
function typeSet (type) {
  if (Array.isArray(type)) return new Set(type.map(String).filter(Boolean));
  const s = String(type || '').trim();
  return s ? new Set(s.split(',').map((t) => t.trim()).filter(Boolean)) : null;
}

/**
 * Does a log entry pass the filters? `contract` matches any ref by prefix
 * (12 hex is enough), `author` the author by prefix, `q` the type or payload text.
 * @param {Object} entry
 * @param {Object} [filters]
 * @returns {boolean}
 */
function matchesFilters (entry, filters = {}) {
  const types = typeSet(filters.type);
  if (types && !types.has(String(entry && entry.type))) return false;
  const contract = lowerHex(filters.contract);
  if (contract && !entryRefs(entry).some((r) => r === contract || r.startsWith(contract))) return false;
  const author = lowerHex(filters.author);
  if (author) {
    const a = lowerHex(entryAuthor(entry));
    if (!a || !(a === author || a.startsWith(author) || a.slice(2) === author)) return false;
  }
  const q = lowerHex(filters.q);
  if (q) {
    let text = String(entry && entry.type || '').toLowerCase();
    try { text += ' ' + JSON.stringify(entry && entry.payload).toLowerCase(); } catch (_) { /* unserializable payload */ }
    if (!text.includes(q)) return false;
  }
  return true;
}

/**
 * One page of the log, newest first.
 * @param {Object[]} entries Hub log entries (any order)
 * @param {Object} [opts]
 * @param {string} [opts.type] Exact type, or a comma list
 * @param {string} [opts.contract] Contract / federation / document id or prefix
 * @param {string} [opts.author]
 * @param {string} [opts.q]
 * @param {number} [opts.before] Only entries with a lower `seq` (paging cursor)
 * @param {number} [opts.limit=50] At most 200
 * @returns {{ messages: Object[], total: number, more: boolean, next: (number|null), types: Object<string, number> }}
 */
function filterMessages (entries, opts = {}) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e === 'object')
    .slice()
    .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  const before = Number(opts.before);
  const limit = clampLimit(opts.limit);
  const types = {};
  const hits = [];
  for (const e of list) {
    const t = String(e.type || '');
    types[t] = (types[t] || 0) + 1;
    if (Number.isFinite(before) && before > 0 && !(Number(e.seq || 0) < before)) continue;
    if (!matchesFilters(e, opts)) continue;
    hits.push(e);
  }
  const page = hits.slice(0, limit);
  const more = hits.length > limit;
  return {
    messages: page.map(messageRow),
    total: hits.length,
    more,
    next: more && page.length ? Number(page[page.length - 1].seq) || null : null,
    types
  };
}

/**
 * Find an entry by frame id, log id, or a unique prefix of either (12+ hex).
 * @param {Object[]} entries
 * @param {string} id
 * @returns {(Object|null)}
 */
function findMessage (entries, id) {
  const want = lowerHex(id);
  if (!want) return null;
  const list = Array.isArray(entries) ? entries : [];
  const exact = list.find((e) => e && (lowerHex(e.frameId) === want || lowerHex(e.id) === want));
  if (exact) return exact;
  if (want.length < 12) return null;
  const hits = list.filter((e) => e && (lowerHex(e.frameId).startsWith(want) || lowerHex(e.id).startsWith(want)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * A record page: the entry with its payload, its parent and children rows,
 * and the parent chain back toward genesis (at most `depth`).
 * @param {Object[]} entries
 * @param {string} id
 * @param {Object} [opts]
 * @param {number} [opts.depth=20]
 * @returns {(Object|null)}
 */
function messageRecord (entries, id, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const entry = findMessage(list, id);
  if (!entry) return null;
  const byFrame = new Map();
  for (const e of list) if (e && e.frameId) byFrame.set(lowerHex(e.frameId), e);
  const parentEntry = parentOf(entry) ? byFrame.get(parentOf(entry)) || null : null;
  const frame = lowerHex(entry.frameId);
  const children = frame
    ? list.filter((e) => e && parentOf(e) === frame).sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
    : [];
  return Object.assign(messageRow(entry), {
    payload: entry.payload === undefined ? null : entry.payload,
    chainBlock: entry.chainBlock || null,
    parentMessage: parentEntry ? messageRow(parentEntry) : null,
    children: children.map(messageRow),
    chain: walkParents(byFrame, entry, opts.depth)
  });
}

/** @private */
function walkParents (byFrame, entry, depthOpt) {
  const depth = Math.max(0, Math.min(200, Number(depthOpt) || 20));
  const chain = [];
  const seen = new Set([lowerHex(entry.frameId)]);
  let p = parentOf(entry);
  let cursor = p ? byFrame.get(p) || null : null;
  while (cursor && chain.length < depth) {
    const f = lowerHex(cursor.frameId);
    if (seen.has(f)) break;
    seen.add(f);
    chain.push(messageRow(cursor));
    p = parentOf(cursor);
    cursor = p ? byFrame.get(p) || null : null;
  }
  return chain;
}

/**
 * Ancestors of an entry, nearest first, as rows (at most `depth`, default 20).
 * @param {Object[]} entries
 * @param {string} id
 * @param {number} [depth=20]
 * @returns {Object[]}
 */
function parentChain (entries, id, depth) {
  const list = Array.isArray(entries) ? entries : [];
  const entry = findMessage(list, id);
  if (!entry) return [];
  const byFrame = new Map();
  for (const e of list) if (e && e.frameId) byFrame.set(lowerHex(e.frameId), e);
  return walkParents(byFrame, entry, depth);
}

module.exports = {
  ZERO_PARENT,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REF_FIELDS,
  entryRefs,
  entryAuthor,
  messageLabel,
  messageHref,
  parentOf,
  messageRow,
  matchesFilters,
  filterMessages,
  findMessage,
  messageRecord,
  parentChain
};
