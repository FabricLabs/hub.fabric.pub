'use strict';

/**
 * PSBT helpers for contract proposals, Payjoin, and HTLC flows (bitcoinjs-lib v6).
 * Does not initialize ECC; signing callers must use the same ecc as elsewhere.
 *
 * Unsigned builders sort vin/vout with BIP-69 (`sortPsbtInputBags` /
 * `sortPsbtOutputBags`) before the first signature. Do not reorder a PSBT
 * that already has partial signatures (Payjoin ACP appends at the end).
 */

const bitcoin = require('bitcoinjs-lib');
const { sortInputs, sortOutputs } = require('@fabric/core/functions/bip69');

function assertString (label, v) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} is required.`);
  return v.trim();
}

function psbtFromBase64 (base64) {
  return bitcoin.Psbt.fromBase64(assertString('PSBT base64', base64));
}

function psbtToBase64 (psbt) {
  if (!psbt || typeof psbt.toBase64 !== 'function') throw new Error('Invalid PSBT instance.');
  return psbt.toBase64();
}

/**
 * BIP174 combine: first PSBT wins on conflicts.
 * @param {string[]} base64List non-empty
 * @returns {string} combined PSBT base64
 */
function combinePsbtBase64 (base64List) {
  if (!Array.isArray(base64List) || base64List.length === 0) {
    throw new Error('combinePsbtBase64: need at least one PSBT.');
  }
  let psbt = psbtFromBase64(base64List[0]);
  for (let i = 1; i < base64List.length; i++) {
    psbt = psbt.combine(psbtFromBase64(base64List[i]));
  }
  return psbt.toBase64();
}

function extractTransactionHex (psbt) {
  const p = psbt instanceof bitcoin.Psbt ? psbt : psbtFromBase64(psbt);
  return p.extractTransaction().toHex();
}

function extractTransactionId (psbt) {
  const p = psbt instanceof bitcoin.Psbt ? psbt : psbtFromBase64(psbt);
  return p.extractTransaction().getId();
}

/**
 * BIP-69 sort of bitcoinjs `addInput` bags. Extra PSBT fields travel with the row.
 * Hex `hash` is treated as a display txid (bitcoinjs-lib convention).
 *
 * @param {Array<Object>} inputs
 * @returns {Array<Object>}
 */
function sortPsbtInputBags (inputs) {
  if (!Array.isArray(inputs)) throw new TypeError('inputs must be an array');
  const rows = inputs.map((row) => {
    const out = Object.assign({}, row);
    if (out.txid == null && typeof out.hash === 'string') out.txid = out.hash;
    if (out.vout == null && out.index != null) out.vout = out.index;
    if (out.index == null && out.vout != null) out.index = out.vout;
    if (typeof out.hash === 'string') out.hashIsDisplay = true;
    return out;
  });
  return sortInputs(rows);
}

/**
 * BIP-69 sort of bitcoinjs `addOutput` bags. `address` is converted to
 * scriptPubKey for comparison; the original address is kept.
 *
 * @param {Array<Object>} outputs
 * @param {Object} network bitcoinjs network
 * @returns {Array<Object>}
 */
function sortPsbtOutputBags (outputs, network) {
  if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array');
  const rows = outputs.map((row) => {
    const out = Object.assign({}, row);
    if (out.script == null && out.address) {
      out.script = Buffer.from(bitcoin.address.toOutputScript(String(out.address).trim(), network));
    } else if (out.script && !Buffer.isBuffer(out.script)) {
      out.script = Buffer.from(out.script);
    }
    return out;
  });
  return sortOutputs(rows);
}

/**
 * @returns {{ inputCount: number, outputCount: number, unsignedTxid?: string }}
 */
function describePsbt (base64) {
  const psbt = psbtFromBase64(base64);
  const tx = psbt.data.globalMap.unsignedTx;
  const unsignedTxid = tx && typeof tx.getId === 'function' ? tx.getId() : undefined;
  return {
    inputCount: psbt.data.inputs.length,
    outputCount: psbt.data.outputs.length,
    unsignedTxid
  };
}

module.exports = {
  psbtFromBase64,
  psbtToBase64,
  combinePsbtBase64,
  extractTransactionHex,
  extractTransactionId,
  describePsbt,
  sortPsbtInputBags,
  sortPsbtOutputBags
};
