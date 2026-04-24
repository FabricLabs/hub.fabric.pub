'use strict';

const assert = require('assert');
const {
  isLikelyFabricBech32Id,
  fabricPeerBech32Id,
  peerConnectionPubkeyAtHostPort,
  consolidateUnifiedPeersByFabricId,
  fabricP2PIdentityConfirmed,
  WEBRTC_TRANSPORT
} = require('../functions/peerIdentity');

describe('peerIdentity Fabric id consolidation', function () {
  it('isLikelyFabricBech32Id recognizes id1… shape', function () {
    assert.strictEqual(isLikelyFabricBech32Id('id1pqgsf32'), false);
    assert.ok(isLikelyFabricBech32Id('id1pqgsf32w234jk9pyp'));
  });

  it('fabricPeerBech32Id prefers bech32 metadata over opaque ids', function () {
    const p = {
      id: 'legacyhex',
      metadata: { fabricPeerId: 'id1pqgsf32w234jk9pyp', transport: WEBRTC_TRANSPORT }
    };
    assert.strictEqual(fabricPeerBech32Id(p), 'id1pqgsf32w234jk9pyp');
  });

  it('peerConnectionPubkeyAtHostPort builds id@host:port', function () {
    const tcp = { id: 'id1abc', address: 'hub.example:7777' };
    assert.strictEqual(peerConnectionPubkeyAtHostPort(tcp, ''), 'id1abc@hub.example:7777');
    const mesh = {
      id: 'id1abc',
      address: 'webrtc:bridge-1',
      metadata: { transport: WEBRTC_TRANSPORT, fabricPeerId: 'id1abc' }
    };
    assert.strictEqual(peerConnectionPubkeyAtHostPort(mesh, 'localhost:8080'), 'id1abc@localhost:8080');
  });

  it('consolidateUnifiedPeersByFabricId merges score and prefers TCP address', function () {
    const merged = consolidateUnifiedPeersByFabricId([
      {
        id: 'id1merge',
        address: '1.2.3.4:7777',
        status: 'connected',
        score: 100
      },
      {
        id: 'id1merge',
        address: 'webrtc:abc',
        status: 'connected',
        score: 50,
        misbehavior: 2,
        metadata: { transport: WEBRTC_TRANSPORT, webrtcSignalingId: 'abc', fabricPeerId: 'id1merge' }
      }
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].address, '1.2.3.4:7777');
    assert.strictEqual(merged[0].score, 100);
    assert.strictEqual(merged[0].misbehavior, 2);
  });

  it('fabricP2PIdentityConfirmed is false for mesh', function () {
    assert.strictEqual(fabricP2PIdentityConfirmed({
      id: 'id1x',
      address: '1.1.1.1:7777',
      status: 'connected'
    }), true);
    assert.strictEqual(fabricP2PIdentityConfirmed({
      id: 'id1x',
      address: 'webrtc:x',
      status: 'connected',
      metadata: { transport: WEBRTC_TRANSPORT }
    }), false);
  });
});
