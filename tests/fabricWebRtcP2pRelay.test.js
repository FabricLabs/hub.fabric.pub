'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const Key = require('@fabric/core/types/key');
const {
  buildInnerWireBuffer,
  wrapPeerP2pRelay,
  looksLikeFabricMessageBuffer
} = require('../functions/fabricWebRtcP2pRelay');

describe('fabricWebRtcP2pRelay', function () {
  const key = new Key();

  it('builds P2P_CHAT_MESSAGE inner bytes for Peer P2P_RELAY', function () {
    const chat = JSON.stringify({ type: 'P2P_CHAT_MESSAGE', object: { content: 'hi' } });
    const inner = buildInnerWireBuffer(chat, 'P2P_CHAT_MESSAGE', key);
    assert.ok(looksLikeFabricMessageBuffer(inner));
    const parsed = Message.fromBuffer(inner);
    assert.strictEqual(parsed.type, 'P2P_CHAT_MESSAGE');
  });

  it('wrapPeerP2pRelay body is raw Message bytes (not JSON envelope)', function () {
    const chat = JSON.stringify({ type: 'P2P_CHAT_MESSAGE', object: { content: 'hi' } });
    const inner = buildInnerWireBuffer(chat, 'P2P_CHAT_MESSAGE', key);
    const outer = wrapPeerP2pRelay(inner, key);
    assert.strictEqual(outer.type, 'P2P_RELAY');
    const body = outer.raw.data;
    assert.ok(Buffer.isBuffer(body));
    assert.ok(looksLikeFabricMessageBuffer(body));
    // Must not be the Hub JSON hops envelope (`{ "original"…`)
    assert.notStrictEqual(body[0], 0x7b /* '{' */);
    const unwrapped = Message.fromBuffer(body);
    assert.strictEqual(unwrapped.type, 'P2P_CHAT_MESSAGE');
  });

  it('preserves fabric-message author signature bytes', function () {
    const author = new Key();
    const signed = Message.fromVector([
      'P2P_CHAT_MESSAGE',
      JSON.stringify({ type: 'P2P_CHAT_MESSAGE', object: { content: 'signed' } })
    ]).signWithKey(author);
    const wire = signed.toBuffer();
    const inner = buildInnerWireBuffer(wire.toString('base64'), 'fabric-message', key);
    assert.ok(wire.equals(inner), 'fabric-message path must not re-encode/re-sign');
  });

  it('carries P2P_PEER_GOSSIP as GenericMessage / GENERIC_MESSAGE', function () {
    const gossip = JSON.stringify({
      type: 'P2P_PEER_GOSSIP',
      object: { peers: [{ id: 'p1' }] }
    });
    const inner = buildInnerWireBuffer(gossip, 'P2P_PEER_GOSSIP', key);
    const parsed = Message.fromBuffer(inner);
    assert.strictEqual(parsed.type, 'GENERIC_MESSAGE');
    const body = JSON.parse(parsed.body);
    assert.strictEqual(body.type, 'P2P_PEER_GOSSIP');
  });
});
