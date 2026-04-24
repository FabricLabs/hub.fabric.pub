'use strict';

/**
 * Reversible JSON payloads for hub ↔ browser messaging inside a Fabric
 * `GenericMessage` body (transitional carrier — see MESSAGE_TRANSPORT.md).
 * Prefer promoting `fabricType` to a dedicated outer `Message.type` in @fabric/core when stable.
 *
 * @see MESSAGE_TRANSPORT.md
 * @see functions/fabricMessageRegistry.js
 */

const SCHEMA = '@fabric/BridgeEnvelope';
const VERSION = 1;

/**
 * @param {string} fabricType - Stable type id (e.g. HubClientChat, HubClientInventory).
 * @param {Object} payload - JSON-serializable payload (round-trips).
 * @param {Object} [meta] - Optional metadata (transport hints, idempotency keys, etc.)
 * @returns {Object} Object to JSON.stringify into GenericMessage body.
 */
function createEnvelope (fabricType, payload = {}, meta = null) {
  const t = String(fabricType || '').trim();
  if (!t) throw new Error('fabricType required');
  return {
    [SCHEMA]: true,
    v: VERSION,
    fabricType: t,
    payload: payload && typeof payload === 'object' ? payload : {},
    ...(meta && typeof meta === 'object' ? { meta } : {})
  };
}

function tryParse (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value[SCHEMA] !== true) return null;
  const v = Number(value.v);
  if (!Number.isFinite(v) || v < 1) return null;
  const fabricType = String(value.fabricType || '').trim();
  if (!fabricType) return null;
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload
    : {};
  return {
    v,
    fabricType,
    payload,
    meta: value.meta && typeof value.meta === 'object' ? value.meta : undefined
  };
}

/** @returns {string} body for Message.fromVector(['GenericMessage', body]) */
function stringifyEnvelope (fabricType, payload, meta) {
  return JSON.stringify(createEnvelope(fabricType, payload, meta));
}

module.exports = {
  SCHEMA,
  VERSION,
  createEnvelope,
  tryParse,
  stringifyEnvelope
};
