'use strict';

const assert = require('assert');
const {
  mergePaymentMemoWithFederation,
  federationMemoFragmentFromPrefs
} = require('../functions/federationSpendingPrefs');

describe('federationSpendingPrefs', function () {
  it('mergePaymentMemoWithFederation leaves memo when federation off', function () {
    assert.strictEqual(
      mergePaymentMemoWithFederation('hello', { spendingCriteriaDraft: 'x' }, false),
      'hello'
    );
  });

  it('mergePaymentMemoWithFederation appends criteria fragment', function () {
    const m = mergePaymentMemoWithFederation(
      'pay vendor',
      { spendingCriteriaDraft: 'two keys for >1M sats' },
      true
    );
    assert.ok(m.includes('pay vendor'));
    assert.ok(m.includes('[Fabric federation spending criteria]'));
    assert.ok(m.includes('two keys'));
  });

  it('federationMemoFragmentFromPrefs returns empty when no draft', function () {
    assert.strictEqual(federationMemoFragmentFromPrefs({ spendingCriteriaDraft: '' }), '');
  });
});
