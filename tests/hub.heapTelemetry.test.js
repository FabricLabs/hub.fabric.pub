'use strict';

const assert = require('assert');

const hubHeapTelemetry = require('../functions/hubHeapTelemetry');
const hubHeapBounds = require('../functions/hubHeapBounds');

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
