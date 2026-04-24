'use strict';

const assert = require('assert');
const {
  DEFAULT_POOLS_BTC,
  loadJoinmarketPoolSizesBtc,
  saveJoinmarketPoolSizesBtc
} = require('../functions/joinmarketPoolPreferences');

describe('joinmarketPoolPreferences', () => {
  it('defaults to three descending BTC tiers without window', () => {
    const p = DEFAULT_POOLS_BTC;
    assert.strictEqual(p.length, 3);
    assert.strictEqual(p[0], 0.05);
    assert.strictEqual(p[2], 0.0005);
    const loaded = loadJoinmarketPoolSizesBtc();
    assert.deepStrictEqual(loaded, [0.05, 0.005, 0.0005]);
  });

  it('saveJoinmarketPoolSizesBtc clamps invalid entries to defaults (no localStorage)', () => {
    const s = saveJoinmarketPoolSizesBtc([0.04, -1, 999999999]);
    assert.strictEqual(s[0], 0.04);
    assert.strictEqual(s[1], 0.005);
    assert.strictEqual(s[2], 0.0005);
  });
});
