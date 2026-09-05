'use strict';

const assert = require('assert');
const {
  fabricTcpInventoryTarget,
  isFabricTcpConnectedPeer,
  isQuietHubRpcErrorMessage,
  shouldToastHubJsonCallError,
  webrtcSignalingIdFromPeerHop
} = require('../functions/hubJsonCallToast');

describe('hubJsonCallToast', function () {
  it('suppresses untyped peer-not-connected JSONCallResult toasts', function () {
    assert.strictEqual(isQuietHubRpcErrorMessage('peer not connected'), true);
    assert.strictEqual(isQuietHubRpcErrorMessage('Peer not connected'), true);
    assert.strictEqual(shouldToastHubJsonCallError({
      status: 'error',
      message: 'peer not connected'
    }), false);
  });

  it('still toasts other untyped Hub RPC errors', function () {
    assert.strictEqual(shouldToastHubJsonCallError({
      status: 'error',
      message: 'connect failed'
    }), true);
    assert.strictEqual(shouldToastHubJsonCallError({
      status: 'error',
      message: 'adminToken required'
    }), true);
  });

  it('skips typed or document/contract-scoped errors (handled elsewhere)', function () {
    assert.strictEqual(shouldToastHubJsonCallError({
      status: 'error',
      type: 'RequestPeerInventoryResult',
      message: 'send failed'
    }), false);
    assert.strictEqual(shouldToastHubJsonCallError({
      status: 'error',
      message: 'document not found',
      documentId: 'abc'
    }), false);
  });

  it('does not treat WebRTC registry rows as Fabric TCP inventory targets', function () {
    const mesh = {
      id: 'abc123pub',
      address: 'webrtc:fabric-bridge-client1',
      status: 'connected',
      metadata: { transport: 'webrtc' }
    };
    assert.strictEqual(isFabricTcpConnectedPeer(mesh), false);
    assert.strictEqual(fabricTcpInventoryTarget(mesh), null);

    const disconnected = { id: 'seed', address: 'hub.fabric.pub:7777', status: 'disconnected' };
    assert.strictEqual(fabricTcpInventoryTarget(disconnected), null);

    const tcp = { id: '03ab', address: '127.0.0.1:7777', status: 'connected' };
    assert.strictEqual(isFabricTcpConnectedPeer(tcp), true);
    assert.strictEqual(fabricTcpInventoryTarget(tcp), '03ab');
  });

  it('extracts WebRTC signaling ids from webrtc: hops', function () {
    assert.strictEqual(webrtcSignalingIdFromPeerHop('webrtc:fabric-bridge-x'), 'fabric-bridge-x');
    assert.strictEqual(webrtcSignalingIdFromPeerHop({ address: 'webrtc:abc', id: 'pubkey' }), 'abc');
    assert.strictEqual(webrtcSignalingIdFromPeerHop('127.0.0.1:7777'), null);
  });
});
