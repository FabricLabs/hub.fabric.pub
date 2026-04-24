'use strict';

const assert = require('assert');
const {
  parseBitcoinUriForPayjoin,
  chainIndexFromDescriptor,
  estimateP2wpkhFeeSats
} = require('../functions/payjoinBrowserWallet');

describe('payjoinBrowserWallet', function () {
  it('parseBitcoinUriForPayjoin extracts pj URL and amount', function () {
    const uri = 'bitcoin:tb1qexample?amount=0.00001&pj=https%3A%2F%2Freceiver.test%2Fpayjoin';
    const p = parseBitcoinUriForPayjoin(uri);
    assert.ok(p);
    assert.strictEqual(p.address, 'tb1qexample');
    assert.strictEqual(p.pjUrl, 'https://receiver.test/payjoin');
    assert.strictEqual(p.amountSats, 1000);
  });

  it('parseBitcoinUriForPayjoin rejects pj without http(s)', function () {
    const p = parseBitcoinUriForPayjoin('bitcoin:tb1q?pj=ftp%3A%2F%2Fx');
    assert.strictEqual(p, null);
  });

  it('chainIndexFromDescriptor parses Core-style wpkh path suffix', function () {
    const d = 'wpkh([deadbeef/84\'/1\'/0\']tpubABC/0/7)#checksum';
    const c = chainIndexFromDescriptor(d);
    assert.deepStrictEqual(c, { chain: 0, index: 7 });
  });

  it('estimateP2wpkhFeeSats is positive', function () {
    assert.ok(estimateP2wpkhFeeSats(2, 2, 2) > 0);
  });
});
