'use strict';

/**
 * Flatten `globalState.peers[*].inventory.documents` into list rows for the Documents page.
 * CDN / HTML clients use this instead of Hub `publishedDocuments` when there is no local Hub.
 *
 * @param {object|null|undefined} peers
 * @returns {object[]}
 */
function collectInventoryDocuments (peers) {
  if (!peers || typeof peers !== 'object' || Array.isArray(peers)) return [];
  const byId = {};
  for (const peerKey of Object.keys(peers)) {
    const peer = peers[peerKey];
    if (!peer || typeof peer !== 'object') continue;
    const items = peer.inventory && Array.isArray(peer.inventory.documents)
      ? peer.inventory.documents
      : [];
    const peerId = peer.id != null ? String(peer.id) : String(peerKey);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id != null ? String(item.id) : (item.sha256 != null ? String(item.sha256) : '');
      if (!id) continue;
      const existing = byId[id] || {};
      const offerFrom = Array.isArray(existing.inventoryPeerIds) ? existing.inventoryPeerIds.slice() : [];
      if (peerId && offerFrom.indexOf(peerId) < 0) offerFrom.push(peerId);
      byId[id] = {
        ...existing,
        ...item,
        id,
        isLocal: false,
        isPublished: !!existing.isPublished,
        isInventory: true,
        inventoryPeerId: existing.inventoryPeerId || peerId,
        inventoryPeerIds: offerFrom
      };
    }
  }
  return Object.values(byId);
}

/**
 * Merge inventory rows into a documents-by-id map (does not overwrite local/published bytes).
 * @param {object} docsById
 * @param {object[]} inventoryDocs
 * @returns {object}
 */
function mergeInventoryDocumentsIntoMap (docsById, inventoryDocs) {
  const out = docsById && typeof docsById === 'object' ? docsById : {};
  const list = Array.isArray(inventoryDocs) ? inventoryDocs : [];
  for (const row of list) {
    if (!row || !row.id) continue;
    const existing = out[row.id];
    if (!existing) {
      out[row.id] = { ...row };
      continue;
    }
    out[row.id] = {
      ...row,
      ...existing,
      id: existing.id || row.id,
      isInventory: true,
      inventoryPeerId: existing.inventoryPeerId || row.inventoryPeerId,
      inventoryPeerIds: Array.from(new Set([
        ...(Array.isArray(existing.inventoryPeerIds) ? existing.inventoryPeerIds : []),
        ...(Array.isArray(row.inventoryPeerIds) ? row.inventoryPeerIds : [])
      ].filter(Boolean)))
    };
  }
  return out;
}

module.exports = {
  collectInventoryDocuments,
  mergeInventoryDocumentsIntoMap
};
