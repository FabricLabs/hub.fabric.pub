'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');

const hubHeapTelemetry = require('../functions/hubHeapTelemetry');
const hubHeapBounds = require('../functions/hubHeapBounds');
const { createSerialQueue } = require('../functions/hubWorkQueues');

describe('Hub heap telemetry', function () {
  it('resolves interval from env with 60s floor', function () {
    assert.strictEqual(
      hubHeapTelemetry.resolveHeapTelemetryIntervalMs({}, { FABRIC_HUB_HEAP_TELEMETRY_MS: '5000' }),
      hubHeapTelemetry.MIN_INTERVAL_MS
    );
    assert.strictEqual(
      hubHeapTelemetry.resolveHeapTelemetryIntervalMs({}, { FABRIC_HUB_HEAP_TELEMETRY_MS: '120000' }),
      120000
    );
  });

  it('falls back to beacon interval then default', function () {
    assert.strictEqual(
      hubHeapTelemetry.resolveHeapTelemetryIntervalMs({ beacon: { interval: 600000 } }, {}),
      600000
    );
    assert.strictEqual(
      hubHeapTelemetry.resolveHeapTelemetryIntervalMs({}, {}),
      hubHeapTelemetry.DEFAULT_INTERVAL_MS
    );
  });

  it('can be disabled via env or settings', function () {
    assert.strictEqual(hubHeapTelemetry.isHeapTelemetryEnabled({}, { FABRIC_HUB_HEAP_TELEMETRY: '0' }), false);
    assert.strictEqual(hubHeapTelemetry.isHeapTelemetryEnabled({ heapTelemetry: { enable: false } }, {}), false);
    assert.strictEqual(hubHeapTelemetry.isHeapTelemetryEnabled({}, {}), true);
  });

  it('collects retainer counts without mutating hub state', function () {
    const hub = {
      _state: {
        content: {
          collections: {
            messages: { a: { seq: 1 }, b: { seq: 2 } },
            documents: { d1: {} },
            documentoffers: {},
            chain: { c1: {} },
            contracts: {}
          },
          chain: { messages: ['a', 'b'] }
        },
        messages: { m1: {} },
        documents: { d1: {}, d2: {} }
      },
      fs: { _state: { documents: {}, actors: {} } },
      agent: {
        connections: { p1: {}, p2: {} },
        countNoiseHandshakeListeners () {
          return { write: 6, read: 6, split: 6 };
        }
      },
      http: { webrtcPeers: new Set(['w1']) },
      _bitcoinBlockTips: new Set(['aa']),
      _workQueue: [],
      _inventoryHtlcById: new Map(),
      _sidechainState: { clock: 7 },
      _lastStateWriteBytes: 12345
    };
    const before = JSON.stringify(hub._state);
    const snap = hubHeapTelemetry.collectHubHeapTelemetry(hub);
    assert.strictEqual(JSON.stringify(hub._state), before);
    assert.strictEqual(snap.retainers.fabricMessages, 2);
    assert.strictEqual(snap.retainers.activityMessages, 1);
    assert.strictEqual(snap.retainers.documentsIndex, 2);
    assert.strictEqual(snap.retainers.documentsPublished, 1);
    assert.strictEqual(snap.retainers.peerConnections, 2);
    assert.deepStrictEqual(snap.retainers.noiseHandshakeListeners, { write: 6, read: 6, split: 6 });
    assert.strictEqual(snap.retainers.webrtcPeers, 1);
    assert.strictEqual(snap.retainers.sidechainClock, 7);
    assert.strictEqual(snap.retainers.stateContentBytes, 12345);
    assert.strictEqual(snap.caps.activityMessages, hubHeapBounds.MAX_ACTIVITY_MESSAGES);
    assert.strictEqual(snap.replay.telemetryMutatesState, false);
    assert.ok(Number.isFinite(snap.memory.heapUsed));
    assert.ok(snap.heap && Number.isFinite(snap.heap.heapSizeLimit));
  });

  it('formats a single parseable log line', function () {
    const line = hubHeapTelemetry.formatHubHeapTelemetryLine({ at: 't', retainers: { fabricMessages: 1 } });
    assert.ok(line.startsWith(hubHeapTelemetry.LOG_PREFIX + ' '));
    const json = JSON.parse(line.slice(hubHeapTelemetry.LOG_PREFIX.length + 1));
    assert.strictEqual(json.retainers.fabricMessages, 1);
  });
});

