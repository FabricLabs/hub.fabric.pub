'use strict';

/**
 * Document list ordering: open host/distribute offers first (highest sats first),
 * then by buyer list price ascending (purchasePriceSats), then newest created.
 */

function proposalMatchesDocument (proposal, doc) {
  if (!proposal || !doc) return false;
  const docId = doc.id != null ? String(doc.id) : '';
  const docSha = doc.sha256 || doc.sha;
  const docShaStr = docSha != null ? String(docSha) : '';
  const pid = proposal.documentId != null ? String(proposal.documentId) : '';
  if (pid && (pid === docId || (docShaStr && pid === docShaStr))) return true;
  const nested = proposal.document;
  if (nested && typeof nested === 'object') {
    const nid = nested.id != null ? String(nested.id) : '';
    const nsha = nested.sha256 || nested.sha;
    const nshaStr = nsha != null ? String(nsha) : '';
    if (docId && (nid === docId || nshaStr === docId)) return true;
    if (docShaStr && (nid === docShaStr || nshaStr === docShaStr)) return true;
  }
  return false;
}

/** Pending / accepted proposals still represent a host-side income opportunity. */
const OPEN_HOST_STATUSES = new Set(['pending', 'accepted']);

function maxOpenHostOfferSatsForDocument (doc, distributeProposals) {
  if (!doc || !distributeProposals || typeof distributeProposals !== 'object') return 0;
  let max = 0;
  for (const p of Object.values(distributeProposals)) {
    if (!p || !OPEN_HOST_STATUSES.has(String(p.status || ''))) continue;
    if (!proposalMatchesDocument(p, doc)) continue;
    const n = Number(p.amountSats);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function purchasePriceSatsForSort (doc) {
  if (!doc) return Infinity;
  const n = Number(doc.purchasePriceSats);
  if (Number.isFinite(n) && n > 0) return n;
  return Infinity;
}

function compareDocumentsByHostOfferThenPurchasePrice (a, b, distributeProposals) {
  const offerA = maxOpenHostOfferSatsForDocument(a, distributeProposals);
  const offerB = maxOpenHostOfferSatsForDocument(b, distributeProposals);
  const hasA = offerA > 0;
  const hasB = offerB > 0;
  if (hasA !== hasB) return (hasB ? 1 : 0) - (hasA ? 1 : 0);
  if (hasA && offerA !== offerB) return offerB - offerA;
  const pa = purchasePriceSatsForSort(a);
  const pb = purchasePriceSatsForSort(b);
  if (pa !== pb) return pa - pb;
  const ta = a.created ? new Date(a.created).getTime() : 0;
  const tb = b.created ? new Date(b.created).getTime() : 0;
  return tb - ta;
}

module.exports = {
  proposalMatchesDocument,
  maxOpenHostOfferSatsForDocument,
  purchasePriceSatsForSort,
  compareDocumentsByHostOfferThenPurchasePrice
};
