'use strict';

const assert = require('assert');
const tac = require('../functions/trackedApplicationContracts');
const Beacon = require('../contracts/beacon');

describe('trackedApplicationContracts', function () {
  it('record → accept updates stateRoot', function () {
    const state = tac.emptyState();
    const root0 = tac.computeStateRoot(state);
    const pub = tac.recordPublish(state, {
      contractId: 'c1',
      definition: { name: 'GoonCitizen', version: 1, state: {} },
      signer: 'aa'
    });
    assert.strictEqual(pub.status, 'pending');
    assert.ok(state.pending.c1);
    const accepted = tac.acceptContract(state, 'c1', { acceptedBy: 'hub' });
    assert.strictEqual(accepted.status, 'accepted');
    assert.ok(!state.pending.c1);
    assert.ok(state.accepted.c1);
    const root1 = tac.computeStateRoot(state);
    assert.notStrictEqual(root1, root0);
    assert.strictEqual(state.stateRoot, root1);
  });

  it('reject removes pending and accepted', function () {
    const state = tac.emptyState();
    tac.recordPublish(state, { contractId: 'c2', definition: { name: 'X' } });
    tac.rejectContract(state, 'c2');
    assert.ok(!state.pending.c2);
    assert.ok(!state.accepted.c2);
  });

  it('updateContractStateDigest only touches accepted', function () {
    const state = tac.emptyState();
    tac.recordPublish(state, { contractId: 'c3', definition: { name: 'GoonCitizen' } });
    assert.strictEqual(tac.updateContractStateDigest(state, 'c3', 'deadbeef'), null);
    tac.acceptContract(state, 'c3');
    const entry = tac.updateContractStateDigest(state, 'c3', 'deadbeef');
    assert.ok(entry);
    assert.strictEqual(entry.stateDigest, 'deadbeef');
  });

  it('beaconSnapshot exposes stateDigest for epoch merge', function () {
    const state = tac.emptyState();
    tac.recordPublish(state, { contractId: 'c4', definition: { name: 'App' } });
    tac.acceptContract(state, 'c4');
    const snap = tac.beaconSnapshot(state);
    assert.strictEqual(snap.kind, 'TrackedApplicationContracts');
    assert.strictEqual(snap.acceptedCount, 1);
    assert.strictEqual(snap.stateDigest, tac.computeStateRoot(state));
  });

  it('Beacon epoch payload includes contracts snapshot', function () {
    const beacon = new Beacon({ name: 'test', interval: 0, regtest: true });
    const state = tac.emptyState();
    tac.recordPublish(state, { contractId: 'c5', definition: { name: 'GoonCitizen', version: 1 } });
    tac.acceptContract(state, 'c5');
    beacon.attach({
      getContractsSnapshotForEpoch: () => tac.beaconSnapshot(state)
    });
    const entry = beacon._buildEpochEntry({
      clock: 1,
      blockHash: '00',
      height: 1,
      balance: 0,
      balanceSats: 0,
      timestamp: Date.now()
    });
    assert.ok(entry.payload.contracts);
    assert.strictEqual(entry.payload.contracts.stateDigest, tac.computeStateRoot(state));
    assert.strictEqual(entry.payload.contracts.kind, 'TrackedApplicationContracts');
  });
});
