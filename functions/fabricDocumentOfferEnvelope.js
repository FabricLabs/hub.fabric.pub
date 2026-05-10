'use strict';

/**
 * Canonical document-offer types and normalization live in `@fabric/core/functions/fabricDocumentOfferEnvelope`.
 * Hub adds inventory predicate helpers (`isDocumentInventory*`) for `services/hub.js` / `Bridge.js`.
 */

const core = require('@fabric/core/functions/fabricDocumentOfferEnvelope');

const {
  FABRIC_DOCUMENT_OFFER,
  FABRIC_DOCUMENT_OFFER_REQUEST,
  FABRIC_DOCUMENT_OFFER_RESPONSE,
  FABRIC_DOCUMENT_OFFER_REPLY
} = core;

function isDocumentInventoryRequestType (type) {
  const t = typeof type === 'string' ? type.trim() : '';
  return t === 'INVENTORY_REQUEST' || t === FABRIC_DOCUMENT_OFFER || t === FABRIC_DOCUMENT_OFFER_REQUEST;
}

function isDocumentInventoryResponseType (type) {
  const t = typeof type === 'string' ? type.trim() : '';
  return t === 'INVENTORY_RESPONSE' || t === FABRIC_DOCUMENT_OFFER_RESPONSE || t === FABRIC_DOCUMENT_OFFER_REPLY;
}

/** Bridge / hub: merge `documents` inventory when inner JSON matches this shape. */
function isDocumentInventoryDocumentsOfferResponse (parsed) {
  return !!(parsed && parsed.object && String(parsed.object.kind || '').trim().toLowerCase() === 'documents' &&
    isDocumentInventoryResponseType(parsed.type));
}

module.exports = {
  ...core,
  isDocumentInventoryRequestType,
  isDocumentInventoryResponseType,
  isDocumentInventoryDocumentsOfferResponse
};
