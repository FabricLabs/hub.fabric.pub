'use strict';

/**
 * Document-offer envelope types — `@fabric/core` publishedDocumentEnvelope
 * (offer aliases live on that module; no separate core file).
 */

const core = require('@fabric/core/functions/publishedDocumentEnvelope');

/**
 * First-class AMP opcode for a document-inventory JSON `type`. Core Peer drops
 * `INVENTORY_REQUEST` / `INVENTORY_RESPONSE` (and Fabric aliases) when they
 * arrive on GenericMessage (`isFirstClassOpcodeOnlyType`).
 *
 * @param {unknown} type
 * @returns {string|null} `P2P_INVENTORY_REQUEST`, `P2P_INVENTORY_RESPONSE`, or null
 */
function firstClassInventoryWireType (type) {
  const t = typeof type === 'string' ? type.trim() : '';
  if (!t) return null;
  if (core.isDocumentInventoryRequestType(t)) return 'P2P_INVENTORY_REQUEST';
  if (core.isDocumentInventoryResponseType(t)) return 'P2P_INVENTORY_RESPONSE';
  return null;
}

module.exports = {
  FABRIC_DOCUMENT_OFFER: core.FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_REQUEST: core.FABRIC_DOCUMENT_OFFER_REQUEST,
  FABRIC_DOCUMENT_OFFER_RESPONSE: core.FABRIC_DOCUMENT_OFFER_RESPONSE,
  FABRIC_DOCUMENT_OFFER_REPLY: core.FABRIC_DOCUMENT_OFFER_REPLY,
  TO_LEGACY_INVENTORY: core.TO_LEGACY_INVENTORY,
  fabricDocumentOfferEnvelopeToLegacy: core.fabricDocumentOfferEnvelopeToLegacy,
  normalizeFabricDocumentOfferEnvelopeForHandlers: core.normalizeFabricDocumentOfferEnvelopeForHandlers,
  isDocumentInventoryRequestType: core.isDocumentInventoryRequestType,
  isDocumentInventoryResponseType: core.isDocumentInventoryResponseType,
  isDocumentInventoryDocumentsOfferResponse: core.isDocumentInventoryDocumentsOfferResponse,
  firstClassInventoryWireType
};
