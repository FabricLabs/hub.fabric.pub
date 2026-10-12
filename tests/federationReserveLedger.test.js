'use strict';

const assert = require('assert');
const ledger = require('../functions/federationReserveLedger');

describe('Hub federationReserveLedger re-export', function () {
  it('exposes peg conservation helpers from @fabric/core', function () {
    assert.strictEqual(typeof ledger.applyPegInCredit, 'function');
    assert.strictEqual(typeof ledger.applyPegOutBurn, 'function');
    assert.strictEqual(typeof ledger.settlePegOutPayout, 'function');
    assert.strictEqual(typeof ledger.defaultFederationSidechainPolicy, 'function');
    const policy = ledger.defaultFederationSidechainPolicy();
    assert.ok(policy.allowedPathPrefixes.includes('/federationReserve'));
  });
});
