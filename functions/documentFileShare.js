'use strict';

/**
 * Hub document shares over `P2P_FILE_SEND`: one AMP frame per blob, every blob
 * committed by the core DocumentBlobIndex {@link Tree} root. The receiving
 * core Peer verifies each blob hash, reassembles, and checks the root and
 * `contentSha256` before the Hub sees the document.
 */

const crypto = require('crypto');
const constants = require('@fabric/core/constants');
const Document = require('@fabric/core/types/document');
const { BLOB_BATCH_TYPE } = require('@fabric/core/functions/documentSealedExchange');

const { MAX_MESSAGE_SIZE } = constants;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_DOCUMENT_BLOBS = constants.MAX_DOCUMENT_BLOBS || constants.PEER_MAX_SEALED_BLOB_PARTS;

/** Bytes of each frame body kept for JSON keys and document metadata around the base64 blob. */
const FILE_SHARE_FRAME_RESERVE = 2048;
/** Raw bytes per blob: base64 fills the rest of the body (23,040 B → 30,720 base64 chars). */
const FILE_SHARE_BLOB_BYTES = Math.floor((MAX_MESSAGE_SIZE - FILE_SHARE_FRAME_RESERVE) * 3 / 4);
/**
 * Largest share, in bytes. Core's blob count covers a file of
 * `MAX_DOCUMENT_BYTES` (2^32 − 1). Multiplying that count by this share's
 * chunk size overshoots, because the chunk is sealed ciphertext and the count
 * uses the smaller plaintext chunk. The byte cap is the limit.
 */
const FILE_SHARE_MAX_BYTES = Math.min(
  MAX_DOCUMENT_BLOBS * FILE_SHARE_BLOB_BYTES,
  Number.isFinite(constants.MAX_DOCUMENT_BYTES) ? constants.MAX_DOCUMENT_BYTES : Infinity
);
const FILE_NAME_MAX_CHARS = 255;
const MIME_MAX_CHARS = 127;

/**
 * @param {*} value
 * @param {number} max max UTF-8 bytes once JSON-encoded (quotes excluded)
 * @returns {string|undefined}
 * @private
 */
function clip (value, max) {
  if (value == null) return undefined;
  let s = String(value).slice(0, max);
  while (s && Buffer.byteLength(JSON.stringify(s), 'utf8') - 2 > max) s = s.slice(0, -1);
  return s || undefined;
}

/**
 * Byte length of a share payload. A caller can pass `{ length }` or
 * `{ byteLength }` so an oversized file is refused before those bytes are copied.
 * @param {*} buffer
 * @returns {number}
 * @private
 */
function inputByteLength (buffer) {
  if (buffer == null) return 0;
  if (typeof buffer === 'string') return Buffer.byteLength(buffer);
  if (typeof buffer.byteLength === 'number') return buffer.byteLength;
  if (typeof buffer.length === 'number') return buffer.length;
  throw new TypeError('buffer required');
}

/**
 * Build the signed-ready `P2P_FILE_SEND` bodies for one document.
 * @param {Buffer|string} buffer bytes on the wire (ciphertext when HTLC-sealed)
 * @param {Object} meta
 * @param {string} meta.documentId Hub document id
 * @param {string} [meta.actorId] sender Fabric id
 * @param {string} [meta.fileName]
 * @param {string} [meta.mime]
 * @param {number} [meta.size] plaintext size
 * @param {string} [meta.sha256] plaintext SHA-256 hex
 * @param {string} [meta.created]
 * @param {Object} [meta.htlcFileV1] `{ v: 1, iv, paymentHashHex }` for one sealed ciphertext, or
 *   `{ v: 2, scheme, perBlob: true, merkleRootHex, blobTotal, paymentHashHex }` for a per-blob sealed document
 * @param {Array<Object>} [meta.sealedParts] per-blob sealed document only: `{ iv, keyHashHex, wrappedKeyHex, size }`
 *   for each sealed blob, in order. Sealed blobs are exactly as large as share blobs, so blob `i`'s entry rides on frame `i`.
 * @param {Object} [meta.relay] `{ deliveryFabricId, fileRelayTtl }`
 * @returns {{ frames: string[], merkleRootHex: string, contentSha256: string, blobTotal: number, chunkBytes: number }}
 */
