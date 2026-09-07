'use strict';

/**
 * Bridge toasts untyped Hub JSONCallResult `{ status: 'error', message }` (header "Hub").
 * Background inventory / chat probes against known or WebRTC-only rows that have no
 * Fabric TCP session return `peer not connected` — expected, not an operator alert.
 */

/**
 * @param {unknown} message
 * @returns {string}
 */
function normalizeHubRpcErrorMessage (message) {
  return String(message || '').trim().toLowerCase();
}

const QUIET_HUB_RPC_ERROR_MESSAGES = new Set([
  'peer not connected'
]);

/**
 * @param {unknown} message
 * @returns {boolean}
 */
function isQuietHubRpcErrorMessage (message) {
  return QUIET_HUB_RPC_ERROR_MESSAGES.has(normalizeHubRpcErrorMessage(message));
}

/**
 * Whether Bridge should raise a toast for a JSONCallResult payload.
 * @param {object|null|undefined} result
 * @returns {boolean}
 */
function shouldToastHubJsonCallError (result) {
  if (!result || typeof result !== 'object') return false;
  if (result.status !== 'error') return false;
  if (typeof result.message !== 'string' || !result.message.trim()) return false;
  if (result.type) return false;
  if (result.documentId != null || result.contractId != null) return false;
  if (isQuietHubRpcErrorMessage(result.message)) return false;
  return true;
}

/**
 * Live Fabric TCP session (not a WebRTC signaling / mesh-only registry row).
 * @param {object|null|undefined} peer GetNetworkStatus peer row
 * @returns {boolean}
 */
function isFabricTcpConnectedPeer (peer) {
  if (!peer || typeof peer !== 'object') return false;
  if (String(peer.status || '') !== 'connected') return false;
  const addr = peer.address != null ? String(peer.address) : '';
  if (/^webrtc:/i.test(addr)) return false;
  const id = peer.id != null ? String(peer.id) : '';
  if (/^webrtc:/i.test(id)) return false;
  const meta = peer.metadata && typeof peer.metadata === 'object' ? peer.metadata : null;
  if (meta && String(meta.transport || '').toLowerCase() === 'webrtc') return false;
  return true;
}

/**
 * Hub RequestPeerInventory hop for a connected TCP peer, or null to skip.
 * @param {object|null|undefined} peer
 * @returns {string|null}
 */
function fabricTcpInventoryTarget (peer) {
  if (!isFabricTcpConnectedPeer(peer)) return null;
  const id = peer.id != null ? String(peer.id).trim() : '';
  const addr = peer.address != null ? String(peer.address).trim() : '';
  if (id) return id;
  if (addr) return addr;
  return null;
}

/**
 * Signaling id for a `webrtc:<id>` hop (PeerView / inventory), or null.
 * @param {unknown} idOrAddress
 * @returns {string|null}
 */
function webrtcSignalingIdFromPeerHop (idOrAddress) {
  const hop = typeof idOrAddress === 'object' && idOrAddress
    ? (idOrAddress.address || idOrAddress.id)
    : idOrAddress;
  const hopStr = hop != null ? String(hop).trim() : '';
  if (!/^webrtc:/i.test(hopStr)) return null;
  const signalingId = hopStr.slice(hopStr.indexOf(':') + 1).trim();
  return signalingId || null;
}

module.exports = {
  fabricTcpInventoryTarget,
  isFabricTcpConnectedPeer,
  isQuietHubRpcErrorMessage,
  shouldToastHubJsonCallError,
  webrtcSignalingIdFromPeerHop
};
