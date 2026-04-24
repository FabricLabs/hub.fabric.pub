'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const {
  fabricWireBodyIntegrityOk,
  FabricTransportSession,
  SESSION_KIND_WEBRTC,
  HUB_FABRIC_SESSION_ID
} = require('../functions/fabricTransportSession');

describe('fabricTransportSession', function () {
  it('fabricWireBodyIntegrityOk matches signed vector message', function () {
    const m = Message.fromVector(['JSONCall', JSON.stringify({ method: 'Ping', params: [] })]);
    assert.strictEqual(fabricWireBodyIntegrityOk(m), true);
  });

  it('fabricWireBodyIntegrityOk rejects corrupted body', function () {
    const m = Message.fromVector(['JSONCall', JSON.stringify({ method: 'Ping', params: [] })]);
    const buf = m.toBuffer();
    const corrupt = Buffer.from(buf);
    corrupt[corrupt.length - 1] ^= 0xff;
    const m2 = Message.fromBuffer(corrupt);
    assert.strictEqual(fabricWireBodyIntegrityOk(m2), false);
  });

  it('FabricTransportSession.commitWireMessage grows chain and tree', function () {
    const s = new FabricTransportSession('peer-a', SESSION_KIND_WEBRTC);
    const m = Message.fromVector(['Pong', 'ok']);
    const e = s.commitWireMessage(m);
    assert.strictEqual(e.seq, 1);
    assert.ok(e.leafHex && e.leafHex.length === 64);
    assert.strictEqual(s.chain.length, 1);
    const root1 = s.getMerkleRootHex();
    const m2 = Message.fromVector(['Pong', 'ok2']);
    s.commitWireMessage(m2);
    assert.strictEqual(s.chain.length, 2);
    const root2 = s.getMerkleRootHex();
    assert.notStrictEqual(root1, root2);
  });

  it('penalize triggers disconnect threshold', function () {
    const s = new FabricTransportSession(HUB_FABRIC_SESSION_ID, 'hub_websocket');
    const r = s.penalize(1000);
    assert.strictEqual(r.disconnect, true);
  });
});
