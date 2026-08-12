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
      definition: { name: 'DemoApplication', version: 1, state: {} },
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
    tac.recordPublish(state, { contractId: 'c3', definition: { name: 'DemoApplication' } });
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
    tac.recordPublish(state, { contractId: 'c5', definition: { name: 'DemoApplication', version: 1 } });
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

  it('ARC enrich maps proposedPolicy and attaches spend when core present', function () {
    const Key = require('@fabric/core/types/key');
    const k = new Key();
    const state = tac.emptyState();
    const def = {
      name: 'DemoGroup',
      version: 4,
      messageTypes: ['GroupChat', 'GroupChange'],
      proposedPolicy: { validators: [k.pubkey], threshold: 1 },
      creator: k.pubkey
    };
    const pub = tac.recordPublish(state, {
      contractId: 'arc1',
      definition: def,
      bitcoinBlockHash: 'ab'.repeat(32),
      bitcoinHeight: 12,
      network: 'regtest'
    });
    assert.strictEqual(pub.status, 'pending');
    if (pub.entry.arc) {
      assert.ok(pub.entry.arc.primitives.messageTypes.includes('GroupChat'));
      assert.strictEqual(pub.entry.bitcoinAnchor.blockHash, 'ab'.repeat(32));
      assert.ok(pub.entry.spendAddress);
      assert.match(pub.entry.spendAddress, /^bcrt1p/);
    }
    const accepted = tac.acceptContract(state, 'arc1', {
      bitcoinBlockHash: 'cd'.repeat(32),
      bitcoinHeight: 13,
      network: 'regtest'
    });
    assert.strictEqual(accepted.status, 'accepted');
    if (accepted.arc) {
      assert.strictEqual(accepted.bitcoinAnchor.blockHash, 'cd'.repeat(32));
      assert.ok(accepted.spendAddress);
    }
    const summary = tac.summarize(state);
    assert.strictEqual(summary.accepted[0].bitcoinBlockHash, accepted.bitcoinAnchor
      ? accepted.bitcoinAnchor.blockHash
      : null);
  });

  it('reEnrichAccepted refreshes spend overlay without changing stateRoot', function () {
    const Key = require('@fabric/core/types/key');
    let bcd = null;
    try {
      bcd = require('@fabric/core/functions/beaconContractDefinition');
    } catch (_) {
      this.skip();
    }
    const k = new Key();
    const def = bcd.beaconContractDefinition({
      validators: [k.pubkey],
      threshold: 1,
      publisher: k.pubkey
    });
    const contractId = bcd.beaconContractId(def);
    const state = tac.emptyState();
    tac.recordPublish(state, {
      contractId,
      definition: def,
      network: 'regtest',
      bitcoinBlockHash: '11'.repeat(32),
      bitcoinHeight: 1
    });
    tac.acceptContract(state, contractId, {
      network: 'regtest',
      bitcoinBlockHash: '11'.repeat(32),
      bitcoinHeight: 1
    });
    const rootBefore = state.stateRoot;
    const spendRegtest = state.accepted[contractId].spendAddress;
    assert.ok(spendRegtest);
    assert.match(spendRegtest, /^bcrt1p/);
    const result = tac.reEnrichAccepted(state, {
      network: 'signet',
      bitcoinBlockHash: '22'.repeat(32),
      bitcoinHeight: 2
    });
    assert.ok(result.changed >= 1);
    assert.strictEqual(state.stateRoot, rootBefore);
    assert.ok(state.accepted[contractId].spendAddress);
    assert.notStrictEqual(state.accepted[contractId].spendAddress, spendRegtest);
    assert.match(state.accepted[contractId].spendAddress, /^tb1p/);
  });

  it('rejects prototype-polluting contract ids', function () {
    const state = tac.emptyState();
    assert.throws(() => tac.recordPublish(state, { contractId: '__proto__', definition: { name: 'X' } }), /invalid contractId/);
    assert.throws(() => tac.recordPublish(state, { contractId: 'constructor', definition: { name: 'X' } }), /invalid contractId/);
  });

  it('refuses pending overwrite from a different signer/definition', function () {
    const state = tac.emptyState();
    tac.recordPublish(state, {
      contractId: 'c-conflict',
      definition: { name: 'A' },
      signer: 'aa',
      origin: 'peer-1'
    });
    assert.throws(() => tac.recordPublish(state, {
      contractId: 'c-conflict',
      definition: { name: 'B' },
      signer: 'bb',
      origin: 'peer-2'
    }), /already claimed/);
    const again = tac.recordPublish(state, {
      contractId: 'c-conflict',
      definition: { name: 'A' },
      signer: 'aa',
      origin: 'peer-1'
    });
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.status, 'pending');
  });
});
