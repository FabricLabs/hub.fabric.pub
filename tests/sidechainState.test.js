'use strict';

const assert = require('assert');
const sidechainState = require('../functions/sidechainState');

describe('sidechainState', function () {
  it('stateDigest is stable for same content', function () {
    const a = { version: 1, clock: 0, content: { x: 1 } };
    const b = { version: 1, clock: 0, content: { x: 1 } };
    assert.strictEqual(sidechainState.stateDigest(a), sidechainState.stateDigest(b));
  });

  it('applyPatchesToState bumps clock and applies RFC6902', function () {
    const s0 = sidechainState.createInitialState();
    const r = sidechainState.applyPatchesToState(s0, [{ op: 'add', path: '/hello', value: 'world' }]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state.clock, 1);
    assert.strictEqual(r.state.content.hello, 'world');
  });

  it('signingStringForSidechainStatePatch is stable', function () {
    const p = {
      basisClock: 0,
      basisDigest: 'abc',
      patches: [{ op: 'add', path: '/a', value: 1 }]
    };
    const s1 = sidechainState.signingStringForSidechainStatePatch(p);
    const s2 = sidechainState.signingStringForSidechainStatePatch(p);
    assert.strictEqual(s1, s2);
    assert.strictEqual(sidechainState.patchCommitmentDigestHex(p).length, 64);
  });

  it('snapshots round-trip and prune by beacon clock', function () {
    const store = new Map();
    const fs = {
      readFile: (name) => {
        const v = store.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        store.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      }
    };
    const st = { version: 1, clock: 2, content: { x: 1 } };
    assert.strictEqual(sidechainState.saveSnapshotForBeaconClockSync(fs, 5, st), true);
    const got = sidechainState.loadSnapshotForBeaconClock(fs, 5);
    assert.strictEqual(got.clock, 2);
    assert.strictEqual(got.content.x, 1);
    sidechainState.saveSnapshotForBeaconClockSync(fs, 7, { version: 1, clock: 3, content: {} });
    sidechainState.pruneSnapshotsAfterBeaconClockSync(fs, 5);
    assert.ok(sidechainState.loadSnapshotForBeaconClock(fs, 5));
    assert.strictEqual(sidechainState.loadSnapshotForBeaconClock(fs, 7), null);
    sidechainState.pruneSnapshotsForRemovedBeaconClocksSync(fs, [5]);
    assert.strictEqual(sidechainState.loadSnapshotForBeaconClock(fs, 5), null);
  });
});
