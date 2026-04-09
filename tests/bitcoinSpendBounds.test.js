'use strict';

const assert = require('assert');
const {
  satPerVbyteFromMempoolInfo,
  utxoAmountsFromList,
  simulateP2wpkhPayment,
  maxSpendableSatsBinarySearch,
  computeHubWalletSpendHints,
  DUST_P2WPKH_SATS
} = require('../functions/bitcoinSpendBounds');

describe('bitcoinSpendBounds', function () {
  it('satPerVbyteFromMempoolInfo falls back on regtest', function () {
    const r = satPerVbyteFromMempoolInfo({}, 'regtest');
    assert.strictEqual(r, 1);
  });

  it('satPerVbyteFromMempoolInfo uses mempoolminfee', function () {
    // 0.00001 BTC/kB => 1 sat/vB
    const r = satPerVbyteFromMempoolInfo({ mempoolminfee: 0.00001 }, 'main');
    assert.ok(Math.abs(r - 1) < 1e-6);
  });

  it('utxoAmountsFromList sorts descending', function () {
    const a = utxoAmountsFromList([
      { amountSats: 100 },
      { amount: 0.000002 } // 200 sats
    ]);
    assert.deepStrictEqual(a, [200, 100]);
  });

  it('simulateP2wpkhPayment succeeds with one large UTXO', function () {
    const sim = simulateP2wpkhPayment(50000, [200000], 1);
    assert.strictEqual(sim.ok, true);
    assert(sim.feeSats > 0);
  });

  it('simulateP2wpkhPayment fails when coins are too small', function () {
    const sim = simulateP2wpkhPayment(50000, [1000, 1000], 10);
    assert.strictEqual(sim.ok, false);
  });

  it('maxSpendableSatsBinarySearch matches simulation ceiling', function () {
    const utxos = [50000, 50000];
    const rate = 1;
    const max = maxSpendableSatsBinarySearch(utxos, rate, 100000);
    assert(max > 0);
    assert.strictEqual(simulateP2wpkhPayment(max + 1, utxos, rate).ok, false);
    assert.strictEqual(simulateP2wpkhPayment(max, utxos, rate).ok, true);
  });

  it('computeHubWalletSpendHints marks fragmentedVsSingle when one coin cannot cover amount+fee', function () {
    const h = computeHubWalletSpendHints({
      balanceSats: 100000,
      utxos: [{ amountSats: 40000 }, { amountSats: 40000 }],
      mempoolInfo: {},
      network: 'regtest',
      targetAmountSats: 50000
    });
    assert.strictEqual(h.hadUtxoList, true);
    assert.strictEqual(h.fragmentedVsSingle, true);
  });

  it('computeHubWalletSpendHints canPayTarget false when fee rate consumes the set', function () {
    const h = computeHubWalletSpendHints({
      balanceSats: 6000,
      utxos: [{ amountSats: 3000 }, { amountSats: 3000 }],
      mempoolInfo: { mempoolminfee: 0.1 },
      network: 'main',
      targetAmountSats: 5000
    });
    assert.strictEqual(h.canPayTarget, false);
  });

  it('computeHubWalletSpendHints leaves canPayTarget null without UTXOs', function () {
    const h = computeHubWalletSpendHints({
      balanceSats: 100000,
      utxos: [],
      mempoolInfo: {},
      network: 'regtest',
      targetAmountSats: 10000
    });
    assert.strictEqual(h.canPayTarget, null);
    assert.strictEqual(h.minRecipientSats, DUST_P2WPKH_SATS);
  });
});
