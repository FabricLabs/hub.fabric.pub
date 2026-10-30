'use strict';

/**
 * Hub document shares over `P2P_FILE_SEND`: one AMP frame per blob, every blob
 * committed by the core DocumentBlobIndex {@link Tree} root. The receiving
 * core Peer verifies each blob hash, reassembles, and checks the root and
 * `contentSha256` before the Hub sees the document.
 */

const constants = require('@fabric/core/constants');
const Document = require('@fabric/core/types/document');

const { MAX_MESSAGE_SIZE } = constants;
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
 * @param {Object} [meta.htlcFileV1] `{ v, iv, paymentHashHex }` when sealed
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
 * Hub document record for a transfer the core Peer reassembled and verified.
 * @param {Object} obj `P2P_FILE_SEND` object of any frame in the transfer
 * @param {Buffer} buffer reassembled bytes
 * @param {string} [merkleRootHex]
 * @returns {Object}
 */
function receivedFileShareDocument (obj, buffer, merkleRootHex) {
  const id = String(obj.name || '').trim();
  return {
    id,
    name: clip(obj.fileName, FILE_NAME_MAX_CHARS) || 'received',
    mime: clip(obj.mime, MIME_MAX_CHARS) || 'application/octet-stream',
    size: obj.size != null ? obj.size : buffer.length,
    sha256: obj.sha256 || id,
    created: obj.created,
    contentBase64: buffer.toString('base64'),
    merkleRootHex: merkleRootHex || obj.merkleRootHex || undefined,
    htlcFileV1: obj.htlcFileV1 || undefined
  };
}

module.exports = {
  FILE_SHARE_FRAME_RESERVE,
  FILE_SHARE_BLOB_BYTES,
  FILE_SHARE_MAX_BYTES,
  MAX_DOCUMENT_BLOBS,
  buildFileShareFrames,
  isFileShareFrame,
  receivedFileShareDocument
};
