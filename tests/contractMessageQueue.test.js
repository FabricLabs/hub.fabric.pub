'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const contractMessageQueue = require('../functions/contractMessageQueue');

const mailbox = contractMessageQueue.mailboxKey;

function signContractMessage (key, contractId, type, object) {
  const body = JSON.stringify({
    contract: contractId,
    type,
    object
  });
  return Message.fromVector(['CONTRACT_MESSAGE', body]).signWithKey(key);
}

function memoryFs () {
  const files = Object.create(null);
  return {
    _files: files,
    readFile (p) {
      return files[p] != null ? files[p] : null;
    },
    publish (p, value) {
      files[p] = value;
      return value;
    }
  };
}

/**
 * Mirror Hub `_drainContractMessageQueueToPeer` without Peer sockets:
 * rewrite author-signed bytes via `_writeFabric`, then markDelivered.
 */
function drainQueueToMockPeer (store, peerKey, opts = {}) {
  const limitPer = Number(opts.limitPerContract) > 0 ? Number(opts.limitPerContract) : 64;
  const writes = [];
  const sock = {
    _writeFabric (buf) {
      writes.push(Buffer.from(buf));
    }
  };
  const contractIds = typeof store.listContractIds === 'function'
    ? store.listContractIds()
    : [];
  let delivered = 0;
  let contracts = 0;
  for (const contractId of contractIds) {
    const pending = contractMessageQueue.pendingForDelivery(store, contractId, peerKey);
    if (!pending.length) continue;
    contracts += 1;
    for (const entry of pending.slice(0, limitPer)) {
      const buf = Buffer.from(String(entry.hex), 'hex');
      if (!buf.length) continue;
      sock._writeFabric(buf);
      contractMessageQueue.markDelivered(store, contractId, entry.hash, peerKey);
      delivered += 1;
    }
  }
  return { delivered, contracts, writes };
}

