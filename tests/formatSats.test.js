'use strict';

const assert = require('assert');
const { formatSatsDisplay, formatBtcFromSats } = require('../functions/formatSats');

describe('formatSats', function () {
  this.timeout(10000);
  it('formatSatsDisplay uses grouping for whole sats', () => {
    assert.strictEqual(formatSatsDisplay(1_000_000), '1,000,000');
  });

  it('formatSatsDisplay shows two decimals for sub-satoshi', () => {
    assert.strictEqual(formatSatsDisplay(0.01), '0.01');
    assert.strictEqual(formatSatsDisplay(12.345678), '12.35');
    assert.strictEqual(formatSatsDisplay(42.1), '42.10');
  });

  it('formatBtcFromSats keeps eight decimals for whole sats', () => {
    assert.strictEqual(formatBtcFromSats(1), '0.00000001');
    assert.strictEqual(formatBtcFromSats(100_000_000), '1.00000000');
  });

  it('formatBtcFromSats extends precision for fractional sats', () => {
    assert.strictEqual(formatBtcFromSats(0.01), '0.0000000001');
  });
});
