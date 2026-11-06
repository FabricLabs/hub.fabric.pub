'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Block, Transaction } = require('bitcoinjs-lib');
const BlockRelay = require('../services/blockRelay');

function makeTx (seed) {
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(crypto.createHash('sha256').update(`in-${seed}`).digest(), 0);
  tx.addOutput(Buffer.from([0x51]), BigInt(1000 + seed));
  return tx;
}

function makeBlock (n) {
  const block = new Block();
  block.version = 0x20000000;
  block.prevHash = crypto.randomBytes(32);
  block.timestamp = 1700000000;
  block.bits = 0x207fffff;
  const cb = new Transaction();
  cb.version = 2;
  cb.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('0101', 'hex'));
  cb.addOutput(Buffer.from([0x51]), 5000000000n);
  block.transactions = [cb];
  for (let i = 0; i < n; i++) block.transactions.push(makeTx(i));
  block.merkleRoot = Block.calculateMerkleRoot(block.transactions);
  for (block.nonce = 0; !block.checkProofOfWork(); block.nonce++);
  return block;
}

/** Two relays joined by an in-memory link; `b` has part of the block's txs in its mempool. */
function pair (block, mempoolTxs) {
  const hex = block.toHex();
  const clock = { t: 1000 };
  const submitted = [];
  const sent = { a: [], b: [] };
  const relays = {};
  const deliver = (to, from, body) => setImmediate(() => relays[to].handleMessage(JSON.parse(JSON.stringify(body)), from));
  relays.a = new BlockRelay({ network: 'regtest' }, {
    now: () => clock.t,
    peers: () => ['b'],
    send: (peer, body) => { sent.a.push(body.type); deliver('b', 'a', body); },
    rpc: async (method, params) => {
      if (method === 'getblock' && params[0] === block.getId()) return hex;
      throw new Error(`a: unexpected ${method}`);
    }
  });
  const pool = new Map(mempoolTxs.map((t) => [t.getId(), t]));
  relays.b = new BlockRelay({ network: 'regtest' }, {
    now: () => clock.t,
    peers: () => ['a'],
    send: (peer, body) => { sent.b.push(body.type); deliver('a', 'b', body); },
    rpc: async (method, params) => {
      if (method === 'getrawmempool') {
        return Object.fromEntries([...pool.values()].map((t) => [t.getId(), { wtxid: Buffer.from(t.getHash(true)).reverse().toString('hex') }]));
      }
      if (method === 'getrawtransaction') return pool.get(params[0]).toHex();
      if (method === 'submitblock') { submitted.push(params[0]); return null; }
      throw new Error(`b: unexpected ${method}`);
    }
  });
  return { relays, clock, submitted, sent, hex };
}

async function until (fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out');
}

describe('BlockRelay', function () {
  it('relays a compact block, fetches missing txs, and submits the rebuilt block', async function () {
    const block = makeBlock(5);
    const { relays, clock, submitted, sent, hex } = pair(block, block.transactions.slice(1, 4));
    await relays.a.onLocalBlock({ tip: block.getId(), height: 9 });
    await until(() => submitted.length === 1);
    assert.strictEqual(submitted[0], hex);
    assert.deepStrictEqual(sent.a, ['BlockRelayCompact', 'BlockRelayTxResponse']);
    // b forwards the compact block back only to peers that have not shown it — a already holds it.
    assert.deepStrictEqual(sent.b, ['BlockRelayTxRequest']);

    // b's own bitcoind announces the block after submitblock: Fabric was ahead.
    clock.t += 40;
    await relays.b.onLocalBlock({ tip: block.getId(), height: 9 });
    const status = relays.b.getStatus();
    assert.strictEqual(status.rebuilt, 1);
    assert.strictEqual(status.accepted, 1);
    const rec = status.blocks[0];
    assert.strictEqual(rec.height, 9);
    assert.strictEqual(rec.relay.fromMempool, 3);
    assert.strictEqual(rec.relay.fetched, 2);
    assert.strictEqual(rec.arrivals[0].peer, 'a');
    assert.strictEqual(rec.arrivals[0].deltaMs, -40);
    assert.deepStrictEqual(status.peers.map((p) => [p.peer, p.kind, p.aheadOfLocal]), [['a', 'compact', 1]]);
  });

  it('drops a compact block whose header fails proof of work', async function () {
    const block = makeBlock(1);
    const { relays, submitted, sent } = pair(block, []);
    const parts = require('../functions/compactBlock').buildCompactBlock(block.toHex());
    const h = Block.fromHex(parts[0].headerHex);
    do { h.nonce += 1; } while (h.checkProofOfWork());
    await relays.b.handleMessage({ ...parts[0], headerHex: h.toHex(true), hash: h.getId() }, 'a');
    assert.strictEqual(submitted.length, 0);
    assert.deepStrictEqual(sent.b, []);
    assert.strictEqual(relays.b.getStatus().tracked, 0);
  });

  it('records gossip arrivals against the local tip', function () {
    let t = 0;
    const relay = new BlockRelay({ network: 'mainnet' }, { now: () => t, peers: () => [], send () {}, rpc: async () => null });
    assert.strictEqual(relay.settings.enable, false);
    const tip = 'ab'.repeat(32);
    relay.onGossip({ tip, height: 1 }, 'x');
    t = 25;
    relay.onLocalBlock({ tip, height: 1 });
    const s = relay.getStatus();
    assert.strictEqual(s.blocks[0].arrivals[0].deltaMs, -25);
    assert.strictEqual(s.peers[0].p50Ms, -25);
  });
});
