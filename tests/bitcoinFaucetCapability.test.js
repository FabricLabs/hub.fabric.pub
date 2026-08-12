'use strict';

const assert = require('assert');
const {
  FAUCET_MAX_SATS,
  FAUCET_ENDPOINT,
  isFaucetNetwork,
  buildFaucetServiceDescriptor,
  faucetFromOptionsDocument
} = require('../functions/bitcoinFaucetCapability');

describe('functions/bitcoinFaucetCapability', function () {
  it('isFaucetNetwork accepts only regtest', function () {
    assert.strictEqual(isFaucetNetwork('regtest'), true);
    assert.strictEqual(isFaucetNetwork('REGTEST'), true);
    assert.strictEqual(isFaucetNetwork('signet'), false);
    assert.strictEqual(isFaucetNetwork('testnet'), false);
    assert.strictEqual(isFaucetNetwork('mainnet'), false);
    assert.strictEqual(isFaucetNetwork(null), false);
  });

  it('buildFaucetServiceDescriptor returns null off-regtest', function () {
    assert.strictEqual(buildFaucetServiceDescriptor({ network: 'signet', bitcoinAvailable: true }), null);
    assert.strictEqual(buildFaucetServiceDescriptor({ network: 'mainnet', bitcoinAvailable: true }), null);
    assert.strictEqual(buildFaucetServiceDescriptor({ network: 'testnet', bitcoinAvailable: true }), null);
  });

  it('buildFaucetServiceDescriptor returns null when Bitcoin unavailable', function () {
    assert.strictEqual(buildFaucetServiceDescriptor({
      network: 'regtest',
      bitcoinAvailable: false,
      balanceSats: 1e8
    }), null);
  });

  it('buildFaucetServiceDescriptor advertises Beacon faucet on regtest', function () {
    const svc = buildFaucetServiceDescriptor({
      network: 'regtest',
      bitcoinAvailable: true,
      balanceSats: 250000,
      beaconClock: 12
    });
    assert.ok(svc);
    assert.strictEqual(svc.kind, 'BitcoinFaucet');
    assert.strictEqual(svc.source, 'beacon');
    assert.strictEqual(svc.network, 'regtest');
    assert.strictEqual(svc.endpointBasePath, FAUCET_ENDPOINT);
    assert.strictEqual(svc.method, 'POST');
    assert.strictEqual(svc.available, true);
    assert.strictEqual(svc.funded, true);
    assert.strictEqual(svc.balanceSats, 250000);
    assert.strictEqual(svc.maxAmountSats, FAUCET_MAX_SATS);
    assert.deepStrictEqual(svc.beacon, { clock: 12, balanceSats: 250000 });
  });

  it('buildFaucetServiceDescriptor marks funded false when Beacon balance is zero', function () {
    const svc = buildFaucetServiceDescriptor({
      network: 'regtest',
      bitcoinAvailable: true,
      balanceSats: 0,
      beaconClock: 1
    });
    assert.ok(svc);
    assert.strictEqual(svc.available, true);
    assert.strictEqual(svc.funded, false);
    assert.strictEqual(svc.balanceSats, 0);
  });

  it('faucetFromOptionsDocument reads services.faucet and rejects non-regtest', function () {
    const arc = {
      '@type': 'ApplicationResourceContract',
      services: {
        faucet: buildFaucetServiceDescriptor({
          network: 'regtest',
          bitcoinAvailable: true,
          balanceSats: 1000
        })
      }
    };
    const got = faucetFromOptionsDocument(arc);
    assert.ok(got);
    assert.strictEqual(got.endpointBasePath, FAUCET_ENDPOINT);
    assert.strictEqual(got.balanceSats, 1000);

    assert.strictEqual(faucetFromOptionsDocument({ services: {} }), null);
    assert.strictEqual(faucetFromOptionsDocument({
      services: { faucet: { available: true, network: 'mainnet', endpointBasePath: FAUCET_ENDPOINT } }
    }), null);
    assert.strictEqual(faucetFromOptionsDocument({
      services: { faucet: { available: false, network: 'regtest' } }
    }), null);
  });
});
