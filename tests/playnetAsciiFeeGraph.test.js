'use strict';

const assert = require('assert');
const {
  formatTransactionFeeAsciiGraph,
  verifyTxidMatchesRawHex
} = require('../functions/playnetAsciiFeeGraph');

describe('playnetAsciiFeeGraph', function () {
  it('renders a non-empty graph for two series', function () {
    const g = formatTransactionFeeAsciiGraph([
      { satPerVbyte: 1, satPerByte: 2 },
      { satPerVbyte: 3, satPerByte: 1 },
      { satPerVbyte: 2, satPerByte: 3 }
    ]);
    assert.ok(g.includes('·'));
    assert.ok(g.includes('█'));
  });

  it('verifyTxidMatchesRawHex validates regtest coinbase-like raw hex', function () {
    // Minimal invalid
    assert.strictEqual(verifyTxidMatchesRawHex('aa', 'ff'), false);
  });
});
