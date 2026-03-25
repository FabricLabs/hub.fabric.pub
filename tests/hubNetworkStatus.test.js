'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const { isHubNetworkStatusShape, bridgeWebSocketLoadingHint } = require('../functions/hubNetworkStatus');

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
    })).includes('WebSocket connected'));
    assert.ok(String(bridgeWebSocketLoadingHint({
      getConnectionStatus: () => ({ websocket: { connected: false, readyState: 0 } })
    })).includes('Opening WebSocket'));
    assert.ok(String(bridgeWebSocketLoadingHint({
      getConnectionStatus: () => ({ websocket: { connected: false, readyState: 3 } })
    })).includes('Reconnecting'));
  });
});
