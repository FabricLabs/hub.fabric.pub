'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const { xOnlyFromKey } = require('@fabric/core/functions/fabricOnion');
const {
  isOnionChatSeal,
  tryOpenOnionChatText
} = require('../functions/onionChatSeal');
const { invokeSendOnion } = require('../functions/sendOnionRpc');

describe('Hub SendOnion (unit)', function () {
  it('calls agent.sendOnion with path + sealed signed chat by default', function () {
    const key = new Key();
    const hop = new Key();
    let seen = null;
    const agent = {
      key,
      sendOnion (path, payload) {
        seen = { path, payload };
        return true;
      }
    };
    const res = invokeSendOnion(agent, [{
      path: [xOnlyFromKey(hop).toString('hex')],
      text: 'via-hub'
    }]);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.pathLength, 1);
    assert.strictEqual(res.sealed, true);
    assert.ok(seen);
    assert.strictEqual(seen.payload.type, 'P2P_CHAT_MESSAGE');
    const wire = seen.payload.data.toString('utf8');
    assert.ok(isOnionChatSeal(wire));
    assert.ok(!wire.includes('via-hub'));
    const opened = tryOpenOnionChatText(wire, { keyOrPrivate: hop });
    assert.strictEqual(opened.opened, true);
    assert.strictEqual(opened.text, 'via-hub');
  });

  it('encrypt:false keeps plaintext chat body', function () {
    const key = new Key();
    const hop = new Key();
    let seen = null;
    const agent = {
      key,
      sendOnion (path, payload) {
        seen = { path, payload };
        return true;
      }
    };
    const res = invokeSendOnion(agent, [{
      path: [xOnlyFromKey(hop).toString('hex')],
      text: 'clear',
      encrypt: false
    }]);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.sealed, false);
    assert.strictEqual(seen.payload.data.toString('utf8'), 'clear');
  });

  it('messageBase64 bypasses tip sealing (caller supplies wire payload)', function () {
    const key = new Key();
    const hop = new Key();
    let seen = null;
    const agent = {
      key,
      sendOnion (path, payload) {
        seen = { path, payload };
        return true;
      }
    };
    const Message = require('@fabric/core/types/message');
    const clear = Message.fromVector(['P2P_CHAT_MESSAGE', 'raw-base64-body']).signWithKey(key);
    const res = invokeSendOnion(agent, [{
      path: [xOnlyFromKey(hop).toString('hex')],
      messageBase64: clear.toBuffer().toString('base64')
    }]);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.sealed, false);
    assert.ok(seen);
    assert.strictEqual(seen.payload.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(seen.payload.data.toString('utf8'), 'raw-base64-body');
    assert.strictEqual(isOnionChatSeal(seen.payload.data.toString('utf8')), false);
  });

  it('rejects missing path / payload', function () {
    const agent = { sendOnion () { return true; }, key: new Key() };
    assert.strictEqual(invokeSendOnion(agent, [{}]).status, 'error');
    assert.strictEqual(invokeSendOnion(agent, [{ path: ['aa'] }]).status, 'error');
  });

  it('errors when Peer lacks sendOnion', function () {
    const res = invokeSendOnion({}, [{ path: ['00'], text: 'x' }]);
    assert.strictEqual(res.status, 'error');
    assert.ok(/unavailable/i.test(res.message));
  });
});