describe('Hub heap snapshots', function () {
  it('reads the signal, threshold, and cap from env', function () {
    assert.deepStrictEqual(hubHeapTelemetry.resolveHeapSnapshotSettings({}, {}), { signal: 'SIGUSR2', thresholdBytes: 0, max: 3 });
    assert.deepStrictEqual(
      hubHeapTelemetry.resolveHeapSnapshotSettings({}, { FABRIC_HUB_HEAP_SNAPSHOT_SIGNAL: '0', FABRIC_HUB_HEAP_SNAPSHOT_MB: '512', FABRIC_HUB_HEAP_SNAPSHOT_MAX: '1' }),
      { signal: null, thresholdBytes: 512 * 1024 * 1024, max: 1 }
    );
  });

  it('snapshots when the heap passes the threshold, then doubles it, up to the cap', function () {
    const t = hubHeapTelemetry.createHeapThreshold({ thresholdBytes: 100, max: 2 });
    assert.strictEqual(t.check(99), false);
    assert.strictEqual(t.check(100), true);
    t.record(100);
    assert.strictEqual(t.check(150), false);
    assert.strictEqual(t.check(450), true);
    t.record(450);
    assert.strictEqual(t.check(10000), false);
    assert.strictEqual(t.taken(), 2);
  });

  it('keeps a threshold snapshot due until one is written', function () {
    const t = hubHeapTelemetry.createHeapThreshold({ thresholdBytes: 100, max: 1 });
    assert.strictEqual(t.check(120), true);
    assert.strictEqual(t.check(130), true);
    assert.strictEqual(t.taken(), 0);
    t.record(130);
    assert.strictEqual(t.check(10000), false);
    assert.strictEqual(t.taken(), 1);
  });
});

describe('Hub heap snapshot files', function () {
  const v8 = require('v8');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  let written;
  let original;
  beforeEach(function () {
    written = [];
    original = v8.writeHeapSnapshot;
    v8.writeHeapSnapshot = (file) => { written.push(file); return file; };
  });
  afterEach(function () {
    v8.writeHeapSnapshot = original;
  });

  it('names the file from fixed parts only', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-heap-'));
    const file = hubHeapTelemetry.writeHeapSnapshot(dir, 'threshold');
    assert.strictEqual(path.dirname(file), dir);
    assert.match(path.basename(file), /^hub-\d+-[0-9TZ-]+-threshold\.heapsnapshot$/);
    const other = hubHeapTelemetry.writeHeapSnapshot(dir + path.sep, '../../escape');
    assert.strictEqual(path.dirname(other), dir);
    assert.match(path.basename(other), /-snapshot\.heapsnapshot$/);
    assert.deepStrictEqual(written, [file, other]);
  });

  it('refuses a relative directory', function () {
    assert.strictEqual(hubHeapTelemetry.writeHeapSnapshot('stores/hub/heap', 'signal'), null);
    assert.deepStrictEqual(written, []);
  });
});

describe('hubHeapTelemetry leak fields', function () {
  it('reports growth since the previous snapshot', function () {
    const previous = {
      at: '2026-10-27T00:00:00.000Z',
      memory: { heapUsed: 100, rss: 1000, external: 10, arrayBuffers: 4 },
      retainers: { documentsPublished: 5, fabricMessages: 7, noiseHandshakeListeners: null }
    };
    const current = {
      at: '2026-10-27T02:00:00.000Z',
      memory: { heapUsed: 300, rss: 1400, external: 10, arrayBuffers: 9 },
      retainers: { documentsPublished: 8, fabricMessages: 7, noiseHandshakeListeners: null, webrtcPeers: 2 }
    };
    assert.deepStrictEqual(hubHeapTelemetry.growthSince(current, previous), {
      sinceSec: 7200,
      heapUsed: 200,
      rss: 400,
      external: 0,
      arrayBuffers: 5,
      heapUsedPerHour: 100,
      rssPerHour: 200,
      retainers: { documentsPublished: 3, fabricMessages: 0 }
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
      _bitcoinBlockQueue: createSerialQueue(async () => {}),
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
