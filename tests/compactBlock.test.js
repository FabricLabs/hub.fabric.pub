'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Block, Transaction } = require('bitcoinjs-lib');
const {
  siphash24,
  checkHeader,
  buildCompactBlock,
  buildTxResponses,
  CompactBlockAssembly,
  MAX_SHORT_IDS_PER_PART
} = require('../functions/compactBlock');

function makeTx (seed) {
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(crypto.createHash('sha256').update(`in-${seed}`).digest(), 0);
  tx.addOutput(Buffer.from([0x51]), BigInt(1000 + seed));
  return tx;
}

function makeCoinbase () {
  const tx = new Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('0101', 'hex'));
  tx.addOutput(Buffer.from([0x51]), 5000000000n);
  return tx;
}

/** Regtest-difficulty block (bits 0x207fffff) with `n` non-coinbase txs. */
function makeBlock (n) {
  const block = new Block();
  block.version = 0x20000000;
  block.prevHash = crypto.randomBytes(32);
  block.timestamp = 1700000000;
  block.bits = 0x207fffff;
  block.transactions = [makeCoinbase()];
  for (let i = 0; i < n; i++) block.transactions.push(makeTx(i));
  block.merkleRoot = Block.calculateMerkleRoot(block.transactions);
  for (block.nonce = 0; !block.checkProofOfWork(); block.nonce++);
  return block;
}

function blockHex (block) {
  return block.toHex();
}

describe('compactBlock', function () {
  it('siphash24 matches the reference vector', function () {
    // Reference SipHash-2-4: key 00..0f, message 00..0e → a129ca6149be45e5.
    const key = Buffer.from([...Array(16).keys()]);
    const msg = Buffer.from([...Array(15).keys()]);
    const out = siphash24(key.readBigUInt64LE(0), key.readBigUInt64LE(8), msg);
    assert.strictEqual(out, 0xa129ca6149be45e5n);
  });

  it('checkHeader accepts valid PoW and refuses a broken header', function () {
    const block = makeBlock(1);
    const hex = blockHex(block).slice(0, 160);
    const ok = checkHeader(hex);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.hash, block.getId());
    const bad = Block.fromHex(hex);
    bad.bits = 0x1d00ffff; // mainnet difficulty: the nonce no longer works
    assert.strictEqual(checkHeader(bad.toHex(true)).ok, false);
    assert.strictEqual(checkHeader('00').ok, false);
  });

  it('rebuilds a block from mempool matches and a tx response', function () {
    const block = makeBlock(6);
    const hex = blockHex(block);
    const parts = buildCompactBlock(hex, { height: 7 });
    assert.strictEqual(parts.length, 1);
    const asm = new CompactBlockAssembly(parts[0]);
    assert.strictEqual(asm.height, 7);

    // Mempool holds txs 1..4 (plus an unrelated one); 5 and 6 are missing.
    const mempool = block.transactions.slice(1, 5).map((t) => ({ txid: t.getId(), wtxid: t.getId() }));
    mempool.push({ txid: makeTx(99).getId(), wtxid: makeTx(99).getId() });
    const matches = asm.matchMempool(mempool);
    assert.strictEqual(matches.length, 4);
    const byTxid = new Map(block.transactions.map((t) => [t.getId(), t.toHex()]));
    assert.strictEqual(asm.fill(matches.map((m) => ({ index: m.index, hex: byTxid.get(m.txid) }))), 4);
    assert.deepStrictEqual(asm.missing(), [5, 6]);

    const responses = buildTxResponses(hex, asm.missing());
    assert.strictEqual(asm.fill(responses[0].txs), 2);
    const built = asm.build();
    assert.strictEqual(built.ok, true, built.error);
    assert.strictEqual(built.blockHex, hex);
  });

  it('refuses a tx whose short id does not match its slot', function () {
    const block = makeBlock(2);
    const asm = new CompactBlockAssembly(buildCompactBlock(blockHex(block))[0]);
    assert.strictEqual(asm.fill([{ index: 1, hex: block.transactions[2].toHex() }]), 0);
    assert.strictEqual(asm.fill([{ index: 1, hex: makeTx(55).toHex() }]), 0);
    assert.deepStrictEqual(asm.missing(), [1, 2]);
  });

  it('refuses a compact block whose header fails proof of work', function () {
    const block = makeBlock(1);
    const part = buildCompactBlock(blockHex(block))[0];
    const h = Block.fromHex(part.headerHex);
    h.nonce += 1;
    while (h.checkProofOfWork()) h.nonce += 1;
    assert.throws(() => new CompactBlockAssembly({ ...part, headerHex: h.toHex(true), hash: h.getId() }), /proof of work/);
  });

  it('splits large blocks into parts that rebuild in any order', function () {
    const block = makeBlock(MAX_SHORT_IDS_PER_PART + 10);
    const hex = blockHex(block);
    const parts = buildCompactBlock(hex);
    assert.strictEqual(parts.length, 2);
    const asm = new CompactBlockAssembly(parts[1]);
    assert.strictEqual(asm.partsComplete, false);
    assert.deepStrictEqual(asm.missing(), []);
    asm.addPart(parts[0]);
    const missing = asm.missing();
    assert.strictEqual(missing.length, block.transactions.length - 1);
    for (const r of buildTxResponses(hex, missing)) asm.fill(r.txs);
    assert.strictEqual(asm.build().ok, true);
  });
});
