'use strict';

const assert = require('assert');
const { buildTabPayerDemoUrl, buildTabPayerPayjoinUrl } = require('../functions/tabPayerDemoUrl');

describe('tabPayerDemoUrl', () => {
  it('returns # without address', () => {
    assert.strictEqual(buildTabPayerDemoUrl('', 1000, 'http://localhost:8080'), '#');
    assert.strictEqual(buildTabPayerDemoUrl('  ', 1000, 'http://localhost:8080'), '#');
  });

  it('builds payments URL with query and hash (explicit origin)', () => {
    const u = buildTabPayerDemoUrl('bc1qtest', 42_000, 'http://127.0.0.1:8080');
    assert.strictEqual(
      u,
      'http://127.0.0.1:8080/payments?payTo=bc1qtest&payAmountSats=42000#fabric-btc-make-payment-h4'
    );
  });

  it('strips trailing slash on origin', () => {
    const u = buildTabPayerDemoUrl('addr1', 1, 'https://hub.example/');
    assert.strictEqual(
      u,
      'https://hub.example/payments?payTo=addr1&payAmountSats=1#fabric-btc-make-payment-h4'
    );
  });

  it('omits payAmountSats when not a positive finite number', () => {
    const u = buildTabPayerDemoUrl('addr1', NaN, 'http://h/');
    assert.strictEqual(
      u,
      'http://h/payments?payTo=addr1#fabric-btc-make-payment-h4'
    );
  });

  it('does not add bip44Account (fixed identity account 0 for payments)', () => {
    const u = buildTabPayerDemoUrl('bc1qtest', 1000, 'http://127.0.0.1:8080');
    assert.ok(!u.includes('bip44Account'));
    assert.ok(u.includes('payAmountSats=1000'));
  });

  it('buildTabPayerPayjoinUrl encodes bitcoinUri for Payjoin BIP21', () => {
    const pj = 'bitcoin:bcrt1qqq?amount=0.00025&pj=https%3A%2F%2Fhub%2Fservices%2Fpayjoin%2Fsessions%2Fx%2Fproposals';
    const u = buildTabPayerPayjoinUrl(pj, 'http://127.0.0.1:8080');
    assert.ok(u.includes('bitcoinUri='));
    assert.ok(u.includes(encodeURIComponent('bitcoin:bcrt1qqq')));
    assert.ok(u.endsWith('#fabric-btc-make-payment-h4'));
  });

  it('buildTabPayerPayjoinUrl returns # for non-bitcoin URI', () => {
    assert.strictEqual(buildTabPayerPayjoinUrl('', 'http://127.0.0.1:8080'), '#');
    assert.strictEqual(buildTabPayerPayjoinUrl('lightning:lnbc1…', 'http://127.0.0.1:8080'), '#');
  });
});
