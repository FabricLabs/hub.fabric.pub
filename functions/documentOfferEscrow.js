'use strict';

/**
 * @fileoverview Document-offer L1 escrow: the `@fabric/core` `Htlc` with roles
 * renamed. The deliverer claims with preimage + Schnorr (claim leaf); the
 * initiator refunds after the CLTV height (refund leaf).
 */

const Htlc = require('@fabric/core/types/htlc');

/**
 * @param {Object} opts
 * @param {string} [opts.networkName] e.g. regtest, mainnet (default regtest)
 * @param {string} opts.delivererPubkeyHex 33-byte compressed (claim path)
 * @param {string} opts.initiatorRefundPubkeyHex 33-byte compressed (refund path)
 * @param {string} opts.paymentHashHex SHA256(preimage), 32 bytes hex
 * @param {number} opts.refundLockHeight block height for the CLTV refund leg
 * @param {number} [opts.amountSats]
 * @param {string} [opts.label]
 * @returns {Object} `{ paymentAddress, claimScriptHex, refundScriptHex, paymentHashHex, amountBtc, bitcoinUri }`
 */
function buildDocumentOfferEscrow (opts = {}) {
  const htlc = new Htlc({
    network: opts.networkName || 'regtest',
    claimPubkey: String(opts.delivererPubkeyHex || ''),
    refundPubkey: String(opts.initiatorRefundPubkeyHex || ''),
    paymentHash: String(opts.paymentHashHex || ''),
    refundLocktime: Number(opts.refundLockHeight)
  });
  const hints = htlc.fundingHints({
    amountSats: Math.round(Number(opts.amountSats || 0)),
    label: String(opts.label || 'document-offer').slice(0, 120)
  });
  return {
    paymentAddress: htlc.address,
    claimScriptHex: htlc.claimScript.toString('hex'),
    refundScriptHex: htlc.refundScript.toString('hex'),
    paymentHashHex: htlc.paymentHashHex,
    amountBtc: hints.amountBtc,
    bitcoinUri: hints.bitcoinUri
  };
}

module.exports = { buildDocumentOfferEscrow };
