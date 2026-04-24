'use strict';

/**
 * Bitcoin Core `getblockchaininfo` prune fields for Fabric hub document inventory.
 * When `pruned` is true, full blocks with height strictly less than `pruneheight`
 * are not available from this node (Document Market peers may still serve them).
 *
 * @param {object|null|undefined} blockchain — RPC `getblockchaininfo` result
 * @returns {{ pruned: boolean, pruneHeight: number|null }}
 */
function pruneStatusFromBlockchainInfo (blockchain) {
  const b = blockchain && typeof blockchain === 'object' ? blockchain : null;
  if (!b) return { pruned: false, pruneHeight: null };
  const pruned = !!b.pruned;
  const raw = b.pruneheight;
  const n = raw != null && raw !== '' ? Number(raw) : NaN;
  const pruneHeight = pruned && Number.isFinite(n) ? Math.round(n) : null;
  return { pruned, pruneHeight };
}

/**
 * @param {number|null} pruneHeight — from {@link pruneStatusFromBlockchainInfo}
 * @param {number|null|undefined} docHeight — `bitcoinHeight` on stored document meta
 * @returns {boolean}
 */
function isDocumentHeightPruned (pruneHeight, docHeight) {
  if (pruneHeight == null || !Number.isFinite(pruneHeight)) return false;
  const h = docHeight != null && docHeight !== '' ? Number(docHeight) : NaN;
  if (!Number.isFinite(h)) return false;
  return h < pruneHeight;
}

module.exports = {
  pruneStatusFromBlockchainInfo,
  isDocumentHeightPruned
};
