'use strict';

const assert = require('assert');
const { mergeFabricPeersWithWebRtcRegistry } = require('../functions/mergeFabricPeersWithWebRtcRegistry');

describe('mergeFabricPeersWithWebRtcRegistry', function () {
  it('adds WebRTC row with Fabric id when fabricPeerId is set', function () {
    const merged = mergeFabricPeersWithWebRtcRegistry([], [{
      id: 'fabric-bridge-client1',
      status: 'registered',
      metadata: { fabricPeerId: 'abc123pub', xpub: 'xpub9' },
      meshSessionCount: 1
    }]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].id, 'abc123pub');
    assert.strictEqual(merged[0].address, 'webrtc:fabric-bridge-client1');
    assert.strictEqual(merged[0].status, 'connected');
    assert.strictEqual(merged[0].metadata.transport, 'webrtc');
    assert.strictEqual(merged[0].metadata.webrtcSignalingId, 'fabric-bridge-client1');
  });

  it('skips duplicate when TCP list already has same Fabric id', function () {
    const merged = mergeFabricPeersWithWebRtcRegistry([
      { id: 'abc123pub', address: '1.2.3.4:7777', status: 'connected' }
    ], [{
      id: 'fabric-bridge-x',
      metadata: { fabricPeerId: 'abc123pub' },
      meshSessionCount: 0
    }]);
    assert.strictEqual(merged.length, 1);
  });

  it('uses webrtc: id when no fabricPeerId', function () {
    const merged = mergeFabricPeersWithWebRtcRegistry([], [{
      id: 'fabric-bridge-only',
      status: 'registered',
      metadata: {},
      meshSessionCount: 0
    }]);
    assert.strictEqual(merged[0].id, 'webrtc:fabric-bridge-only');
  });
});
