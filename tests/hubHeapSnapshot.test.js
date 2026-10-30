'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const hubHeapSnapshot = require('../functions/hubHeapSnapshot');
const hubHeapTelemetry = require('../functions/hubHeapTelemetry');
const { createLatestOnlyQueue } = require('../functions/hubWorkQueues');

describe('hubHeapSnapshot', function () {
  it('reads the signal, threshold, and cap from env', function () {
    assert.deepStrictEqual(hubHeapSnapshot.resolveHeapSnapshotSettings({}, {}), { signal: 'SIGUSR2', thresholdBytes: 0, max: 3 });
    assert.deepStrictEqual(
      hubHeapSnapshot.resolveHeapSnapshotSettings({}, { FABRIC_HUB_HEAP_SNAPSHOT_SIGNAL: '0', FABRIC_HUB_HEAP_SNAPSHOT_MB: '512', FABRIC_HUB_HEAP_SNAPSHOT_MAX: '1' }),
      { signal: null, thresholdBytes: 512 * 1024 * 1024, max: 1 }
    );
  });

  it('snapshots when the heap passes the threshold, then doubles it, up to the cap', function () {
    const t = hubHeapSnapshot.createHeapThreshold({ thresholdBytes: 100, max: 2 });
    assert.strictEqual(t.check(99), false);
    assert.strictEqual(t.check(100), true);
    assert.strictEqual(t.check(150), false);
    assert.strictEqual(t.check(450), true);
    assert.strictEqual(t.check(10000), false);
    assert.strictEqual(t.taken(), 2);
  });
});

describe('hubHeapTelemetry leak fields', function () {
  it('reports growth since the previous snapshot', function () {
    const previous = { at: '2026-10-27T00:00:00.000Z', memory: { heapUsed: 100, rss: 1000, external: 10 } };
    const current = { at: '2026-10-27T02:00:00.000Z', memory: { heapUsed: 300, rss: 1400, external: 10 } };
    assert.deepStrictEqual(hubHeapTelemetry.growthSince(current, previous), {
      sinceSec: 7200, heapUsed: 200, rss: 400, external: 0, heapUsedPerHour: 100, rssPerHour: 200
    });
    assert.strictEqual(hubHeapTelemetry.growthSince(current, null), null);
  });

  it('counts pending Bitcoin work and core Bitcoin caches', function () {
    const bitcoin = new EventEmitter();
    bitcoin.on('block', () => {});
    bitcoin._state = { blocks: { a: 1, b: 2 }, content: { blocks: { a: 1 }, transactions: {} } };
    bitcoin.headers = [1, 2, 3];
    const hub = {
      bitcoin,
      _bitcoinBlockQueue: createLatestOnlyQueue(async () => {}),
      _bitcoinSlowRPCInflight: 1,
      _bitcoinScanInflight: new Map([['x', 1]])
    };
    const snap = hubHeapTelemetry.collectHubHeapTelemetry(hub);
    assert.deepStrictEqual(snap.bitcoinService, { rawBlocks: 2, blocks: 1, transactions: 0, headers: 3, listeners: 1 });
    assert.strictEqual(snap.pending.bitcoinSlowRPC, 1);
    assert.strictEqual(snap.pending.bitcoinScans, 1);
    assert.strictEqual(snap.pending.bitcoinBlocks.processed, 0);
    assert.ok(snap.resources === null || typeof snap.resources === 'object');
    assert.strictEqual(snap.growth, null);
  });
});
