'use strict';

/**
 * @fileoverview React wrapper around `@fabric/http` `fabric-document`: renders
 * the hash-only sealed blob tree (Tree root, leaves, ranked chunk providers)
 * for a document record. Offers come from `GET /services/market/chunks`
 * (local `DocumentOfferBook` telemetry) — never member metadata or bytes.
 */

const React = require('react');
// Pure view helpers only: `@fabric/http/components/document` extends Component → core
// Service, whose require graph reaches Node-only Peer (`net`, noise) and breaks the bundle.
const documentView = require('@fabric/http/functions/documentView');

/**
 * @param {Object} doc Hub document record (may include `merkleRootHex`, `blobs`, `blobHashes`).
 * @returns {Object|null} hash-only record accepted by `documentView.sanitizeRecord`
 */
function recordFromHubDocument (doc) {
  if (!doc || typeof doc !== 'object') return null;
  const root = doc.merkleRootHex || doc.merkleRoot || null;
  let blobs = Array.isArray(doc.blobs) ? doc.blobs : null;
  if (!blobs && Array.isArray(doc.blobHashes)) {
    blobs = doc.blobHashes.map((h, i) => ({ index: i, blobHashHex: h }));
  }
  if (!root || !blobs || !blobs.length) return null;
  return documentView.sanitizeRecord({
    documentId: doc.id || doc.sha256 || null,
    merkleRootHex: root,
    blobTotal: doc.blobTotal != null ? doc.blobTotal : blobs.length,
    chunkBytes: doc.chunkBytes,
    sealed: doc.sealed === true || doc.perBlob === true,
    size: doc.size,
    publisher: doc.publisher || doc.publisherPubkey || null,
    blobs
  });
}

/**
 * @param {Object} props
 * @param {Object} props.document Hub document record.
 * @param {Object} [props.opened] `{ manifest, blobs }` once keys are held client-side.
 */
function FabricDocumentRecord (props) {
  const record = React.useMemo(() => recordFromHubDocument(props.document), [props.document]);
  const [offers, setOffers] = React.useState([]);

  React.useEffect(() => {
    if (!record || !record.merkleRootHex || typeof fetch !== 'function') return undefined;
    let cancelled = false;
    fetch(`/services/market/chunks?merkleRootHex=${encodeURIComponent(record.merkleRootHex)}`, {
      headers: { Accept: 'application/json' }
    })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body || !body.chunks) return;
        const rows = [];
        for (const hash of Object.keys(body.chunks)) {
          for (const row of (body.chunks[hash] || [])) rows.push(Object.assign({ blobHashHex: hash }, row));
        }
        setOffers(rows);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [record && record.merkleRootHex]);

  if (!record) return null;
  const html = documentView.renderDocumentHTML({ document: record, offers, opened: props.opened || null }, { href: '/documents' });
  return React.createElement('fabric-document', {
    'data-merkle-root': record.merkleRootHex,
    'data-document-id': record.documentId || undefined,
    dangerouslySetInnerHTML: { __html: html }
  });
}

FabricDocumentRecord.recordFromHubDocument = recordFromHubDocument;

module.exports = FabricDocumentRecord;
