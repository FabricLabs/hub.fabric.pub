'use strict';

const assert = require('assert');
const { inAppNotificationOpenHref } = require('../functions/inAppNotificationOpenHref');

describe('inAppNotificationOpenHref', function () {
  it('returns null for payments path when bitcoinPayments is off', function () {
    const uf = { bitcoinPayments: false, bitcoinExplorer: true };
    assert.strictEqual(inAppNotificationOpenHref('/payments/foo', uf), null);
  });

  it('returns href for payments path when bitcoinPayments is on', function () {
    const uf = { bitcoinPayments: true };
    assert.strictEqual(inAppNotificationOpenHref('/payments/foo', uf), '/payments/foo');
  });

  it('returns href for generic bitcoin service path', function () {
    const uf = {};
    assert.strictEqual(inAppNotificationOpenHref('/services/bitcoin/foo', uf), '/services/bitcoin/foo');
  });
});