function buildFileShareFrames (buffer, meta = {}) {
  const byteLength = inputByteLength(buffer);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > FILE_SHARE_MAX_BYTES) {
    throw new RangeError(`file exceeds FILE_SHARE_MAX_BYTES (${FILE_SHARE_MAX_BYTES})`);
  }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer == null ? '' : buffer);
  const documentId = String(meta.documentId || '').trim();
  if (!documentId) throw new TypeError('documentId required');

  const split = Document.split(buf, FILE_SHARE_BLOB_BYTES, documentId);
  const sealedParts = Array.isArray(meta.sealedParts) ? meta.sealedParts : null;
  if (sealedParts && (sealedParts.length !== split.blobs.length ||
    split.blobs.some((blob, i) => Number(sealedParts[i] && sealedParts[i].size) !== blob.bytes.length))) {
    throw new RangeError('sealed parts do not line up with file-share blobs');
  }
  const relay = meta.relay && meta.relay.deliveryFabricId
    ? { deliveryFabricId: String(meta.relay.deliveryFabricId).trim(), fileRelayTtl: meta.relay.fileRelayTtl }
    : {};
  const common = {
    name: documentId,
    fileName: clip(meta.fileName, FILE_NAME_MAX_CHARS),
    mime: clip(meta.mime, MIME_MAX_CHARS),
    size: meta.size,
    sha256: meta.sha256,
    created: meta.created,
    htlcFileV1: meta.htlcFileV1 || undefined,
    ...relay,
    merkleRootHex: split.merkleRootHex,
    contentSha256: split.contentSha256,
    chunkBytes: split.chunkBytes
  };

  const frames = split.blobs.map((blob) => {
    const body = JSON.stringify({
      type: 'P2P_FILE_SEND',
      actor: meta.actorId ? { id: String(meta.actorId) } : undefined,
      object: {
        ...common,
        blobIndex: blob.index,
        blobTotal: blob.total,
        blobHashHex: blob.blobHashHex,
        sealedPart: sealedParts
          ? {
              iv: String(sealedParts[blob.index].iv),
              keyHashHex: String(sealedParts[blob.index].keyHashHex),
              wrappedKeyHex: String(sealedParts[blob.index].wrappedKeyHex)
            }
          : undefined,
        body: blob.bytes.toString('base64')
      }
    });
    if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_SIZE) {
      throw new RangeError(`P2P_FILE_SEND frame exceeds MAX_MESSAGE_SIZE (${MAX_MESSAGE_SIZE})`);
    }
    return body;
  });

  return {
    frames,
    merkleRootHex: split.merkleRootHex,
    contentSha256: split.contentSha256,
    blobTotal: split.blobs.length,
    chunkBytes: split.chunkBytes
  };
}

/**
 * @param {Object} obj `P2P_FILE_SEND` object
 * @returns {boolean} true for a per-blob frame (core DocumentBlobIndex fields)
 */
function isFileShareFrame (obj) {
  return !!(obj && typeof obj === 'object' && obj.body != null &&
    (obj.blobIndex != null || obj.blobHashHex != null || obj.merkleRootHex != null));
}

/**
 * @param {*} header `htlcFileV1` from a frame
 * @returns {boolean} true for a per-blob sealed document header (v2)
 */
function isPerBlobHeader (header) {
  return !!(header && typeof header === 'object' && Number(header.v) === 2 && header.perBlob === true &&
    HEX64.test(String(header.merkleRootHex || '').toLowerCase()) &&
    HEX64.test(String(header.paymentHashHex || '').toLowerCase()) &&
    Number.isSafeInteger(Number(header.blobTotal)) && Number(header.blobTotal) > 0);
}

/**
 * The sealed-blob entry a per-blob frame carries, tied to the blob the core Peer verified.
 * @param {Object} obj `P2P_FILE_SEND` object
 * @returns {{ index: number, blobHashHex: string, iv: string, keyHashHex: string, wrappedKeyHex: string }|null}
 */
function fileShareSealedPart (obj) {
  if (!obj || !isPerBlobHeader(obj.htlcFileV1)) return null;
  const part = obj.sealedPart;
  const index = Number(obj.blobIndex);
  if (!part || typeof part !== 'object' || !Number.isSafeInteger(index) || index < 0) return null;
  const iv = String(part.iv || '');
  const keyHashHex = String(part.keyHashHex || '').toLowerCase();
  const wrappedKeyHex = String(part.wrappedKeyHex || '').toLowerCase();
  if (!iv || iv.length > 64 || !HEX64.test(keyHashHex) || !HEX64.test(wrappedKeyHex)) return null;
  return { index, blobHashHex: String(obj.blobHashHex || '').toLowerCase(), iv, keyHashHex, wrappedKeyHex };
}

/**
 * Key for one incoming transfer: sending connection, document, and share root.
 * @param {string} originName
 * @param {Object} obj `P2P_FILE_SEND` object
 * @returns {string}
 */
function sealedTransferKey (originName, obj) {
  return `${String(originName || '')}|${String((obj && obj.name) || '')}|${String((obj && obj.merkleRootHex) || '')}`;
}

