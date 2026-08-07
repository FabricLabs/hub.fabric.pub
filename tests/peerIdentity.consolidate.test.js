'use strict';

const assert = require('assert');
const {
  isLikelyFabricBech32Id,
  isLikelyCompressedPubkeyHex,
  fabricPeerBech32Id,
  fabricPeerPubkeyHex,
  peerNativePeeringString,
  peerConnectionPubkeyAtHostPort,
  peerPeeringEndpointIsSignaling,
  consolidateUnifiedPeersByFabricId,
  fabricP2PIdentityConfirmed,
  WEBRTC_TRANSPORT
} = require('../functions/peerIdentity');

const SAMPLE_HEX = `02${'ab'.repeat(32)}`;

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

  it('fabricPeerPubkeyHex prefers compressed hex fields', function () {
    assert.ok(isLikelyCompressedPubkeyHex(SAMPLE_HEX));
    assert.strictEqual(fabricPeerPubkeyHex({
      id: 'id1pqgsf32w234jk9pyp',
      publicKey: SAMPLE_HEX.toUpperCase()
    }), SAMPLE_HEX);
    assert.strictEqual(fabricPeerPubkeyHex({
      id: SAMPLE_HEX,
      metadata: { fabricPeerId: 'id1pqgsf32w234jk9pyp' }
    }), SAMPLE_HEX);
    assert.strictEqual(fabricPeerPubkeyHex({ id: 'id1pqgsf32w234jk9pyp' }), '');
  });

  it('peerNativePeeringString prefers hex@host:port for TCP peers', function () {
    const tcp = {
      id: 'id1abc',
      publicKey: SAMPLE_HEX,
      address: 'hub.example:7777'
    };
    assert.strictEqual(
      peerNativePeeringString(tcp, ''),
      `${SAMPLE_HEX}@hub.example:7777`
    );
    assert.strictEqual(peerPeeringEndpointIsSignaling(tcp), false);
  });

  it('peerNativePeeringString falls back to bech32/id when hex unknown', function () {
    const tcp = { id: 'id1abc', address: 'hub.example:7777' };
    assert.strictEqual(peerNativePeeringString(tcp, ''), 'id1abc@hub.example:7777');
    assert.strictEqual(peerConnectionPubkeyAtHostPort(tcp, ''), 'id1abc@hub.example:7777');
  });

  it('peerNativePeeringString uses signaling host for WebRTC rows', function () {
    const mesh = {
      id: SAMPLE_HEX,
      address: 'webrtc:bridge-1',
      metadata: { transport: WEBRTC_TRANSPORT, fabricPeerId: SAMPLE_HEX }
    };
    assert.strictEqual(
      peerNativePeeringString(mesh, 'localhost:8080'),
      `${SAMPLE_HEX}@localhost:8080`
    );
    assert.strictEqual(peerPeeringEndpointIsSignaling(mesh), true);
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
