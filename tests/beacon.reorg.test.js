'use strict';

const assert = require('assert');
const Beacon = require('../contracts/beacon');
const Chain = require('@fabric/core/types/chain');

describe('Beacon reorg / prune', function () {
  it('keeps epochs with height <= new inclusive tip', function () {
    const b = new Beacon();
    b._epochChain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload: { clock: 1, height: 9, blockHash: 'aa' } },
      { type: 'BEACON_EPOCH', payload: { clock: 2, height: 10, blockHash: 'bb' } }
    ]);
    b._state.content.height = 10;
    b._pruneEpochChain(9);
    assert.strictEqual(b._epochChain.height, 1);
    assert.strictEqual(b._epochChain.tip.payload.height, 9);
    assert.strictEqual(b._state.content.clock, 1);
  });

  it('records removed beacon clocks for sidechain snapshot prune', function () {
    const b = new Beacon();
    b._epochChain = Chain.fromBeaconMessages([
      { type: 'BEACON_EPOCH', payload: { clock: 10, height: 5 } },
      { type: 'BEACON_EPOCH', payload: { clock: 11, height: 6 } }
    ]);
    let reorgInfo = null;
    b.on('reorg', (i) => { reorgInfo = i; });
    b._pruneEpochChain(5);
    assert.ok(reorgInfo);
    assert.deepStrictEqual(reorgInfo.removedBeaconClocks, [11]);
  });

  it('fail-closed truncates epoch chain on invalid federation witness', function () {
    const Key = require('@fabric/core/types/key');
    const DistributedExecution = require('../functions/fabricDistributedExecution');
    const key = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const epochOk = { clock: 1, height: 1 };
    const epochBad = { clock: 2, height: 2 };
    const msg = Buffer.from(DistributedExecution.signingStringForBeaconEpoch(epochOk), 'utf8');
    const b = new Beacon({
      federationValidators: [key.pubkey],
      federationThreshold: 1,
      federationWitnessFailClosed: true
    });
    b._federationValidators = [key.pubkey];
    b._federationThreshold = 1;
    b._epochChain = Chain.fromBeaconMessages([
      {
        type: 'BEACON_EPOCH',
        payload: epochOk,
        federationWitness: { signatures: { [key.pubkey]: key.signSchnorr(msg).toString('hex') } }
      },
      { type: 'BEACON_EPOCH', payload: epochBad, federationWitness: null }
    ]);
    b._state.content.clock = 2;
    let err = null;
    b.on('error', (e) => { err = e; });
    b._verifyEpochWitnessesIfConfigured();
    assert.ok(err);
    assert.strictEqual(b._epochChain.height, 1);
    assert.strictEqual(b._epochChain.tip.payload.clock, 1);
    assert.strictEqual(b._state.content.clock, 1);
  });
});
