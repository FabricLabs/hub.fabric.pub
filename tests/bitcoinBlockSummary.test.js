'use strict';

const assert = require('assert');
const {
  summarizeBitcoinBlock,
  bitcoinBlockWindowRange
} = require('../functions/bitcoinBlockSummary');

describe('bitcoinBlockSummary', function () {
  it('summarizeBitcoinBlock maps getblock + getblockstats fields', function () {
    const summary = summarizeBitcoinBlock({
      hash: 'aa'.repeat(32),
      height: 42,
      time: 1700000000,
      tx: ['c0', 'c1', 'c2'],
      size: 1200,
      weight: 4800
    }, {
      subsidy: 5000000000,
      totalfee: 12345,
      total_out: 999999,
      avgfeerate: 7
    });
    assert.strictEqual(summary.hash, 'aa'.repeat(32));
    assert.strictEqual(summary.height, 42);
    assert.strictEqual(summary.txCount, 3);
    assert.strictEqual(summary.size, 1200);
    assert.strictEqual(summary.weight, 4800);
    assert.strictEqual(summary.rewardSats, 5000012345);
    assert.strictEqual(summary.totalFeeSats, 12345);
    assert.strictEqual(summary.totalOutSats, 999999);
    assert.strictEqual(summary.avgFeeRateSatVb, 7);
  });

  it('summarizeBitcoinBlock uses nTx when tx array missing', function () {
    const summary = summarizeBitcoinBlock({
      hash: 'bb'.repeat(32),
      height: 1,
      nTx: 11
    });
    assert.strictEqual(summary.txCount, 11);
    assert.strictEqual(summary.rewardSats, undefined);
  });

  it('summarizeBitcoinBlock returns null without hash', function () {
    assert.strictEqual(summarizeBitcoinBlock({ height: 1 }), null);
    assert.strictEqual(summarizeBitcoinBlock(null), null);
  });

  it('bitcoinBlockWindowRange clamps to tip and non-negative floor', function () {
    assert.deepStrictEqual(
      bitcoinBlockWindowRange({ around: 5, before: 10, after: 3, tipHeight: 6 }),
      { fromHeight: 0, toHeight: 6 }
    );
    assert.deepStrictEqual(
      bitcoinBlockWindowRange({ around: 100, before: 2, after: 1 }),
      { fromHeight: 98, toHeight: 101 }
    );
    assert.strictEqual(bitcoinBlockWindowRange({ around: -1 }), null);
  });
});
