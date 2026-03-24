'use strict';

const assert = require('assert');
const {
  federationSummaryFromManifest,
  beaconEpochWitnessDetail
} = require('../functions/distributedManifestClient');

describe('distributedManifestClient', () => {
  it('federationSummaryFromManifest treats missing or empty validators as inactive', () => {
    assert.deepStrictEqual(federationSummaryFromManifest(null), {
      active: false,
      threshold: 1,
      count: 0,
      validators: []
    });
    assert.deepStrictEqual(federationSummaryFromManifest({ federation: null }), {
      active: false,
      threshold: 1,
      count: 0,
      validators: []
    });
    assert.deepStrictEqual(federationSummaryFromManifest({ federation: { validators: [], threshold: 2 } }), {
      active: false,
      threshold: 1,
      count: 0,
      validators: []
    });
  });

  it('federationSummaryFromManifest reads threshold and validators', () => {
    const s = federationSummaryFromManifest({
      federation: { validators: ['0aab', '11cc'], threshold: 2 }
    });
    assert.strictEqual(s.active, true);
    assert.strictEqual(s.threshold, 2);
    assert.strictEqual(s.count, 2);
    assert.strictEqual(s.validators.length, 2);
  });

  it('beaconEpochWitnessDetail reads last federationWitness signatures', () => {
    const empty = beaconEpochWitnessDetail({});
    assert.strictEqual(empty.hasBeacon, false);
    assert.strictEqual(empty.lastWitnessPresent, false);

    const withWitness = beaconEpochWitnessDetail({
      beacon: {
        status: 'RUNNING',
        epochCount: 3,
        last: {
          federationWitness: { version: 1, signatures: { aa: 'deadbeef' } }
        }
      }
    });
    assert.strictEqual(withWitness.hasBeacon, true);
    assert.strictEqual(withWitness.lastWitnessPresent, true);
    assert.strictEqual(withWitness.signatureCount, 1);
    assert.strictEqual(withWitness.epochCount, 3);
  });
});
