'use strict';

const assert = require('assert');
const {
  buildPayjoinJoinmarketTaproot,
  resolveBeaconFederationXOnly,
  TEMPLATE_ID,
  JOINMARKET_TAPROOT_CONTRACT_VERSION
} = require('../functions/payjoinJoinmarketTaproot');

describe('payjoinJoinmarketTaproot', () => {
  const op = Buffer.from(
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    'hex'
  );

  it('buildPayjoinJoinmarketTaproot returns template metadata and address', () => {
    const fed = resolveBeaconFederationXOnly({ networkName: 'regtest' });
    const b = buildPayjoinJoinmarketTaproot({
      networkName: 'regtest',
      operatorPubkeyCompressed: op,
      federationXOnly: fed
    });
    assert.strictEqual(b.template, TEMPLATE_ID);
    assert.strictEqual(b.contractVersion, JOINMARKET_TAPROOT_CONTRACT_VERSION);
    assert.ok(/^bcrt1/.test(b.address), 'regtest bech32');
    assert.strictEqual(b.leafOrder.length, 2);
    assert.ok(b.leaves.joinmarket_operator.scriptHex.length > 0);
    assert.ok(b.leaves.beacon_federation_reserve.scriptHex.length > 0);
  });

  it('resolveBeaconFederationXOnly uses regtest placeholder when unset', () => {
    const x = resolveBeaconFederationXOnly({ networkName: 'regtest' });
    assert.strictEqual(x.length, 32);
  });

  it('resolveBeaconFederationXOnly throws on mainnet without config', () => {
    assert.throws(
      () => resolveBeaconFederationXOnly({ networkName: 'mainnet' }),
      /Beacon federation x-only is required/
    );
  });
});
