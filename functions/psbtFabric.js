'use strict';

/**
 * PSBT helpers for contract proposals, Payjoin, and HTLC flows (bitcoinjs-lib v6).
 * Does not initialize ECC; signing callers must use the same ecc as elsewhere.
 */

const bitcoin = require('bitcoinjs-lib');

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
  describePsbt
};
