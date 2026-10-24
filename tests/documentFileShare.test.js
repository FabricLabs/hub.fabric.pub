'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const Peer = require('@fabric/core/types/peer');
const { HEADER_SIZE, MAX_MESSAGE_SIZE } = require('@fabric/core/constants');
const { merkleRootHexFromBlobHashes } = require('@fabric/core/functions/documentBlobManifest');
const {
  FILE_SHARE_BLOB_BYTES,
  FILE_SHARE_MAX_BYTES,
  MAX_DOCUMENT_BLOBS,
  buildFileShareFrames,
  isFileShareFrame,
  receivedFileShareDocument
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
  it('has a theoretical maximum of MAX_DOCUMENT_BLOBS × FILE_SHARE_BLOB_BYTES (180 MiB)', function () {
    assert.strictEqual(MAX_DOCUMENT_BLOBS, 8192);
    assert.strictEqual(FILE_SHARE_BLOB_BYTES, 23040);
    assert.strictEqual(FILE_SHARE_MAX_BYTES, 180 * 1024 * 1024);
    assert.throws(
      () => buildFileShareFrames(Buffer.allocUnsafe(FILE_SHARE_MAX_BYTES + 1), { documentId: 'd' }),
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
    assert.strictEqual(merkleRootHexFromBlobHashes(hashes), share.merkleRootHex);
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
    assert.ok(Buffer.from(doc.contentBase64, 'base64').equals(data));
  });

  it('rejects a tampered blob and a repeated last blob', function () {
    const data = crypto.randomBytes(3 * FILE_SHARE_BLOB_BYTES);
    const share = buildFileShareFrames(data, { documentId: 'tamper' });
    const peer = new Peer({ listen: false, peers: [] });

    const bad = JSON.parse(share.frames[1]);
    bad.object.body = crypto.randomBytes(FILE_SHARE_BLOB_BYTES).toString('base64');
    assert.strictEqual(ingest(peer, JSON.stringify(bad)).status, 'reject');

    // [a, b, c, c] has the same Bitcoin Merkle root as [a, b, c]; contentSha256 catches it.
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
    assert.strictEqual(last.error, 'contentSha256 mismatch');
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

  it('leaves legacy whole-file frames to the legacy path', function () {
    assert.strictEqual(isFileShareFrame({ id: 'd', name: 'a.txt', contentBase64: 'YQ==' }), false);
    assert.strictEqual(isFileShareFrame(null), false);
  });
});
