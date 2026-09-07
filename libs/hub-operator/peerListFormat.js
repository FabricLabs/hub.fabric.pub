'use strict';

/**
 * Peer list display helpers (Codacy-ignored under libs/hub-operator).
 */

const PEER_BYTE_KIB = 1024;
const PEER_BYTE_MIB = PEER_BYTE_KIB * 1024;
const PEER_BYTE_GIB = PEER_BYTE_MIB * 1024;

function formatPeerBytes (n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < PEER_BYTE_KIB) return `${Math.round(v)} B`;
  if (v < PEER_BYTE_MIB) return `${(v / PEER_BYTE_KIB).toFixed(1)} KiB`;
  if (v < PEER_BYTE_GIB) return `${(v / PEER_BYTE_MIB).toFixed(2)} MiB`;
  return `${(v / PEER_BYTE_GIB).toFixed(2)} GiB`;
}

function inventoryDocCountForFabricPeer (globalPeers, fabricId) {
  if (!globalPeers || typeof globalPeers !== 'object' || !fabricId) return null;
  const fid = String(fabricId).trim();
  for (const [key, ex] of Object.entries(globalPeers)) {
    if (!ex || typeof ex !== 'object') continue;
    const idMatch = String(key) === fid || String(ex.id || '') === fid;
    if (!idMatch) continue;
    if (ex.inventory && Array.isArray(ex.inventory.documents)) {
      return ex.inventory.documents.length;
    }
  }
  return null;
}

module.exports = {
  formatPeerBytes,
  inventoryDocCountForFabricPeer,
  PEER_BYTE_KIB,
  PEER_BYTE_MIB,
  PEER_BYTE_GIB
};
