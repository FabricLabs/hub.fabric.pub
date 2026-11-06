'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const Peer = require('@fabric/core/types/peer');
const { HEADER_SIZE, MAX_DOCUMENT_BYTES, MAX_MESSAGE_SIZE } = require('@fabric/core/constants');
const Document = require('@fabric/core/types/document');
const {
  FILE_SHARE_BLOB_BYTES,
  FILE_SHARE_MAX_BYTES,
  MAX_DOCUMENT_BLOBS,
  buildFileShareFrames,
  createSealedPartCollector,
  fileShareSealedPart,
  isFileShareFrame,
  isPerBlobHeader,
  receivedFileShareDocument,
  sealedTransferKey
} = require('../functions/documentFileShare');

const signer = new Key();

function wire (frame) {
  return Message.fromVector(['P2P_FILE_SEND', frame]).signWithKey(signer).toBuffer();
}

function ingest (peer, frame) {
  const parsed = Message.tryParseMessageBody(Message.fromBuffer(wire(frame)));
  assert.ok(parsed.ok);
  return peer._ingestP2pFileSend({ type: 'P2P_FILE_SEND', object: parsed.value.object }, { name: 'sender:7777' });
}

describe('documentFileShare', function () {
  it('caps a share at the core document byte limit', function () {
    const { MAX_DOCUMENT_BLOBS: coreBlobs } = require('@fabric/core/constants');
    assert.strictEqual(MAX_DOCUMENT_BLOBS, coreBlobs);
    assert.strictEqual(FILE_SHARE_BLOB_BYTES, 32 * 1024);
    assert.ok(FILE_SHARE_BLOB_BYTES <= MAX_MESSAGE_SIZE - 2048);
    assert.strictEqual(FILE_SHARE_MAX_BYTES, Math.min(MAX_DOCUMENT_BLOBS * FILE_SHARE_BLOB_BYTES, MAX_DOCUMENT_BYTES));
    assert.throws(
      () => buildFileShareFrames({ length: FILE_SHARE_MAX_BYTES + 1 }, { documentId: 'd' }),
      RangeError
    );
    assert.throws(() => buildFileShareFrames(Buffer.from('x'), {}), TypeError);
  });

  it('splits a large file into AMP-sized frames committed by one Tree root', function () {
    const data = crypto.randomBytes(1024 * 1024 + 777);
    const share = buildFileShareFrames(data, {
      documentId: crypto.createHash('sha256').update(data).digest('hex'),
      actorId: 'ab'.repeat(32),
      fileName: 'x'.repeat(1000),
      mime: 'application/octet-stream',
      size: data.length,
      created: new Date().toISOString(),
      htlcFileV1: { v: 1, iv: crypto.randomBytes(12).toString('base64'), paymentHashHex: 'cd'.repeat(32) },
      relay: { deliveryFabricId: 'ef'.repeat(32), fileRelayTtl: 16 }
    });
    assert.strictEqual(share.blobTotal, Math.ceil(data.length / FILE_SHARE_BLOB_BYTES));
    assert.strictEqual(share.frames.length, share.blobTotal);
    const hashes = [];
    for (const frame of share.frames) {
      assert.ok(Buffer.byteLength(frame) <= MAX_MESSAGE_SIZE);
      assert.ok(wire(frame).length <= HEADER_SIZE + MAX_MESSAGE_SIZE);
      const obj = JSON.parse(frame).object;
      assert.ok(isFileShareFrame(obj));
      assert.strictEqual(obj.fileName.length, 255);
      assert.strictEqual(obj.merkleRootHex, share.merkleRootHex);
      hashes.push(obj.blobHashHex);
    }
    assert.strictEqual(Document.rootHexFromBlobHashes(hashes), share.merkleRootHex);
  });

  it('core Peer reassembles out-of-order frames and verifies the root', function () {
    const data = crypto.randomBytes(5 * FILE_SHARE_BLOB_BYTES + 12);
    const documentId = crypto.createHash('sha256').update(data).digest('hex');
    const share = buildFileShareFrames(data, { documentId, fileName: 'clip.mp4', mime: 'video/mp4', size: data.length });
    const peer = new Peer({ listen: false, peers: [] });
    const order = share.frames.slice().reverse();
    let last = null;
    for (const frame of order) last = ingest(peer, frame);
    assert.strictEqual(last.status, 'complete');
    assert.strictEqual(last.verified, true);
    assert.ok(last.buffer.equals(data));
    assert.strictEqual(last.merkleRootHex, share.merkleRootHex);

    const doc = receivedFileShareDocument(JSON.parse(order[order.length - 1]).object, last.buffer, last.merkleRootHex);
    assert.strictEqual(doc.id, documentId);
    assert.strictEqual(doc.name, 'clip.mp4');
    assert.strictEqual(doc.mime, 'video/mp4');
    assert.strictEqual(doc.size, data.length);
    assert.strictEqual(doc.merkleRootHex, share.merkleRootHex);
    assert.strictEqual(doc.sha256, crypto.createHash('sha256').update(data).digest('hex'), 'a hash, never the document id');
    assert.ok(Buffer.from(doc.contentBase64, 'base64').equals(data));
  });

  it('rejects a tampered blob and a repeated last blob', function () {
    const data = crypto.randomBytes(3 * FILE_SHARE_BLOB_BYTES);
    const share = buildFileShareFrames(data, { documentId: 'tamper' });
    const peer = new Peer({ listen: false, peers: [] });

    const bad = JSON.parse(share.frames[1]);
    bad.object.body = crypto.randomBytes(FILE_SHARE_BLOB_BYTES).toString('base64');
    assert.strictEqual(ingest(peer, JSON.stringify(bad)).status, 'reject');

    // [a, b, c, c] does not build the root of [a, b, c]: the root commits the blob count.
    const frames = share.frames.map((f) => JSON.parse(f));
    const extra = JSON.parse(JSON.stringify(frames[2]));
    extra.object.blobIndex = 3;
    const forged = frames.concat([extra]).map((f) => {
      f.object.blobTotal = 4;
      return JSON.stringify(f);
    });
    let last = null;
    for (const frame of forged) last = ingest(peer, frame);
    assert.strictEqual(last.status, 'reject');
    assert.strictEqual(last.error, 'merkle/root mismatch');
  });

  it('clips names by encoded size so escapes and emoji cannot overflow a frame', function () {
    const data = crypto.randomBytes(FILE_SHARE_BLOB_BYTES);
    for (const fileName of ['\u0001'.repeat(1000), '"'.repeat(1000), '\u{1F680}'.repeat(1000)]) {
      const [frame] = buildFileShareFrames(data, { documentId: 'n', fileName, mime: fileName }).frames;
      assert.ok(Buffer.byteLength(frame) <= MAX_MESSAGE_SIZE);
      const name = JSON.parse(frame).object.fileName;
      assert.ok(Buffer.byteLength(JSON.stringify(name)) - 2 <= 255);
    }
  });

  it('carries one sealed-blob entry per frame, and only for blobs that line up', function () {
    const data = crypto.randomBytes(2 * FILE_SHARE_BLOB_BYTES + 5);
    const sizes = [FILE_SHARE_BLOB_BYTES, FILE_SHARE_BLOB_BYTES, 5];
    const sealedParts = sizes.map((size) => ({
      iv: crypto.randomBytes(12).toString('base64'),
      keyHashHex: crypto.randomBytes(32).toString('hex'),
      wrappedKeyHex: crypto.randomBytes(32).toString('hex'),
      size
    }));
    const header = { v: 2, scheme: 'aes-256-gcm-convergent', perBlob: true, merkleRootHex: 'aa'.repeat(32), blobTotal: 3, paymentHashHex: 'bb'.repeat(32) };
    const share = buildFileShareFrames(data, {
      documentId: 'cc'.repeat(32),
      actorId: 'ab'.repeat(32),
      fileName: '"'.repeat(1000),
      mime: '"'.repeat(1000),
      size: data.length,
      sha256: 'dd'.repeat(32),
      created: new Date().toISOString(),
      htlcFileV1: header,
      sealedParts,
      relay: { deliveryFabricId: 'ef'.repeat(32), fileRelayTtl: 16 }
    });
    const peer = new Peer({ listen: false, peers: [] });
    const collector = createSealedPartCollector();
    let last = null;
    let obj = null;
    for (const frame of share.frames) {
      assert.ok(Buffer.byteLength(frame) <= MAX_MESSAGE_SIZE);
      obj = JSON.parse(frame).object;
      assert.strictEqual(isPerBlobHeader(obj.htlcFileV1), true);
      collector.note(sealedTransferKey('s:1', obj), fileShareSealedPart(obj));
      last = ingest(peer, frame);
    }
    assert.strictEqual(last.status, 'complete');
    const doc = receivedFileShareDocument(obj, last.buffer, last.merkleRootHex, collector.take(sealedTransferKey('s:1', obj)));
    assert.deepStrictEqual(doc.parts.map((p) => [p.iv, p.keyHashHex, p.size]), sealedParts.map((p) => [p.iv, p.keyHashHex, p.size]));
    assert.strictEqual(doc.sealedBatch.paymentHashHex, header.paymentHashHex);
    assert.strictEqual(doc.sealedBatch.merkleRootHex, header.merkleRootHex);
    assert.deepStrictEqual(doc.sealedBatch.blobs.map((b) => b.wrappedKeyHex), sealedParts.map((p) => p.wrappedKeyHex));
    assert.strictEqual(require('@fabric/core/functions/documentSealedExchange').isWellFormedBlobBatch(doc.sealedBatch), true);

    const missing = createSealedPartCollector();
    missing.note('k', fileShareSealedPart(JSON.parse(share.frames[0]).object));
    assert.strictEqual(receivedFileShareDocument(obj, last.buffer, last.merkleRootHex, missing.take('k')).parts, undefined);
    assert.deepStrictEqual(missing.take('k'), [], 'taken once');

    assert.throws(() => buildFileShareFrames(data, { documentId: 'x', sealedParts: sealedParts.slice(0, 2) }), RangeError);
    assert.throws(() => buildFileShareFrames(data, { documentId: 'x', sealedParts: sealedParts.map((p) => ({ ...p, size: 7 })) }), RangeError);
    assert.strictEqual(fileShareSealedPart({ ...obj, sealedPart: { ...obj.sealedPart, wrappedKeyHex: 'zz' } }), null);
    assert.strictEqual(fileShareSealedPart({ ...obj, htlcFileV1: { v: 1, iv: 'x', paymentHashHex: 'bb'.repeat(32) } }), null);
  });

  it('keeps sealed-blob entries for a few transfers, briefly', function () {
    const collector = createSealedPartCollector({ maxTransfers: 2 });
    const part = (index) => ({ index, blobHashHex: '', iv: 'i', keyHashHex: 'aa'.repeat(32), wrappedKeyHex: 'bb'.repeat(32) });
    collector.note('a', part(0));
    collector.note('b', part(0));
    collector.note('c', part(1));
    collector.note('c', part(0));
    assert.deepStrictEqual(collector.take('a'), []);
    assert.deepStrictEqual(collector.take('c').map((p) => p.index), [0, 1]);
    assert.strictEqual(collector.take('b').length, 1);
  });

  it('leaves legacy whole-file frames to the legacy path', function () {
    assert.strictEqual(isFileShareFrame({ id: 'd', name: 'a.txt', contentBase64: 'YQ==' }), false);
    assert.strictEqual(isFileShareFrame(null), false);
  });
});
