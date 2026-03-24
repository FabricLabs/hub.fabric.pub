'use strict';

const assert = require('assert');
const { buildTabPayerDemoUrl } = require('../functions/tabPayerDemoUrl');

describe('tabPayerDemoUrl', () => {
  it('returns # without address', () => {
    assert.strictEqual(buildTabPayerDemoUrl('', 1000, 'http://localhost:8080'), '#');
    assert.strictEqual(buildTabPayerDemoUrl('  ', 1000, 'http://localhost:8080'), '#');
  });

  it('builds payments URL with query and hash (explicit origin)', () => {
    const u = buildTabPayerDemoUrl('bc1qtest', 42_000, 'http://127.0.0.1:8080');
    assert.strictEqual(
      u,
      'http://127.0.0.1:8080/services/bitcoin/payments?payTo=bc1qtest&payAmountSats=42000#fabric-btc-make-payment-h4'
    );
  });

  it('strips trailing slash on origin', () => {
    const u = buildTabPayerDemoUrl('addr1', 1, 'https://hub.example/');
    assert.strictEqual(
      u,
      'https://hub.example/services/bitcoin/payments?payTo=addr1&payAmountSats=1#fabric-btc-make-payment-h4'
    );
  });

  it('omits payAmountSats when not a positive finite number', () => {
    const u = buildTabPayerDemoUrl('addr1', NaN, 'http://h/');
    assert.strictEqual(
      u,
      'http://h/services/bitcoin/payments?payTo=addr1#fabric-btc-make-payment-h4'
    );
  });

  it('does not add bip44Account (fixed identity account 0 for payments)', () => {
    const u = buildTabPayerDemoUrl('bc1qtest', 1000, 'http://127.0.0.1:8080');
    assert.ok(!u.includes('bip44Account'));
    assert.ok(u.includes('payAmountSats=1000'));
  });
});
