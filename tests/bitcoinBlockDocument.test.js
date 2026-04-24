'use strict';

const assert = require('assert');
const {
  buildBitcoinBlockSummary,
  bitcoinBlockDocumentBuffer,
  bitcoinBlockDocumentId
} = require('../functions/bitcoinBlockDocument');

describe('bitcoinBlockDocument', function () {
  const block = {
    hash: 'aa'.repeat(32),
    height: 7,
    time: 1700000000,
    mediantime: 1699999900,
    tx: [{ txid: 'bb'.repeat(32) }, 'cc'.repeat(32)],
    merkleroot: 'dd'.repeat(32),
    nTx: 2,
    previousblockhash: 'ee'.repeat(32),
    version: 536870912,
    bits: '207fffff',
    nonce: 2,
    difficulty: 4,
    size: 285,
    weight: 1140
  };

  it('buildBitcoinBlockSummary keeps consensus header + txids only', function () {
    const s = buildBitcoinBlockSummary(block, 'regtest');
    assert.strictEqual(s.type, 'BitcoinBlock');
    assert.strictEqual(s.schemaVersion, 3);
    assert.strictEqual(s.network, 'regtest');
    assert.strictEqual(s.hash, block.hash);
    assert.strictEqual(s.height, 7);
    assert.deepStrictEqual(s.txids, ['bb'.repeat(32), 'cc'.repeat(32)]);
    assert.strictEqual(s.confirmations, undefined);
    assert.strictEqual(s.nextblockhash, undefined);
    assert.strictEqual(s.nTx, undefined);
    assert.strictEqual(s.difficulty, undefined);
    assert.strictEqual(s.chainwork, undefined);
    assert.strictEqual(s.size, undefined);
    assert.strictEqual(s.weight, undefined);
    assert.strictEqual(s.versionHex, undefined);
  });

  it('document id ignores chain-mutable and derived RPC fields', function () {
    const a = { ...block, confirmations: 1 };
    const b = {
      ...block,
      confirmations: 99,
      nextblockhash: 'ff'.repeat(32),
      difficulty: 999,
      chainwork: 'ffff',
      size: 99999,
      weight: 99999,
      strippedsize: 1,
      nTx: 99,
      versionHex: 'deadbeef'
    };
    assert.strictEqual(bitcoinBlockDocumentId(a, 'regtest'), bitcoinBlockDocumentId(b, 'regtest'));
  });

  it('produces stable document id for the same block', function () {
    const id1 = bitcoinBlockDocumentId(block, 'regtest');
    const id2 = bitcoinBlockDocumentId(block, 'regtest');
    assert.strictEqual(id1, id2);
    assert.strictEqual(id1.length, 64);
    const buf1 = bitcoinBlockDocumentBuffer(block, 'regtest');
    const buf2 = bitcoinBlockDocumentBuffer(block, 'regtest');
    assert.ok(buf1.equals(buf2));
  });

  it('changes id when network changes', function () {
    const a = bitcoinBlockDocumentId(block, 'regtest');
    const b = bitcoinBlockDocumentId(block, 'mainnet');
    assert.notStrictEqual(a, b);
  });
});
