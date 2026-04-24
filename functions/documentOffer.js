'use strict';

const { DOCUMENT_OFFER } = require('./messageTypes');

/**
 * L1-funded document delivery reward offers on logical sidechain `content.documentOffers`,
 * signaled with {@link DOCUMENT_OFFER} (see `components/SidechainHome.js`).
 *
 * On-chain escrow uses the same P2TR two-leaf HTLC as inventory (`functions/inventoryHtlc.js`):
 * **deliverer** = seller leaf (hashlock + deliverer Schnorr); **initiator** = buyer leaf (CLTV + initiator Schnorr).
 * Phases advance via RFC6902 patches; `revealedPreimageHex` is published only after delivery (claim path).
 */

/** @typedef {'proposed'|'funding_pending'|'funded'|'delivery_pending'|'delivered'|'settled'|'cancelled'} DocumentOfferPhase */

/**
 * @param {object} o
 * @param {string} o.offerId
 * @param {string} o.documentId
 * @param {number} o.rewardSats
 * @param {string} o.initiatorFabricId
 * @param {string} [o.memo]
 * @returns {object}
 */
function createOfferRecord (o) {
  const offerId = String(o.offerId || '').trim();
  const documentId = String(o.documentId || '').trim();
  const initiatorFabricId = String(o.initiatorFabricId || '').trim();
  const rewardSats = Math.max(0, Math.floor(Number(o.rewardSats) || 0));
  const base = {
    kind: 'DocumentOffer',
    id: offerId,
    documentId,
    rewardSats,
    initiatorFabricId,
    memo: typeof o.memo === 'string' ? o.memo.slice(0, 2000) : '',
    phase: /** @type {DocumentOfferPhase} */ ('proposed'),
    createdAt: new Date().toISOString(),
    fundingTxid: null,
    fundingVout: null,
    escrowNote: null,
    /** P2TR receive address (document-offer escrow). */
    paymentAddress: null,
    paymentHashHex: null,
    claimScriptHex: null,
    refundScriptHex: null,
    delivererEscrowPubkeyHex: null,
    initiatorRefundPubkeyHex: null,
    refundLockHeight: null,
    delivererFabricId: null,
    deliveryProof: null,
    /** Set when initiator reveals the hash preimage on-chain settlement path (sidechain). */
    revealedPreimageHex: null,
    /** Claim (deliverer) or refund (initiator) txid after exit. */
    exitTxid: null,
    exitKind: null
  };
  const opt = (k, v) => {
    if (v !== undefined && v !== null && v !== '') base[k] = v;
  };
  opt('paymentAddress', o.paymentAddress);
  opt('paymentHashHex', o.paymentHashHex);
  opt('claimScriptHex', o.claimScriptHex);
  opt('refundScriptHex', o.refundScriptHex);
  opt('delivererEscrowPubkeyHex', o.delivererEscrowPubkeyHex);
  opt('initiatorRefundPubkeyHex', o.initiatorRefundPubkeyHex);
  if (o.refundLockHeight != null && Number.isFinite(Number(o.refundLockHeight))) {
    base.refundLockHeight = Math.floor(Number(o.refundLockHeight));
  }
  if (o.fundingTxid) base.fundingTxid = String(o.fundingTxid).trim();
  if (o.fundingVout != null && Number.isFinite(Number(o.fundingVout))) base.fundingVout = Math.floor(Number(o.fundingVout));
  if (o.revealedPreimageHex) base.revealedPreimageHex = String(o.revealedPreimageHex).trim().toLowerCase();
  if (o.exitTxid) base.exitTxid = String(o.exitTxid).trim();
  if (o.exitKind) base.exitKind = String(o.exitKind).trim();
  if (o.delivererFabricId) base.delivererFabricId = String(o.delivererFabricId).trim();
  if (o.phase) base.phase = /** @type {DocumentOfferPhase} */ (String(o.phase));
  return base;
}

/**
 * RFC6902 patches to insert or replace one offer under `content.documentOffers`.
 * @param {object} content - current sidechain `content` (from GetSidechainState).
 * @param {string} offerId
 * @param {ReturnType<typeof createOfferRecord>} record
 * @returns {object[]}
 */
function patchesForNewOffer (content, offerId, record) {
  const id = String(offerId || '').trim();
  if (!id || !record) return [];
  const c = content && typeof content === 'object' ? content : {};
  const offers = c.documentOffers && typeof c.documentOffers === 'object' ? c.documentOffers : null;
  if (!offers) {
    return [{ op: 'add', path: '/documentOffers', value: { [id]: record } }];
  }
  if (offers[id] !== undefined) {
    return [{ op: 'replace', path: `/documentOffers/${id}`, value: record }];
  }
  return [{ op: 'add', path: `/documentOffers/${id}`, value: record }];
}

/**
 * Merge-update one offer (test/demo): replace whole record is simplest for clients.
 * @param {string} offerId
 * @param {object} nextRecord
 */
function patchReplaceOffer (offerId, nextRecord) {
  const id = String(offerId || '').trim();
  if (!id || !nextRecord) return [];
  return [{ op: 'replace', path: `/documentOffers/${id}`, value: nextRecord }];
}

/**
 * GenericMessage / chat body: domain envelope.
 * @param {object} actor
 * @param {object} object
 */
function buildDocumentOfferEnvelope (actor, object) {
  return {
    type: DOCUMENT_OFFER,
    actor: actor && typeof actor === 'object' ? actor : {},
    object: object && typeof object === 'object' ? object : {}
  };
}

module.exports = {
  createOfferRecord,
  patchesForNewOffer,
  patchReplaceOffer,
  buildDocumentOfferEnvelope
};
