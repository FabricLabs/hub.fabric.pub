'use strict';

const crypto = require('crypto');
const DistributedExecution = require('./fabricDistributedExecution');

/**
 * Immutable subset of Bitcoin Core `getblock` (verbosity 2) for Fabric Document identity + storage.
 *
 * Excludes RPC / index fields that can change without a new block (`confirmations`, `nextblockhash`),
 * derived duplicates (`nTx`, `versionHex` vs `version`, `difficulty`, `chainwork`, `size`, `weight`,
 * `strippedsize`), so document id and `DocumentPublish` / inventory preimage stay stable.
 *
 * @param {object} block — `getblock` JSON
 * @param {string|null} networkName
 * @returns {object}
 */
function buildBitcoinBlockSummary (block, networkName) {
  const b = block && typeof block === 'object' ? block : {};
  const txs = Array.isArray(b.tx) ? b.tx : [];
  const txids = txs.map((t) => (typeof t === 'string' ? t : (t && t.txid) || '')).filter(Boolean);
  return {
    type: 'BitcoinBlock',
    schemaVersion: 3,
    network: networkName != null ? String(networkName) : null,
    hash: b.hash != null ? String(b.hash) : '',
    height: b.height != null ? Number(b.height) : null,
    version: b.version != null ? Number(b.version) : null,
    merkleroot: b.merkleroot != null ? String(b.merkleroot) : null,
    time: b.time != null ? Number(b.time) : null,
    mediantime: b.mediantime != null ? Number(b.mediantime) : null,
    nonce: b.nonce != null ? Number(b.nonce) : null,
    bits: b.bits != null ? String(b.bits) : null,
    previousblockhash: b.previousblockhash != null ? String(b.previousblockhash) : null,
    txids
  };
}

/**
 * UTF-8 bytes for the document body (stable key order for deterministic document id).
 * @param {object} block
 * @param {string|null} networkName
 * @returns {Buffer}
 */
function bitcoinBlockDocumentBuffer (block, networkName) {
  const summary = buildBitcoinBlockSummary(block, networkName);
  const body = DistributedExecution.stableStringify(summary);
  return Buffer.from(body, 'utf8');
}

/**
 * Document id (sha256 of stable JSON body), matching CreateDocument conventions.
 * @param {object} block
 * @param {string|null} networkName
 * @returns {string} 64-char hex
 */
function bitcoinBlockDocumentId (block, networkName) {
  const buf = bitcoinBlockDocumentBuffer(block, networkName);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = {
  buildBitcoinBlockSummary,
  bitcoinBlockDocumentBuffer,
  bitcoinBlockDocumentId
};
