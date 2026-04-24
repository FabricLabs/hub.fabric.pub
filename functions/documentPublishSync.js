'use strict';

/**
 * Browser publish flow: local rows use opaque Actor ids; hub files and PublishDocument use content sha256.
 * After CreateDocument succeeds, Bridge calls publish again with the sha id — that must not re-enter
 * the "upload full content first" path or PublishDocument is never sent.
 *
 * @param {string|number} logicalId - Route / globalState key used for this publish attempt
 * @param {{ sha256?: string, published?: unknown }|null|undefined} doc
 * @returns {boolean}
 */
function needsCreateDocumentBeforePublish (logicalId, doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (!doc.sha256 || doc.published) return false;
  const lid = String(logicalId == null ? '' : logicalId).trim();
  const sha = String(doc.sha256).trim();
  return !!sha && lid !== sha;
}

/**
 * When GetNetworkStatus includes `publishedDocuments`, merge published timestamps into local `documents`.
 * Never strips `published` when the doc is missing from the snapshot — empty or stale payloads would
 * undo a successful PublishDocument before the next hub refresh.
 *
 * @param {Record<string, object>} documents - Bridge globalState.documents (mutated in place)
 * @param {Record<string, { published?: string|boolean }>} published - hub collections.documents
 * @returns {boolean} whether any row changed
 */
function mergePublishedDocumentsFromHubStatus (documents, published) {
  if (!documents || typeof documents !== 'object') return false;
  if (!published || typeof published !== 'object') return false;
  let changed = false;
  for (const [docId, doc] of Object.entries(documents)) {
    if (!doc || typeof doc !== 'object') continue;
    const inStore = published[docId] || (doc.sha256 && published[doc.sha256]);
    if (inStore && !doc.published) {
      documents[docId] = { ...doc, published: inStore.published || true };
      changed = true;
    }
  }
  return changed;
}

module.exports = {
  needsCreateDocumentBeforePublish,
  mergePublishedDocumentsFromHubStatus
};
