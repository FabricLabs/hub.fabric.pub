'use strict';

/**
 * Pure message builders for mutual device-link (browser-safe).
 * Keep free of Node built-ins and Hub HTTP so webpack can include this in the SPA.
 */

const DEVICE_LINK_PREFIX = 'fabric:device-link:1';

/**
 * Canonical mutual-link message both parties BIP340-sign.
 * @param {string} nonce 64-hex
 * @param {string} initiatorId Fabric Identity.id
 * @param {string} responderId
 * @param {string} label
 */
function buildDeviceLinkMessage (nonce, initiatorId, responderId, label) {
  const safeLabel = String(label || 'device').replace(/:/g, '-').slice(0, 64);
  return `${DEVICE_LINK_PREFIX}:${nonce}:${initiatorId}:${responderId}:${safeLabel}`;
}

/**
 * Offer preamble the initiator signs when creating a pending link.
 * Format: fabric:device-link:1:offer:<nonce>:<initiatorId>:<label>:<origin>
 */
function buildDeviceLinkOfferMessage (nonce, initiatorId, label, origin) {
  const safeLabel = String(label || 'device').replace(/:/g, '-').slice(0, 64);
  return `${DEVICE_LINK_PREFIX}:offer:${nonce}:${initiatorId}:${safeLabel}:${origin}`;
}

function parseDeviceLinkMessage (msg) {
  const prefix = `${DEVICE_LINK_PREFIX}:`;
  const s = String(msg || '');
  if (!s.startsWith(prefix)) return null;
  const rest = s.slice(prefix.length);
  if (rest.startsWith('offer:')) return null;
  const nonce = rest.slice(0, 64);
  if (!/^[a-f0-9]{64}$/i.test(nonce) || rest[64] !== ':') return null;
  const after = rest.slice(65);
  const parts = after.split(':');
  if (parts.length < 3) return null;
  const initiatorId = parts[0];
  const responderId = parts[1];
  const label = parts.slice(2).join(':');
  if (!initiatorId || !responderId) return null;
  return { nonce, initiatorId, responderId, label };
}

module.exports = {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage
};
