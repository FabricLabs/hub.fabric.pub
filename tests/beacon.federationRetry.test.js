'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Beacon = require('../contracts/beacon');
const Chain = require('@fabric/core/types/chain');
const beaconFederationSigning = require('../functions/beaconFederationSigning');

describe('Beacon federation ready-round retry', function () {
  it('finalizes an already-ready round instead of rejecting round not open', async function () {
    const b = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    b.fs = {
      readFile: () => null,
      publish: async () => {}
    };
    const k1 = new Key({ private: '3333333333333333333333333333333333333333333333333333333333333333' });
    const payload = { clock: 3, height: 3, blockHash: 'cc'.repeat(32) };
    const round = beaconFederationSigning.createRound(payload, {
      validators: [k1.pubkey],
      threshold: 1
    });
    const msg = beaconFederationSigning.messageBufferForPayload(payload);
    const added = beaconFederationSigning.addSignature(
      round, k1.pubkey, k1.signSchnorr(msg).toString('hex')
    );
    assert.strictEqual(added.sealed, true);
    const digest = round.commitmentDigest;
    b._pendingEpochRounds.set(digest, round);

    const result = await b.submitFederationEpochSignature(digest, k1.pubkey, '00');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.sealed, true);
    assert.strictEqual(b._epochChain.tip.payload.clock, 3);
    assert.strictEqual(b._pendingEpochRounds.has(digest), false);
  });

  it('rejects a recovered ready round whose witness fails the threshold', async function () {
    const b = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    b.fs = {
      readFile: () => null,
      publish: async () => {}
    };
    const payload = { clock: 5, height: 5, blockHash: 'ee'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    b._pendingEpochRounds.set(digest, {
      commitmentDigest: digest,
      payload,
      validators: ['aa'.repeat(32)],
      threshold: 1,
      witness: { version: 1, signatures: { ['aa'.repeat(32)]: '00' } },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const result = await b.submitFederationEpochSignature(digest, 'aa'.repeat(32), '00');
    assert.strictEqual(result.status, 'error');
    assert.match(String(result.message), /threshold/i);
    assert.strictEqual(b._epochChain.height, 0);
  });

  it('does not double-append when the ready round is already on the epoch chain', async function () {
    const b = new Beacon({ regtest: true, mineOnStart: false, interval: 0 });
    b.fs = {
      readFile: () => null,
      publish: async () => {}
    };
    const payload = { clock: 4, height: 4, blockHash: 'dd'.repeat(32) };
    const digest = beaconFederationSigning.epochCommitmentDigestHex(payload);
    const round = {
      commitmentDigest: digest,
      payload,
      validators: ['aa'],
      threshold: 1,
      witness: { version: 1, signatures: { aa: '00' } },
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
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
