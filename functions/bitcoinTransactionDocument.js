'use strict';

const crypto = require('crypto');
const DistributedExecution = require('./fabricDistributedExecution');

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/**
 * Canonical Fabric document body for a mined transaction: **consensus serialization only**
 * (`hex` from Bitcoin Core `getblock` verbosity 2). No fee, decoded vin/vout, or block pointers —
 * those are mutable or redundant and would split preimage / document id across fetches.
 *
 * Block hash / height remain on hub `collections.documents` metadata for prune logic only.
 *
 * @param {object} tx — verbose `tx` object from `getblock` … 2
 * @param {string|null|undefined} _blockHash — unused for canonical body (metadata only)
 * @param {number|null|undefined} _blockHeight — unused for canonical body
 * @param {string|null|undefined} networkName
 * @returns {object|null}
 */
function buildBitcoinTransactionSummary (tx, _blockHash, _blockHeight, networkName) {
  const t = tx && typeof tx === 'object' ? tx : {};
  const hexRaw = t.hex != null ? String(t.hex).replace(/\s+/g, '') : '';
  const hex = hexRaw.toLowerCase();
  if (!hex || !/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    return null;
  }
  return {
    type: 'BitcoinTransaction',
    schemaVersion: 3,
    network: networkName != null ? String(networkName) : null,
    hex
  };
}

/**
 * @returns {Buffer|null}
 */
function bitcoinTransactionDocumentBuffer (tx, blockHash, blockHeight, networkName) {
  const summary = buildBitcoinTransactionSummary(tx, blockHash, blockHeight, networkName);
  if (!summary) return null;
  const body = DistributedExecution.stableStringify(summary);
  const buf = Buffer.from(body, 'utf8');
  if (buf.length > MAX_DOCUMENT_BYTES) return null;
  return buf;
}

/**
 * @returns {string|null} 64-char hex, or null if `hex` missing / invalid / oversize
 */
function bitcoinTransactionDocumentId (tx, blockHash, blockHeight, networkName) {
  const buf = bitcoinTransactionDocumentBuffer(tx, blockHash, blockHeight, networkName);
  if (!buf) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = {
  buildBitcoinTransactionSummary,
  bitcoinTransactionDocumentBuffer,
  bitcoinTransactionDocumentId
};
