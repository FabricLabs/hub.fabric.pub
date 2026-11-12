'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const { isHubNetworkStatusShape, bridgeConnectionPhase, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');

describe('hubNetworkStatus', function () {
  it('accepts typical GetNetworkStatus payloads', function () {
    assert.strictEqual(isHubNetworkStatusShape(null), false);
    assert.strictEqual(isHubNetworkStatusShape({ type: 'FooResult' }), false);
    assert.strictEqual(isHubNetworkStatusShape({ network: { address: '0.0.0.0:7777' } }), true);
    assert.strictEqual(isHubNetworkStatusShape({ peers: [] }), true);
    assert.strictEqual(isHubNetworkStatusShape({ fabricPeerId: '03ab' }), true);
    assert.strictEqual(isHubNetworkStatusShape({ bitcoin: { available: true } }), true);
    assert.strictEqual(isHubNetworkStatusShape({ setup: { configured: true, needsSetup: false } }), true);
    assert.strictEqual(isHubNetworkStatusShape({ publishedDocuments: {} }), true);
    assert.strictEqual(isHubNetworkStatusShape({
      publishedDocuments: {},
      documentMarket: { accumulatePeerInventories: false, offerCount: 0, markupBps: 1000 }
    }), true);
    assert.strictEqual(isHubNetworkStatusShape({ state: { status: 'ready', services: {} } }), true);
  });

  it('JSONCall wire frames decode to JSON_CALL (Bridge switch must handle both)', function () {
    const m = Message.fromVector(['JSONCall', JSON.stringify({ method: 'JSONCallResult', params: ['00', { network: { address: 'x' } }] })]);
    assert.strictEqual(m.type, 'JSON_CALL');
    assert.strictEqual(m.friendlyType, 'JSONCall');
  });

  it('bridgeWebSocketLoadingHint reflects WebSocket state', function () {
    assert.strictEqual(bridgeWebSocketLoadingHint(null), null);
    assert.strictEqual(bridgeWebSocketLoadingHint({}), null);
    assert.ok(String(bridgeWebSocketLoadingHint({
      getConnectionStatus: () => ({ websocket: { connected: true, readyState: 1 } })
    })).includes('Waiting for the Hub'));
    assert.ok(String(bridgeWebSocketLoadingHint({
      getConnectionStatus: () => ({ websocket: { connected: false, readyState: 0 } })
    })).includes('Connecting to the Hub'));
    assert.ok(String(bridgeWebSocketLoadingHint({
      getConnectionStatus: () => ({ websocket: { connected: false, readyState: 3 } })
    })).includes('Reconnecting'));
  });

  it('bridgeConnectionPhase names the WebSocket phase', function () {
    const phase = (websocket) => bridgeConnectionPhase({ getConnectionStatus: () => ({ websocket }) });
    assert.strictEqual(bridgeConnectionPhase(null), null);
    assert.strictEqual(phase({ connected: true, readyState: 1 }), 'connected');
    assert.strictEqual(phase({ connected: false, readyState: 0 }), 'opening');
    assert.strictEqual(phase({ connected: false, readyState: 3 }), 'reconnecting');
  });

  describe('fitHubNetworkStatus', function () {
    const { MAX_MESSAGE_SIZE } = require('@fabric/core/constants');
    const { fitHubNetworkStatus, mergeTruncatedNetworkStatus } = require('../functions/hubNetworkStatus');
    const big = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { body: 'x'.repeat(200) }]));

    it('returns a status that fits unchanged', function () {
      const status = { peers: [], network: { address: 'a' } };
      assert.strictEqual(fitHubNetworkStatus(status, 1000), status);
    });

    it('drops heavy fields until a push frame encodes under MAX_FRAME_BYTES', function () {
      const status = {
        peers: [{ id: 'p' }],
        network: { address: 'a' },
        fabricMessages: big(150),
        messages: big(150),
        publishedDocuments: { d: { id: 'd' } }
      };
      assert.throws(() => Message.fromVector(['JSONCall', JSON.stringify({ method: 'JSONCallResult', params: [null, status] })]).toBuffer(), RangeError);
      const fitted = fitHubNetworkStatus(status, MAX_MESSAGE_SIZE - 1024);
      assert.deepStrictEqual(fitted.truncated, ['fabricMessages', 'messages']);
      assert.deepStrictEqual(fitted.peers, status.peers);
      assert.ok(fitted.publishedDocuments);
      assert.ok(status.fabricMessages, 'input is not mutated');
      Message.fromVector(['JSONCall', JSON.stringify({ method: 'JSONCallResult', params: [null, fitted] })]).toBuffer();
    });

    it('client keeps its previous copy of truncated fields', function () {
      const previous = { peers: [], messages: { a: 1 }, fabricMessages: { b: 2 } };
      const next = { peers: [{ id: 'p' }], truncated: ['messages'] };
      const merged = mergeTruncatedNetworkStatus(next, previous);
      assert.deepStrictEqual(merged.messages, { a: 1 });
      assert.strictEqual(merged.fabricMessages, undefined);
      assert.deepStrictEqual(merged.peers, [{ id: 'p' }]);
      assert.strictEqual(mergeTruncatedNetworkStatus({ peers: [] }, previous).messages, undefined);
    });
  });
});