/**
 * Holds the sealed-blob entries of transfers still arriving. Few transfers,
 * briefly: the oldest is dropped past `maxTransfers`, any past `maxAgeMs`.
 * @param {Object} [opts]
 * @param {number} [opts.maxTransfers]
 * @param {number} [opts.maxAgeMs]
 * @returns {{ note: function(string, Object): void, take: function(string): Array<Object> }}
 */
function createSealedPartCollector (opts = {}) {
  const maxTransfers = Math.max(1, Number(opts.maxTransfers) || 8);
  const maxAgeMs = Math.max(1000, Number(opts.maxAgeMs) || 15 * 60 * 1000);
  const transfers = new Map();
  const sweep = (now) => {
    for (const [key, t] of transfers) if (now - t.at > maxAgeMs) transfers.delete(key);
  };
  return {
    note (key, part) {
      const now = Date.now();
      sweep(now);
      let t = transfers.get(key);
      if (!t) {
        t = { at: now, parts: new Map() };
        transfers.set(key, t);
        while (transfers.size > maxTransfers) transfers.delete(transfers.keys().next().value);
      }
      t.parts.set(part.index, part);
    },
    take (key) {
      const t = transfers.get(key);
      transfers.delete(key);
      return t ? [...t.parts.values()].sort((a, b) => a.index - b.index) : [];
    }
  };
}

/**
 * Hub document record for a transfer the core Peer reassembled and verified.
 * A per-blob sealed transfer with every blob's entry also gets `parts` (as the
 * seller keeps them) and `sealedBatch`, the wraps as a core `DocumentBlobBatch`
 * for the Hub to keep privately; both open only with the batch preimage.
 * @param {Object} obj `P2P_FILE_SEND` object of any frame in the transfer
 * @param {Buffer} buffer reassembled bytes
 * @param {string} [merkleRootHex]
 * @param {Array<Object>} [sealedParts] from {@link fileShareSealedPart}, one per blob
 * @returns {Object}
 */
function receivedFileShareDocument (obj, buffer, merkleRootHex, sealedParts) {
  const id = String(obj.name || '').trim();
  const sealed = perBlobRecord(id, obj, buffer, sealedParts);
  return {
    id,
    name: clip(obj.fileName, FILE_NAME_MAX_CHARS) || 'received',
    mime: clip(obj.mime, MIME_MAX_CHARS) || 'application/octet-stream',
    size: obj.size != null ? obj.size : buffer.length,
    sha256: obj.sha256 || (obj.htlcFileV1 ? undefined : crypto.createHash('sha256').update(buffer).digest('hex')),
    created: obj.created,
    contentBase64: buffer.toString('base64'),
    merkleRootHex: merkleRootHex || obj.merkleRootHex || undefined,
    htlcFileV1: obj.htlcFileV1 || undefined,
    ...(sealed || {})
  };
}

/**
 * @private
 * @returns {{ parts: Array<Object>, sealedBatch: Object }|null}
 */
function perBlobRecord (documentId, obj, buffer, sealedParts) {
  const header = obj.htlcFileV1;
  if (!isPerBlobHeader(header) || !Array.isArray(sealedParts)) return null;
  const total = Number(header.blobTotal);
  const chunkBytes = Number(obj.chunkBytes);
  if (Number(obj.blobTotal) !== total || sealedParts.length !== total || !(chunkBytes > 0)) return null;
  if (sealedParts.some((p, i) => p.index !== i)) return null;
  const parts = sealedParts.map((p, i) => ({
    index: i,
    blobHashHex: p.blobHashHex,
    keyHashHex: p.keyHashHex,
    iv: p.iv,
    size: Math.min(chunkBytes, buffer.length - i * chunkBytes)
  }));
  if (parts.some((p) => !(p.size > 0))) return null;
  return {
    parts,
    sealedBatch: {
      type: BLOB_BATCH_TYPE,
      documentId,
      merkleRootHex: String(header.merkleRootHex).toLowerCase(),
      start: 0,
      end: total - 1,
      paymentHashHex: String(header.paymentHashHex).toLowerCase(),
      amountSats: 0,
      expiresAt: null,
      blobs: sealedParts.map((p) => ({
        blobIndex: p.index,
        blobHashHex: p.blobHashHex,
        keyHashHex: p.keyHashHex,
        wrappedKeyHex: p.wrappedKeyHex
      }))
    }
  };
}

module.exports = {
  FILE_SHARE_FRAME_RESERVE,
  FILE_SHARE_BLOB_BYTES,
  FILE_SHARE_MAX_BYTES,
  MAX_DOCUMENT_BLOBS,
  buildFileShareFrames,
  isFileShareFrame,
  isPerBlobHeader,
  fileShareSealedPart,
  sealedTransferKey,
  createSealedPartCollector,
  receivedFileShareDocument
};
