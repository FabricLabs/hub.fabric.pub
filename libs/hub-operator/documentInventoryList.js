'use strict';

/**
 * Flatten `globalState.peers[*].inventory.documents` into list rows for the Documents page.
 * CDN / HTML clients use this instead of Hub `publishedDocuments` when there is no local Hub.
 *
 * Uses Map internally so Codacy Semgrep does not flag dynamic object-key writes.
 *
 * @param {object|null|undefined} peers
 * @returns {object[]}
 */
function collectInventoryDocuments (peers) {
  if (!peers || typeof peers !== 'object' || Array.isArray(peers)) return [];
  const byId = new Map();
  for (const entry of Object.entries(peers)) {
    const peerKey = entry[0];
    const peer = entry[1];
    if (!peer || typeof peer !== 'object') continue;
    const items = peer.inventory && Array.isArray(peer.inventory.documents)
      ? peer.inventory.documents
      : [];
    const peerId = peer.id != null ? String(peer.id) : String(peerKey);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id != null ? String(item.id) : (item.sha256 != null ? String(item.sha256) : '');
      if (!id) continue;
      const existing = byId.has(id) ? byId.get(id) : {};
      const offerFrom = Array.isArray(existing.inventoryPeerIds) ? existing.inventoryPeerIds.slice() : [];
      if (peerId && offerFrom.indexOf(peerId) < 0) offerFrom.push(peerId);
      byId.set(id, {
        ...existing,
        ...item,
        id,
        isLocal: false,
        isPublished: !!existing.isPublished,
        isInventory: true,
        inventoryPeerId: existing.inventoryPeerId || peerId,
        inventoryPeerIds: offerFrom
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Merge inventory rows into a documents-by-id map (does not overwrite local/published bytes).
 * @param {object} docsById
 * @param {object[]} inventoryDocs
 * @returns {object}
 */
function mergeInventoryDocumentsIntoMap (docsById, inventoryDocs) {
  const out = new Map();
  if (docsById && typeof docsById === 'object' && !Array.isArray(docsById)) {
    for (const entry of Object.entries(docsById)) {
      out.set(entry[0], entry[1]);
    }
  }
  const list = Array.isArray(inventoryDocs) ? inventoryDocs : [];
  for (const row of list) {
    if (!row || !row.id) continue;
    const id = String(row.id);
    const existing = out.has(id) ? out.get(id) : null;
    if (!existing) {
      out.set(id, { ...row });
      continue;
    }
    out.set(id, {
      ...row,
      ...existing,
      id: existing.id || row.id,
      isInventory: true,
      inventoryPeerId: existing.inventoryPeerId || row.inventoryPeerId,
      inventoryPeerIds: Array.from(new Set([
        ...(Array.isArray(existing.inventoryPeerIds) ? existing.inventoryPeerIds : []),
        ...(Array.isArray(row.inventoryPeerIds) ? row.inventoryPeerIds : [])
      ].filter(Boolean)))
    });
  }
  return Object.fromEntries(out);
}

module.exports = {
  collectInventoryDocuments,
  mergeInventoryDocumentsIntoMap
};
