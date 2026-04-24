'use strict';

/**
 * Pure helpers for relayed P2P_FILE_SEND (HTLC phase 2). Used by Hub and unit tests.
 */

/**
 * @param {Object} obj - P2P_FILE_SEND message object
 * @param {string} myFabricId - This node's Fabric identity id
 * @returns {boolean} True if this hop should forward toward deliveryFabricId, not ingest.
 */
function shouldForwardP2pFileChunk (obj, myFabricId) {
  const deliveryFabricId = obj && obj.deliveryFabricId != null ? String(obj.deliveryFabricId).trim() : '';
  const mine = myFabricId != null ? String(myFabricId).trim() : '';
  return !!(deliveryFabricId && mine && deliveryFabricId !== mine);
}

/**
 * @param {Object} obj - message object with fileRelayTtl
 * @param {number} [maxTtl=16] - clamp inbound TTL
 * @returns {number|null} TTL for the next hop (current clamped minus 1); null if this hop must not forward
 */
function decrementedFileRelayTtl (obj, maxTtl = 16) {
  let ttl = Number(obj && obj.fileRelayTtl);
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  ttl = Math.min(maxTtl, Math.round(ttl));
  return ttl - 1;
}

module.exports = {
  shouldForwardP2pFileChunk,
  decrementedFileRelayTtl
};
