'use strict';

const assert = require('assert');
const sidechainState = require('../functions/sidechainState');

describe('sidechainState', function () {
  it('gooncitizen path is valid under typical policy', function () {
    const policy = sidechainState.parseStatechainPathPolicy({
      allowedPathPrefixes: ['/gooncitizen', '/app'],
      maxOps: 32
    });
    const r = sidechainState.applyPatchesToState(
      sidechainState.createInitialState(),
      [{
        op: 'add',
        path: '/gooncitizen',
        value: { '@type': 'GoonCitizenGameState', digest: 'abc', counts: { missions: 1 } }
      }],
      policy
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.state.content.gooncitizen.digest, 'abc');
  });

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

  it('applyPatchesToState enforces path policy', function () {
    const policy = sidechainState.parseStatechainPathPolicy({ allowedPathPrefixes: ['/app'] });
    const r = sidechainState.applyPatchesToState(
      sidechainState.createInitialState(),
      [{ op: 'add', path: '/nope', value: 1 }],
      policy
    );
    assert.strictEqual(r.ok, false);
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

  it('resolveStateForBeaconTip unifies restore and replays unsealed journal', function () {
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
    const s0 = sidechainState.createInitialState();
    const p1 = [{ op: 'add', path: '/a', value: 1 }];
    const r1 = sidechainState.applyPatchesToState(s0, p1);
    sidechainState.saveSnapshotForBeaconClockSync(fs, 1, r1.state);
    sidechainState.appendJournalEntrySync(fs, {
      basisClock: 0,
      clock: 1,
      basisDigest: r1.basisDigest,
      newDigest: r1.newDigest,
      patches: p1
    });
    sidechainState.sealJournalThroughSidechainClockSync(fs, 1, 1);
    const p2 = [{ op: 'add', path: '/b', value: 2 }];
    const r2 = sidechainState.applyPatchesToState(r1.state, p2);
    sidechainState.appendJournalEntrySync(fs, {
      basisClock: 1,
      clock: 2,
      basisDigest: r2.basisDigest,
      newDigest: r2.newDigest,
      patches: p2
    });
    const resolved = sidechainState.resolveStateForBeaconTip({
      tipPayload: { clock: 1, sidechain: { stateDigest: sidechainState.stateDigest(r1.state) } },
      snapshot: sidechainState.loadSnapshotForBeaconClock(fs, 1),
      loadedState: r2.state,
      journalEntries: sidechainState.loadJournalDoc(fs).entries
    });
    assert.strictEqual(resolved.source, 'snapshot');
    assert.strictEqual(resolved.unsealedApplied, 1);
    assert.strictEqual(resolved.state.content.b, 2);
  });

  it('summarizeJournal and summarizeSnapshots for operator UI', function () {
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
    const s0 = sidechainState.createInitialState();
    const patches = [{ op: 'add', path: '/ui', value: true }];
    const r = sidechainState.applyPatchesToState(s0, patches);
    sidechainState.appendJournalEntrySync(fs, {
      basisClock: 0,
      clock: 1,
      basisDigest: r.basisDigest,
      newDigest: r.newDigest,
      patches
    });
    sidechainState.saveSnapshotForBeaconClockSync(fs, 3, r.state);
    const j = sidechainState.summarizeJournal(fs, { limit: 10 });
    assert.strictEqual(j.entryCount, 1);
    assert.strictEqual(j.unsealedCount, 1);
    assert.strictEqual(j.entries[0].paths[0], '/ui');
    const sn = sidechainState.summarizeSnapshots(fs, { limit: 10 });
    assert.strictEqual(sn.snapshotCount, 1);
    assert.strictEqual(sn.snapshots[0].beaconClock, 3);
    assert.ok(sn.snapshots[0].stateDigest);
  });
});
