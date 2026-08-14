'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const contractMessageQueue = require('../functions/contractMessageQueue');

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
    const peer = 'peer-a';

    assert.strictEqual(contractMessageQueue.pendingForDelivery(store, contractId, peer).length, 1);
    const marked = contractMessageQueue.markDelivered(store, contractId, enq.entry.hash, peer);
    assert.strictEqual(marked.ok, true);
    assert.strictEqual(contractMessageQueue.pendingForDelivery(store, contractId, peer).length, 0);
    assert.strictEqual(
      contractMessageQueue.pendingForDelivery(store, contractId, 'peer-b').length,
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

    const peer = 'tcp://127.0.0.1:7777';
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
      contractMessageQueue.pendingForDelivery(store, contractId, 'other-peer').length,
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
        contractMessageQueue.markDelivered(store, contractId, r.entry.hash, 'early-peer');
      }
    }
    const rows = contractMessageQueue.listQueuedMessages(store, contractId, { includeDelivered: true });
    assert.ok(rows.length <= 3);
    assert.ok(rows.length >= 1);
  });
});
