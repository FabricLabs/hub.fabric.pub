'use strict';

const assert = require('assert');
const { hubPaymentsPathFromBitcoinUri } = require('../functions/bitcoinProtocolUrl');

describe('bitcoinProtocolUrl', function () {
  it('maps plain address + amount to payTo and payAmountSats', function () {
    const r = hubPaymentsPathFromBitcoinUri(
      'bitcoin:bcrt1q8u5g6cmhrla7vpaqm7pjwe0sc6jckm9z7a68xz?amount=0.00005'
    );
    assert.ok(r);
    assert.ok(r.relativePath.includes('payTo=bcrt1q8u5g6cmhrla7vpaqm7pjwe0sc6jckm9z7a68xz'));
    assert.ok(r.relativePath.includes('payAmountSats=5000'));
    assert.ok(r.relativePath.includes('#fabric-btc-make-payment-h4'));
    assert.ok(r.relativePath.startsWith('/payments'), 'canonical Payments SPA path');
  });

  it('maps pj= to full bitcoinUri query param', function () {
    const uri = 'bitcoin:bc1qtest?amount=0.0001&pj=' + encodeURIComponent('https://receiver.example/pj');
    const r = hubPaymentsPathFromBitcoinUri(uri);
    assert.ok(r);
    assert.ok(r.relativePath.includes('bitcoinUri='));
    assert.ok(!r.relativePath.includes('payTo='));
    assert.ok(r.relativePath.startsWith('/payments'));
  });

  it('returns null for non-bitcoin schemes', function () {
    assert.strictEqual(hubPaymentsPathFromBitcoinUri('https://x.test/a'), null);
    assert.strictEqual(hubPaymentsPathFromBitcoinUri('lightning:lnbc1fake'), null);
  });
});
