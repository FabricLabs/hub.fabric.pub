'use strict';

const assert = require('assert');
const c = require('../functions/beaconFederationConstants');

describe('beaconFederationConstants', () => {
  it('exposes default 144-block L1 maturity', () => {
    assert.strictEqual(c.DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS, 144);
  });

  it('exposes positive regtest interval minutes', () => {
    assert.ok(Number.isFinite(c.REGTEST_EPOCH_INTERVAL_MINUTES));
    assert.ok(c.REGTEST_EPOCH_INTERVAL_MINUTES >= 1);
  });
});
