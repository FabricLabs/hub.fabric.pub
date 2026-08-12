'use strict';

const assert = require('assert');
const Beacon = require('../contracts/beacon');
const Chain = require('@fabric/core/types/chain');
const beaconFederationSigning = require('../functions/beaconFederationSigning');

describe('Beacon federation ready-round retry', function () {
  function readyRound (payload) {
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    return {
      digest,
      round: {
        commitmentDigest: digest,
        payload,
        validators: ['aa'],
        threshold: 1,
        witness: { version: 1, signatures: { aa: '00' } },
        status: 'ready',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  }

  it('finalizes an already-ready round instead of rejecting round not open', async function () {
    const b = new Beacon();
    b.fs = {
      readFile: () => null,
      publish: async () => {}
    };
    const payload = { clock: 3, height: 3, blockHash: 'cc' };
    const { digest, round } = readyRound(payload);
    b._pendingEpochRounds.set(digest, round);

    const result = await b.submitFederationEpochSignature(digest, 'aa', '00');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.sealed, true);
    assert.strictEqual(b._epochChain.tip.payload.clock, 3);
    assert.strictEqual(b._pendingEpochRounds.has(digest), false);
  });

  it('does not double-append when the ready round is already on the epoch chain', async function () {
    const b = new Beacon();
    b.fs = {
      readFile: () => null,
      publish: async () => {}
    };
    const payload = { clock: 4, height: 4, blockHash: 'dd' };
    const { digest, round } = readyRound(payload);
    b._epochChain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload, federationWitness: round.witness }
    ]);
    b._pendingEpochRounds.set(digest, round);

    const result = await b.submitFederationEpochSignature(digest, 'aa', '00');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.sealed, true);
    assert.strictEqual(b._epochChain.height, 1);
    assert.strictEqual(b._pendingEpochRounds.has(digest), false);
  });
});