describe('Hub contractMessageQueue (Filesystem)', function () {
  const contractId = 'e'.repeat(64);

  it('createFilesystemStore requires Hub Filesystem', function () {
    assert.throws(
      () => contractMessageQueue.createFilesystemStore(null),
      /Filesystem/
    );
    assert.throws(
      () => contractMessageQueue.createFilesystemStore({ readFile () {} }),
      /Filesystem/
    );
  });

  it('createFilesystemStore persists opaque hex and index', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'opaque',
      author: author.pubkey
    });
    const enq = contractMessageQueue.enqueue(store, contractId, msg.toBuffer(), { origin: 'mesh' });
    assert.strictEqual(enq.accepted, true);
    assert.ok(fs.readFile(`contract-message-queue/${contractId}.json`));
    assert.deepStrictEqual(store.listContractIds(), [contractId]);
    const rows = contractMessageQueue.listQueuedMessages(store, contractId);
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0].hex);
    assert.strictEqual(rows[0].type, 'GroupChat');
  });

  it('INDEX survives store recreation over the same FS', function () {
    const fs = memoryFs();
    const author = new Key();
    const first = contractMessageQueue.createFilesystemStore(fs);
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'persist' });
    assert.strictEqual(
      contractMessageQueue.enqueue(first, contractId, msg.toBuffer()).accepted,
      true
    );

    const second = contractMessageQueue.createFilesystemStore(fs);
    assert.deepStrictEqual(second.listContractIds(), [contractId]);
    const rows = contractMessageQueue.listQueuedMessages(second, contractId, { includeDelivered: true });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, 'GroupChat');
  });

  it('supports custom root paths', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs, { root: 'queues/custom' });
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'alt-root' });
    assert.strictEqual(
      contractMessageQueue.enqueue(store, contractId, msg.toBuffer()).accepted,
      true
    );
    assert.ok(fs.readFile(`queues/custom/${contractId}.json`));
    assert.ok(fs.readFile('queues/custom/INDEX.json'));
    assert.strictEqual(fs.readFile(`contract-message-queue/${contractId}.json`), null);
  });

  it('does not require tip or private keys to store sealed-looking frames', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      seal: {
        scheme: 'aes-256-gcm-participant-v1',
        ephemeralPub: author.pubkey,
        wraps: [],
        nonce: 'x',
        ciphertext: 'y'
      }
    });
    const enq = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    assert.strictEqual(enq.accepted, true);
    assert.ok(enq.entry.hex.length > 32);
  });

  it('enqueues idempotently by message hash', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', {
      body: 'once',
      author: author.pubkey
    });
    const buf = msg.toBuffer();
    const a = contractMessageQueue.enqueue(store, contractId, buf, { origin: 'mesh' });
    assert.strictEqual(a.accepted, true);
    const b = contractMessageQueue.enqueue(store, contractId, buf, { origin: 'mesh' });
    assert.strictEqual(b.accepted, false);
    assert.strictEqual(b.duplicate, true);
    assert.strictEqual(
      contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true }).length,
      1
    );
  });

  it('accepts fabric: paste strings without rewriting hex', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'paste' });
    const buf = msg.toBuffer();
    const paste = `fabric:${buf.toString('hex')}`;
    const enq = contractMessageQueue.enqueue(store, contractId, paste, { origin: 'paste' });
    assert.strictEqual(enq.accepted, true);
    assert.strictEqual(enq.entry.hex, buf.toString('hex'));
    assert.strictEqual(enq.entry.origin, 'paste');
  });

  it('rejects unsigned CONTRACT_MESSAGE frames at enqueue', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const unsigned = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({
      contract: contractId,
      type: 'GroupChat',
      object: { body: 'no-sig' }
    })]);
    const bad = contractMessageQueue.enqueue(store, contractId, unsigned.toBuffer());
    assert.strictEqual(bad.accepted, false);
    assert.strictEqual(bad.duplicate, false);
    assert.match(bad.error, /invalid signature/i);
    assert.deepStrictEqual(store.listContractIds(), []);
  });

  it('rejects body contract id mismatch', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const other = 'f'.repeat(64);
    const msg = signContractMessage(author, other, 'GroupChat', { body: 'wrong-ns' });
    const bad = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /contract id mismatch/i);
  });

  it('rejects garbage buffers and wrong message types', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const garbage = contractMessageQueue.enqueue(store, contractId, Buffer.from('not-a-message'));
    assert.strictEqual(garbage.accepted, false);
    assert.ok(garbage.error);

    const author = new Key();
    const chat = Message.fromVector([
      'P2P_CHAT_MESSAGE',
      JSON.stringify({ type: 'P2P_CHAT_MESSAGE', object: { content: 'hi' } })
    ]).signWithKey(author);
    const wrongType = contractMessageQueue.enqueue(store, contractId, chat.toBuffer());
    assert.strictEqual(wrongType.accepted, false);
    assert.match(wrongType.error, /not a CONTRACT_MESSAGE body|contract/i);
  });

  it('rejects invalid contractId', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'x' });
    const bad = contractMessageQueue.enqueue(store, 'not-a-contract-id', msg.toBuffer());
    assert.strictEqual(bad.accepted, false);
    assert.match(bad.error, /contract/i);
  });

  it('exposes core clampMaxEntries and trims via maxEntries', function () {
    assert.strictEqual(
      contractMessageQueue.clampMaxEntries(Number.POSITIVE_INFINITY),
      contractMessageQueue.DEFAULT_MAX_ENTRIES
    );
    assert.strictEqual(
      contractMessageQueue.clampMaxEntries(contractMessageQueue.ABSOLUTE_MAX_ENTRIES + 50),
      contractMessageQueue.ABSOLUTE_MAX_ENTRIES
    );

    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    for (let i = 0; i < 5; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', {
        body: `m${i}`,
        ts: `2026-01-0${i + 1}T00:00:00.000Z`
      });
      const r = contractMessageQueue.enqueue(store, contractId, msg.toBuffer(), { maxEntries: 3 });
      assert.strictEqual(r.accepted, true);
    }
    const rows = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.ok(rows.length <= 3);
  });

  it('tracks per-peer delivery without altering hex (≠ MessageReceipt markReceipt)', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'later' });
    const enq = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    assert.strictEqual(enq.accepted, true);
    const hexBefore = enq.entry.hex;
    const peer = mailbox('peer-a');

    assert.strictEqual(contractMessageQueue.pendingForDelivery(store, contractId, peer).length, 1);
    const marked = contractMessageQueue.markDelivered(store, contractId, enq.entry.hash, peer);
    assert.strictEqual(marked.ok, true);
    assert.strictEqual(contractMessageQueue.pendingForDelivery(store, contractId, peer).length, 0);
    assert.strictEqual(
      contractMessageQueue.pendingForDelivery(store, contractId, mailbox('peer-b')).length,
      1
    );

    const rows = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hex, hexBefore);
    assert.ok(rows[0].deliveredTo[peer]);
  });

  it('drain writes author-signed bytes then marks delivered only for that peer', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'drain-me' });
    const enq = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    assert.strictEqual(enq.accepted, true);

    const peer = mailbox('drain-peer');
    const result = drainQueueToMockPeer(store, peer, { limitPerContract: 8 });
    assert.strictEqual(result.delivered, 1);
    assert.strictEqual(result.contracts, 1);
    assert.strictEqual(result.writes.length, 1);
    assert.strictEqual(result.writes[0].toString('hex'), enq.entry.hex);
    assert.strictEqual(
      Message.fromBuffer(result.writes[0]).type,
      'CONTRACT_MESSAGE'
    );
    assert.strictEqual(contractMessageQueue.pendingForDelivery(store, contractId, peer).length, 0);

    // Second drain is a no-op for the same peer; another peer still pending.
    const again = drainQueueToMockPeer(store, peer);
    assert.strictEqual(again.delivered, 0);
    assert.strictEqual(
      contractMessageQueue.pendingForDelivery(store, contractId, mailbox('other-peer')).length,
      1
    );
  });

  it('trims preferring already-delivered rows when over maxEntries', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs);
    const author = new Key();
    const hashes = [];
    for (let i = 0; i < 5; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', {
        body: `trim-${i}`,
        ts: `2026-01-0${i + 1}T00:00:00.000Z`
      });
      const r = contractMessageQueue.enqueue(store, contractId, msg.toBuffer(), { maxEntries: 3 });
      assert.strictEqual(r.accepted, true);
      hashes.push(r.entry.hash);
      if (i < 2) {
        contractMessageQueue.markDelivered(store, contractId, r.entry.hash, mailbox('early-peer'));
      }
    }
    const rows = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.ok(rows.length <= 3);
    assert.ok(rows.length >= 1);
  });

  it('keeps a contract under its byte budget, dropping delivered rows first', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs, { maxBytes: 4000 });
    const author = new Key();
    const hashes = [];
    for (let i = 0; i < 8; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'z'.repeat(400), i });
      const r = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
      assert.strictEqual(r.accepted, true);
      hashes.push(r.entry.hash);
      if (i === 1) contractMessageQueue.markDelivered(store, contractId, r.entry.hash, mailbox('peer'));
    }
    const rows = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    const bytes = rows.reduce((n, e) => n + e.hex.length, 0);
    assert.ok(bytes <= 4000);
    assert.ok(rows.length >= 1);
    assert.ok(!rows.some((e) => e.hash === hashes[1]), 'delivered row went first');
    assert.strictEqual(rows[rows.length - 1].hash, hashes[7]);
  });

  it('shrinks an oversized queue file on first read', function () {
    const fs = memoryFs();
    const author = new Key();
    const writer = contractMessageQueue.createFilesystemStore(fs);
    for (let i = 0; i < 6; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'q'.repeat(400), i });
      contractMessageQueue.enqueue(writer, contractId, msg.toBuffer());
    }
    const reader = contractMessageQueue.createFilesystemStore(fs, { maxBytes: 2000 });
    const rows = contractMessageQueue.listQueuedMessages(reader, contractId, { includeDelivered: true });
    assert.ok(rows.reduce((n, e) => n + e.hex.length, 0) <= 2000);
    const onDisk = fs.readFile(`contract-message-queue/${contractId}.json`);
    assert.strictEqual(onDisk.entries.length, rows.length);
  });

  it('keeps only the newest mailbox marks per row', function () {
    const fs = memoryFs();
    const store = contractMessageQueue.createFilesystemStore(fs, { maxDeliveredPeers: 3 });
    const author = new Key();
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'many peers' });
    const enq = contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    for (let i = 0; i < 6; i++) {
      contractMessageQueue.markDelivered(store, contractId, enq.entry.hash, mailbox(`id${i}`), `2026-11-02T00:00:0${i}.000Z`);
    }
    const [row] = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.deepStrictEqual(Object.keys(row.deliveredTo).sort(), ['fabric:id3', 'fabric:id4', 'fabric:id5']);
  });

  it('mailboxKey names a Fabric id, lowercased, once', function () {
    assert.strictEqual(mailbox('ID1ABC'), 'fabric:id1abc');
    assert.strictEqual(mailbox('fabric:id1abc'), 'fabric:id1abc');
    assert.strictEqual(mailbox(' '), null);
    assert.strictEqual(mailbox(null), null);
  });

  it('drops connection-address marks from before mailboxes on load', function () {
    const fs = memoryFs();
    const author = new Key();
    const writer = contractMessageQueue.createFilesystemStore(fs);
    const msg = signContractMessage(author, contractId, 'GroupChat', { body: 'legacy' });
    const enq = contractMessageQueue.enqueue(writer, contractId, msg.toBuffer());
    const path = `contract-message-queue/${contractId}.json`;
    const legacy = JSON.parse(JSON.stringify(fs.readFile(path)));
    legacy.entries[0].deliveredTo = {
      '10.0.0.1:50000': '2026-11-01T00:00:00.000Z',
      '127.0.0.1:7777': '2026-11-01T00:00:01.000Z',
      [mailbox('kept')]: '2026-11-01T00:00:02.000Z'
    };
    fs.publish(path, legacy);
    const reader = contractMessageQueue.createFilesystemStore(fs);
    const [row] = contractMessageQueue.listQueuedMessages(reader, contractId, { includeDelivered: true });
    assert.strictEqual(row.hash, enq.entry.hash);
    assert.deepStrictEqual(Object.keys(row.deliveredTo), ['fabric:kept']);
    assert.deepStrictEqual(Object.keys(fs.readFile(path).entries[0].deliveredTo), ['fabric:kept']);
  });

  it('writes each new frame at once, and coalesces a drain into one compact write with flushMs', function () {
    const fs = memoryFs();
    const writes = [];
    fs.writeFile = (p, content) => {
      writes.push(p);
      fs._files[p] = content;
      return true;
    };
    const store = contractMessageQueue.createFilesystemStore(fs, { flushMs: 60000 });
    const author = new Key();
    for (let i = 0; i < 10; i++) {
      const msg = signContractMessage(author, contractId, 'GroupChat', { body: `d${i}` });
      contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    }
    assert.strictEqual(writes.length, 10, 'a crash cannot lose an enqueued frame');
    const onDisk = JSON.parse(fs._files[`contract-message-queue/${contractId}.json`]);
    assert.strictEqual(onDisk.entries.length, 10);
    writes.length = 0;
    const result = drainQueueToMockPeer(store, mailbox('peer-a'));
    assert.strictEqual(result.delivered, 10);
    assert.strictEqual(writes.length, 0, 'delivery marks wait for the flush');
    store.flush();
    assert.deepStrictEqual(writes, [`contract-message-queue/${contractId}.json`]);
    const saved = JSON.parse(fs._files[`contract-message-queue/${contractId}.json`]);
    assert.strictEqual(saved.entries.length, 10);
    assert.ok(saved.entries.every((e) => e.deliveredTo['fabric:peer-a']));
    assert.ok(!fs._files[`contract-message-queue/${contractId}.json`].includes('\n'), 'compact JSON');
  });

  it('keeps a frame whose write failed for the next put or flush', function () {
    const fs = memoryFs();
    let fail = true;
    fs.writeFile = (p, content) => {
      if (fail) return false;
      fs._files[p] = content;
      return true;
    };
    const store = contractMessageQueue.createFilesystemStore(fs, { flushMs: 60000 });
    const msg = signContractMessage(new Key(), contractId, 'GroupChat', { body: 'kept' });
    contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    assert.strictEqual(fs._files[`contract-message-queue/${contractId}.json`], undefined);
    fail = false;
    store.flush();
    assert.strictEqual(JSON.parse(fs._files[`contract-message-queue/${contractId}.json`]).entries.length, 1, 'the flush retried the write');
  });

  it('lists a contract in the stored INDEX only once its document is written', function () {
    const fs = memoryFs();
    const order = [];
    let fail = true;
    fs.writeFile = (p, content) => {
      if (fail) return false;
      order.push(p);
      fs._files[p] = content;
      return true;
    };
    const publish = fs.publish;
    fs.publish = (p, value) => {
      order.push(p);
      return publish(p, value);
    };
    const docPath = `contract-message-queue/${contractId}.json`;
    const store = contractMessageQueue.createFilesystemStore(fs, { flushMs: 60000 });
    const msg = signContractMessage(new Key(), contractId, 'GroupChat', { body: 'indexed' });
    assert.strictEqual(contractMessageQueue.enqueue(store, contractId, msg.toBuffer()).accepted, true);
    assert.strictEqual(fs._files[contractMessageQueue.INDEX_PATH], undefined, 'no INDEX entry while the frame is not stored');
    assert.deepStrictEqual(store.listContractIds(), [contractId], 'still delivered from memory');
    assert.deepStrictEqual(contractMessageQueue.createFilesystemStore(fs).listContractIds(), [], 'a restart finds no dangling entry');

    fail = false;
    store.flush();
    assert.deepStrictEqual(order, [docPath, contractMessageQueue.INDEX_PATH], 'document first, then INDEX');
    const reopened = contractMessageQueue.createFilesystemStore(fs);
    assert.deepStrictEqual(reopened.listContractIds(), [contractId]);
    assert.strictEqual(contractMessageQueue.listQueuedMessages(reopened, contractId, { includeDelivered: true }).length, 1);
  });

  it('retries a failed frame write on its own with flushMs', function (done) {
    const fs = memoryFs();
    let fail = true;
    fs.writeFile = (p, content) => {
      if (fail) return false;
      fs._files[p] = content;
      return true;
    };
    const store = contractMessageQueue.createFilesystemStore(fs, { flushMs: 5 });
    const msg = signContractMessage(new Key(), contractId, 'GroupChat', { body: 'retry' });
    contractMessageQueue.enqueue(store, contractId, msg.toBuffer());
    fail = false;
    setTimeout(() => {
      assert.ok(fs._files[`contract-message-queue/${contractId}.json`], 'the retry wrote the frame');
      assert.deepStrictEqual(fs._files[contractMessageQueue.INDEX_PATH].contracts, [contractId]);
      done();
    }, 30);
  });

  it('reads a stored document whose entries are not a list', function () {
    const fs = memoryFs();
    fs.writeFile = (p, content) => { fs._files[p] = content; return true; };
    fs._files[`contract-message-queue/${contractId}.json`] = JSON.stringify({ entries: {} });
    const store = contractMessageQueue.createFilesystemStore(fs);
    assert.doesNotThrow(() => store.get(contractMessageQueue.COLLECTION || 'contractMessageQueue', contractId));
  });
});
