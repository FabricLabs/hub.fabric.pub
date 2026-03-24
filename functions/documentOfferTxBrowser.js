'use strict';

/**
 * Browser (or Node): sign document-offer Taproot PSBTs with a local secp256k1 key.
 * Used with Hub-prepared PSBT base64 from PrepareDocumentOffer* RPCs.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const inventoryHtlc = require('./inventoryHtlc');

bitcoin.initEccLib(ecc);

function parsePriv32 (privHexOrBuf) {
  if (Buffer.isBuffer(privHexOrBuf)) {
    if (privHexOrBuf.length !== 32) throw new Error('Private key must be 32 bytes.');
    return privHexOrBuf;
  }
  const h = String(privHexOrBuf || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error('Private key must be 64 hex characters.');
  return Buffer.from(h, 'hex');
}

function parsePreimage32 (preimageHex) {
  const h = String(preimageHex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error('preimage must be 64 hex characters (32 bytes).');
  return Buffer.from(h, 'hex');
}

/**
 * @param {string} psbtBase64
 * @param {string} preimageHex
 * @param {string|Buffer} delivererPrivHexOrBuf
 */
function signDelivererClaimFromPsbtBase64 (psbtBase64, preimageHex, delivererPrivHexOrBuf) {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim());
  const preimage32 = parsePreimage32(preimageHex);
  const priv = parsePriv32(delivererPrivHexOrBuf);
  return inventoryHtlc.signAndExtractInventoryHtlcSellerClaim({ psbt, preimage32 }, priv);
}

/**
 * @param {string} psbtBase64
 * @param {string|Buffer} initiatorPrivHexOrBuf
 */
function signInitiatorRefundFromPsbtBase64 (psbtBase64, initiatorPrivHexOrBuf) {
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim());
  const priv = parsePriv32(initiatorPrivHexOrBuf);
  return inventoryHtlc.signAndExtractInventoryHtlcBuyerRefund({ psbt }, priv);
}

module.exports = {
  signDelivererClaimFromPsbtBase64,
  signInitiatorRefundFromPsbtBase64
};
