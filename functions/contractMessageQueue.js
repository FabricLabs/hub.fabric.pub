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
 * Store façade over Hub Filesystem (`readFile` / `publish`).
 * @param {{ readFile: Function, publish: Function }} fs
 * @param {{ root?: string }} [opts]
 * @returns {{ get: Function, put: Function, listContractIds: Function }}
 */
function createFilesystemStore (fs, opts = {}) {
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.publish !== 'function') {
    throw new TypeError('createFilesystemStore requires Hub Filesystem');
  }
  const root = opts.root != null ? String(opts.root) : FS_ROOT;

  function indexPath () {
    return root === FS_ROOT ? INDEX_PATH : `${root}/INDEX.json`;
  }

  function docPath (id) {
    return `${root}/${String(id).toLowerCase()}.json`;
  }

  function readIndex () {
    const parsed = _parseMaybe(fs.readFile(indexPath()));
    const contracts = parsed && Array.isArray(parsed.contracts) ? parsed.contracts.map(String) : [];
    return { contracts: Array.from(new Set(contracts.map((c) => c.toLowerCase()))).sort() };
  }

  function writeIndex (contracts) {
    const list = Array.from(new Set((contracts || []).map((c) => String(c).toLowerCase()))).sort();
    fs.publish(indexPath(), {
      version: 1,
      contracts: list,
      updatedAt: new Date().toISOString()
    });
    return list;
  }

  return {
    get (collection, id) {
      if (collection !== core.COLLECTION) return null;
      return _parseMaybe(fs.readFile(docPath(id)));
    },
    put (collection, id, value) {
      if (collection !== core.COLLECTION) return value;
      fs.publish(docPath(id), value);
      const idx = readIndex();
      if (!idx.contracts.includes(String(id).toLowerCase())) {
        writeIndex(idx.contracts.concat([id]));
      }
      return value;
    },
    listContractIds () {
      return readIndex().contracts;
    },
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
