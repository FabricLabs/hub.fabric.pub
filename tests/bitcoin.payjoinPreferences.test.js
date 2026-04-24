'use strict';

const assert = require('assert');
const {
  defaultPayjoinPreferences,
  loadPayjoinPreferences
} = require('../functions/bitcoinClient');

describe('bitcoinClient payjoin preferences', () => {
  it('defaultPayjoinPreferences enables operator and payment toggles', () => {
    const d = defaultPayjoinPreferences();
    assert.strictEqual(d.operatorDeposit, true);
    assert.strictEqual(d.paymentsReceive, true);
    assert.strictEqual(d.paymentsSend, true);
    assert.strictEqual(d.receiveTaprootJoinmarket, true);
  });

  it('loadPayjoinPreferences returns defaults without window', () => {
    const p = loadPayjoinPreferences();
    assert.deepStrictEqual(p, defaultPayjoinPreferences());
  });
});
