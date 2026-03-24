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

  it('buildBitcoinBlockSummary maps header fields and txids only', function () {
    const s = buildBitcoinBlockSummary(block, 'regtest');
    assert.strictEqual(s.type, 'BitcoinBlock');
    assert.strictEqual(s.schemaVersion, 1);
    assert.strictEqual(s.network, 'regtest');
    assert.strictEqual(s.hash, block.hash);
    assert.strictEqual(s.height, 7);
    assert.deepStrictEqual(s.txids, ['bb'.repeat(32), 'cc'.repeat(32)]);
    assert.strictEqual(s.nTx, 2);
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
