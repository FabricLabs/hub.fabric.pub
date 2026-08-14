'use strict';

/**
 * Document-offer envelope types — `@fabric/core` publishedDocumentEnvelope
 * (offer aliases live on that module; no separate core file).
 */

const core = require('@fabric/core/functions/publishedDocumentEnvelope');

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
  isDocumentInventoryDocumentsOfferResponse: core.isDocumentInventoryDocumentsOfferResponse
};
