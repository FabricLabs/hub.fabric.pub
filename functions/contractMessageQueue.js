'use strict';

/**
 * Hub Filesystem adapter for opaque CONTRACT_MESSAGE queues.
 *
 * Core logic: `@fabric/core/functions/contractMessageQueue`.
 * Persistence: `contract-message-queue/<contractId>.json` + INDEX.
 */

const core = require('@fabric/core/functions/contractMessageQueue');

const FS_ROOT = 'contract-message-queue';
const INDEX_PATH = `${FS_ROOT}/INDEX.json`;
// Hex characters kept per contract; 512 full frames would be ~32 MiB.
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
// Any key can open a session, so a row's mailbox marks still need a ceiling.
const DEFAULT_MAX_DELIVERED_PEERS = 64;
const MAILBOX_PREFIX = 'fabric:';

/**
 * Delivery key of a peer's mailbox: its authenticated Fabric id, never the
 * `host:port` of the connection it came in on.
 * @param {string} fabricId
 * @returns {string|null} `fabric:<lowercased id>`
 */
function mailboxKey (fabricId) {
  const id = fabricId == null ? '' : String(fabricId).trim().toLowerCase();
  if (!id) return null;
  return id.startsWith(MAILBOX_PREFIX) ? id : `${MAILBOX_PREFIX}${id}`;
}

function _queueBytes (entries) {
  let total = 0;
  for (const e of entries) total += (e && typeof e.hex === 'string') ? e.hex.length : 0;
  return total;
}

/**
 * Drop delivery marks that aren't mailbox keys (connection addresses from
 * before mailboxes), trim a queue document to a byte budget (oldest delivered
 * rows first, then oldest), and keep only the newest `maxDeliveredPeers`
 * mailbox marks per row.
 * @param {object} doc `{ id, maxEntries, entries }` (mutated)
 * @param {{ maxBytes?: number, maxDeliveredPeers?: number }} [limits]
 * @returns {boolean} true when anything was dropped
 */
function fitQueueDoc (doc, limits = {}) {
  if (!doc || !Array.isArray(doc.entries)) return false;
  const maxBytes = Number(limits.maxBytes) > 0 ? Number(limits.maxBytes) : DEFAULT_MAX_BYTES;
  const maxPeers = Number(limits.maxDeliveredPeers) > 0 ? Number(limits.maxDeliveredPeers) : DEFAULT_MAX_DELIVERED_PEERS;
  let changed = false;
  for (const e of doc.entries) {
    const d = e && e.deliveredTo;
    if (!d || typeof d !== 'object') continue;
    for (const key of Object.keys(d)) {
      if (key.startsWith(MAILBOX_PREFIX)) continue;
      delete d[key];
      changed = true;
    }
  }
  let total = _queueBytes(doc.entries);
  while (total > maxBytes && doc.entries.length) {
    let dropIdx = doc.entries.findIndex((e) => {
      const d = e && e.deliveredTo;
      return d && typeof d === 'object' && Object.keys(d).length > 0;
    });
    if (dropIdx < 0) dropIdx = 0;
    const [dropped] = doc.entries.splice(dropIdx, 1);
    total -= (dropped && typeof dropped.hex === 'string') ? dropped.hex.length : 0;
    changed = true;
  }
  for (const e of doc.entries) {
    const d = e && e.deliveredTo;
    if (!d || typeof d !== 'object') continue;
    const peers = Object.keys(d);
    if (peers.length <= maxPeers) continue;
    peers.sort((a, b) => String(d[a]).localeCompare(String(d[b])));
    for (const peer of peers.slice(0, peers.length - maxPeers)) delete d[peer];
    changed = true;
  }
  return changed;
}

