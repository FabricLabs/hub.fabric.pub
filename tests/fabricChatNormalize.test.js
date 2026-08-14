'use strict';

const assert = require('assert');
const {
  chatTextOf,
  chatActorIdOf,
  normalizeP2pChatMessage
} = require('../functions/fabricChatNormalize');

describe('fabricChatNormalize', function () {
  it('reads Hub classic object.content', function () {
    const chat = {
      type: 'P2P_CHAT_MESSAGE',
      actor: { id: 'aa' },
      object: { content: 'hello hub', created: 100 }
    };
    assert.strictEqual(chatTextOf(chat), 'hello hub');
    assert.strictEqual(chatActorIdOf(chat), 'aa');
    const n = normalizeP2pChatMessage(chat);
    assert.ok(n);
    assert.strictEqual(n.object.content, 'hello hub');
    assert.strictEqual(n.actor.id, 'aa');
    assert.strictEqual(n.object.handle, undefined);
    assert.strictEqual(n.object.channel, undefined);
  });

  it('reads Peer UTF-8 emit { text } + signer', function () {
    const chat = { text: 'hello mesh', type: 'P2P_CHAT_MESSAGE' };
    assert.strictEqual(chatTextOf(chat), 'hello mesh');
    const n = normalizeP2pChatMessage(chat, { signer: 'bb' });
    assert.ok(n);
    assert.strictEqual(n.actor.id, 'bb');
    assert.strictEqual(n.object.content, 'hello mesh');
    assert.strictEqual(n.object.handle, undefined);
  });

  it('ignores legacy handle on inbound UI shapes (alias is separate)', function () {
    const chat = {
      type: 'P2P_CHAT_MESSAGE',
      actor: { publicKey: 'bb' },
      object: {
        body: 'hello goon',
        handle: 'Neorion',
        ts: '2026-07-20T00:00:00.000Z',
        id: 'msg-1'
      }
    };
    assert.strictEqual(chatTextOf(chat), 'hello goon');
    const n = normalizeP2pChatMessage(chat);
    assert.ok(n);
    assert.strictEqual(n.actor.id, 'bb');
    assert.strictEqual(n.object.content, 'hello goon');
    assert.strictEqual(n.object.handle, undefined);
    assert.strictEqual(n.object.id, 'msg-1');
    assert.ok(Number.isFinite(n.object.created));
  });

  it('returns null for empty text', function () {
    assert.strictEqual(normalizeP2pChatMessage({ object: { content: '  ' } }), null);
  });

  it('does not treat Number(null)/empty created as Unix epoch', function () {
    const n = normalizeP2pChatMessage({
      type: 'P2P_CHAT_MESSAGE',
      actor: { id: 'aa' },
      object: { content: 'hi', created: null }
    });
    assert.ok(n);
    assert.ok(n.object.created > 1e12);
  });
});
