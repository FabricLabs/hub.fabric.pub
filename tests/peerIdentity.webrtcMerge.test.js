'use strict';

const assert = require('assert');
const {
  webrtcCombinedToFabricPeerRows,
  mergeTcpAndWebrtcPeerRows,
  isWebrtcTransportPeerRow
} = require('../functions/peerIdentity');

describe('peerIdentity WebRTC → Fabric list merge', function () {
  it('maps combined WebRTC rows to peer-shaped objects with transport flag', function () {
    const rows = webrtcCombinedToFabricPeerRows(
      [
        {
          id: 'fabric-bridge-abc',
          signaling: { id: 'fabric-bridge-abc', metadata: { fabricPeerId: 'deadbeef', xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp8MS4fN5f8m6v1n9Tk5V9p6WmR5AqYeR8' } },
          local: { id: 'fabric-bridge-abc', status: 'connected', lastSeen: 1 }
        }
      ],
      () => ({ score: 120, misbehavior: 2 })
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].address, 'webrtc:fabric-bridge-abc');
    assert.strictEqual(rows[0].status, 'connected');
    assert.strictEqual(rows[0].score, 120);
    assert.strictEqual(rows[0].misbehavior, 2);
    assert.ok(isWebrtcTransportPeerRow(rows[0]));
  });

  it('mergeTcpAndWebrtcPeerRows sorts by primary TCP then score', function () {
    const tcp = [
      { id: 'p1', address: 'hub.fabric.pub:7777', status: 'connected', score: 50 },
      { id: 'p2', address: '127.0.0.1:7777', status: 'connected', score: 200 }
    ];
    const mesh = [
      { id: 'w1', address: 'webrtc:w1', status: 'connected', score: 999, misbehavior: 0, metadata: { transport: 'webrtc' } }
    ];
    const merged = mergeTcpAndWebrtcPeerRows(tcp, mesh, 'hub.fabric.pub:7777');
    assert.strictEqual(merged[0].address, 'hub.fabric.pub:7777');
    assert.ok(merged.some((p) => p.id === 'w1'));
  });
});
