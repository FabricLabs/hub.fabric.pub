'use strict';

/**
 * HTTP 402 helpers for **Fabric document exchange** (offer/response + L1 settlement)
 * aligned with `@fabric/core` FABRIC_DOCUMENT_OFFER envelopes, plus optional **L402** surface.
 *
 * Canonical copy lives in `fabric-http`; some `@fabric/http` npm builds omit this file while
 * `sendPaymentRequired402Response.js` still requires it — hub overlays via `patchLinkedFabricNodePath.js`.
 *
 * @module functions/fabricDocumentPayment402
 */

/** Response header carrying payment + document-protocol hints (browser extension auto-pay). Value is base64url(UTF-8 JSON). */
const FABRIC_PAYMENT_REQUEST_HEADER = 'X-Fabric-Payment-Request';

/**
 * Wire-safe header value: {@link buildFabricDocumentPaymentRequestHeader} output, UTF-8 → base64url (HTTP header safe).
 * @param {string} jsonUtf8
 * @returns {string}
 */
function encodeFabricPaymentRequestHeaderValue (jsonUtf8) {
  return Buffer.from(jsonUtf8, 'utf8').toString('base64url');
}

/**
 * @param {string} encoded from {@link encodeFabricPaymentRequestHeaderValue}
 * @returns {string} UTF-8 JSON
 */
function decodeFabricPaymentRequestHeaderValue (encoded) {
  return Buffer.from(String(encoded || '').trim(), 'base64url').toString('utf8');
}

/** @param {unknown} inv */
function extractBolt11 (inv) {
  if (!inv || typeof inv !== 'object') return '';
  const raw = inv.payment_request || inv.paymentRequest || inv.bolt11 || inv.bolt11_invoice;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Public invoice subset for headers / JSON (avoid logging secrets). */
function invoiceSummary (inv) {
  if (!inv || typeof inv !== 'object') return null;
  const bolt11 = extractBolt11(inv);
  const out = {
    ...(inv.id != null ? { id: String(inv.id) } : {}),
    ...(inv.amount != null ? { amount: inv.amount } : {}),
    ...(inv.currency != null ? { currency: String(inv.currency) } : {}),
    ...(bolt11 ? { bolt11 } : {})
  };
  const memo = inv.memo || inv.description;
  if (typeof memo === 'string' && memo.length) out.memo = memo.slice(0, 2048);
  return Object.keys(out).length ? out : null;
}

/**
 * JSON string for {@link FABRIC_PAYMENT_REQUEST_HEADER}: machine-readable payment + Fabric document-offer linkage.
 *
 * @param {object} [opts]
 * @param {object} [opts.invoice] return value from `bitcoin.createInvoice`
 * @param {string} [opts.requestPath] HTTP path challenged
 * @param {string} [opts.detail] human reason (truncated)
 * @param {object|null} [opts.documentOffer] optional `{ documentId?, contentHashHex?, purchasePriceSats?, network? }`
 */
function buildFabricDocumentPaymentRequestHeader (opts = {}) {
  const { invoice, requestPath = '', detail = '', documentOffer = null } = opts;

  /** @type {Record<string, unknown>} */
  const payload = {
    v: 1,
    scheme: 'fabric-http-document-payment',
    headerTransport: 'base64url.v1+json-utf8',
    documentExchange: {
      offerType: 'FABRIC_DOCUMENT_OFFER',
      responseType: 'FABRIC_DOCUMENT_OFFER_RESPONSE',
      inventoryWireOpcodes: {
        request: 'P2P_INVENTORY_REQUEST',
        response: 'P2P_INVENTORY_RESPONSE'
      },
      specification: '@fabric/core — docs/FABRIC_DOCUMENT_OFFER.md'
    },
    path: typeof requestPath === 'string' ? requestPath : ''
  };

  if (detail) payload.detail = String(detail).slice(0, 4096);

  const summary = invoiceSummary(invoice);
  if (summary) payload.invoice = summary;

  const doc = documentOffer && typeof documentOffer === 'object' ? documentOffer : null;
  if (doc && (doc.documentId || doc.contentHashHex || doc.purchasePriceSats != null || doc.network)) {
    payload.documentOffer = {};
    if (doc.documentId != null) payload.documentOffer.documentId = String(doc.documentId).slice(0, 4096);
    if (doc.contentHashHex != null) payload.documentOffer.contentHashHex = String(doc.contentHashHex).slice(0, 128);
    if (doc.purchasePriceSats != null && Number.isFinite(Number(doc.purchasePriceSats))) {
      payload.documentOffer.purchasePriceSats = Math.round(Number(doc.purchasePriceSats));
    }
    if (doc.network != null) payload.documentOffer.network = String(doc.network).slice(0, 64);
  }

  return JSON.stringify(payload);
}

/**
 * Quote a param value for `WWW-Authenticate: L402 …` (escape `\` and `"`).
 * @param {string} s
 */
function escapeL402ParamValue (s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Lightning Labs L402-style challenge (`invoice` required; `macaroon` optional for partial interop).
 * @param {{ bolt11?: string, macaroonBase64?: string|null }} opts
 * @returns {string} Header value starting with `L402 …`, or '' if no invoice
 */
function buildLightningL402WwwAuthenticate (opts = {}) {
  const bolt11 = typeof opts.bolt11 === 'string' ? opts.bolt11.trim() : '';
  if (!bolt11) return '';

  const parts = [];
  const mac = typeof opts.macaroonBase64 === 'string' ? opts.macaroonBase64.trim() : '';
  if (mac) parts.push(`macaroon="${escapeL402ParamValue(mac)}"`);
  parts.push(`invoice="${escapeL402ParamValue(bolt11)}"`);
  return `L402 ${parts.join(', ')}`;
}

module.exports = {
  FABRIC_PAYMENT_REQUEST_HEADER,
  buildFabricDocumentPaymentRequestHeader,
  encodeFabricPaymentRequestHeaderValue,
  decodeFabricPaymentRequestHeaderValue,
  buildLightningL402WwwAuthenticate,
  extractBolt11,
  invoiceSummary
};