function _parseMaybe (raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Store façade over Hub Filesystem (`readFile` / `publish`, `writeFile` when present).
 *
 * Documents are cached in memory after the first read, so delivery marks don't
 * re-read the file. With `flushMs` > 0, delivery marks are coalesced: every
 * such `put` within the window lands in one compact write per contract (call
 * `flush()` on stop). A `put` that adds a frame is written at once, so a crash
 * can lose a delivery mark (the frame is sent again) but never a frame.
 * @param {{ readFile: Function, publish: Function, writeFile: (Function|undefined) }} fs
 * @param {{ root: (string|undefined), flushMs: (number|undefined), maxBytes: (number|undefined), maxDeliveredPeers: (number|undefined) }} [opts]
 * @returns {{ get: Function, put: Function, listContractIds: Function, flush: Function }}
 */
function createFilesystemStore (fs, opts = {}) {
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.publish !== 'function') {
    throw new TypeError('createFilesystemStore requires Hub Filesystem');
  }
  const root = opts.root != null ? String(opts.root) : FS_ROOT;
  const flushMs = Number(opts.flushMs) > 0 ? Number(opts.flushMs) : 0;
  const limits = { maxBytes: opts.maxBytes, maxDeliveredPeers: opts.maxDeliveredPeers };
  const cache = new Map();
  const dirty = new Set();
  // Frame hashes each contract's document held when it was last read or written.
  const stored = new Map();
  let index = null;
  let timer = null;

  function indexPath () {
    return root === FS_ROOT ? INDEX_PATH : `${root}/INDEX.json`;
  }

  function docPath (id) {
    return `${root}/${String(id).toLowerCase()}.json`;
  }

  function publish (path, value) {
    const pending = fs.publish(path, value);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }

  function hashesOf (value) {
    return new Set(((value && value.entries) || []).map((e) => e && e.hash).filter(Boolean));
  }

  function writeDoc (key, value) {
    if (typeof fs.writeFile === 'function') fs.writeFile(docPath(key), JSON.stringify(value));
    else publish(docPath(key), value);
    stored.set(key, hashesOf(value));
  }

  function flush () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const key of dirty) {
      const value = cache.get(key);
      if (value) writeDoc(key, value);
    }
    dirty.clear();
  }

  function markDirty (key) {
    const value = cache.get(key);
    const known = stored.get(key);
    const added = !known || ((value && value.entries) || []).some((e) => e && e.hash && !known.has(e.hash));
    if (!flushMs || added) {
      dirty.delete(key);
      writeDoc(key, value);
      return;
    }
    dirty.add(key);
    if (timer) return;
    timer = setTimeout(flush, flushMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function readIndex () {
    if (!index) {
      const parsed = _parseMaybe(fs.readFile(indexPath()));
      const contracts = parsed && Array.isArray(parsed.contracts) ? parsed.contracts.map(String) : [];
      index = Array.from(new Set(contracts.map((c) => c.toLowerCase()))).sort();
    }
    return { contracts: index.slice() };
  }

  function writeIndex (contracts) {
    const list = Array.from(new Set((contracts || []).map((c) => String(c).toLowerCase()))).sort();
    publish(indexPath(), {
      version: 1,
      contracts: list,
      updatedAt: new Date().toISOString()
    });
    index = list;
    return list;
  }

  return {
    get (collection, id) {
      if (collection !== core.COLLECTION) return null;
      const key = String(id).toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const parsed = _parseMaybe(fs.readFile(docPath(key)));
      if (!parsed || typeof parsed !== 'object') return parsed;
      cache.set(key, parsed);
      stored.set(key, hashesOf(parsed));
      if (fitQueueDoc(parsed, limits)) markDirty(key);
      return parsed;
    },
    put (collection, id, value) {
      if (collection !== core.COLLECTION) return value;
      const key = String(id).toLowerCase();
      fitQueueDoc(value, limits);
      cache.set(key, value);
      markDirty(key);
      const idx = readIndex();
      if (!idx.contracts.includes(key)) {
        writeIndex(idx.contracts.concat([key]));
      }
      return value;
    },
    listContractIds () {
      return readIndex().contracts;
    },
    flush,
    _readIndex: readIndex,
    _writeIndex: writeIndex
  };
}

/**
 * Enqueue + refresh index.
 * @param {{ get: Function, put: Function, listContractIds?: Function }} store
 * @param {string} contractId
 * @param {Buffer|string} bufferOrPaste
 * @param {object} [meta]
 * @returns {object}
 */
function enqueue (store, contractId, bufferOrPaste, meta) {
  return core.enqueueMessageBuffer(store, contractId, bufferOrPaste, meta);
}

module.exports = {
  FS_ROOT,
  INDEX_PATH,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_DELIVERED_PEERS,
  MAILBOX_PREFIX,
  mailboxKey,
  fitQueueDoc,
  createFilesystemStore,
  enqueue,
  COLLECTION: core.COLLECTION,
  DEFAULT_MAX_ENTRIES: core.DEFAULT_MAX_ENTRIES,
  ABSOLUTE_MAX_ENTRIES: core.ABSOLUTE_MAX_ENTRIES,
  clampMaxEntries: core.clampMaxEntries,
  loadQueueDoc: core.loadQueueDoc,
  listQueuedMessages: core.listQueuedMessages,
  pendingForDelivery: core.pendingForDelivery,
  markDelivered: core.markDelivered,
  entryHexList: core.entryHexList,
  createMemoryStore: core.createMemoryStore,
  enqueueMessageBuffer: core.enqueueMessageBuffer
};
