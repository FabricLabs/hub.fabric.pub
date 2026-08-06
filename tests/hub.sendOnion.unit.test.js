'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const { xOnlyFromKey } = require('@fabric/core/functions/fabricOnion');
const { invokeSendOnion } = require('../functions/sendOnionRpc');

describe('Hub SendOnion (unit)', function () {
  it('calls agent.sendOnion with path + signed chat', function () {
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
    assert.ok(seen);
    assert.strictEqual(seen.payload.type, 'P2P_CHAT_MESSAGE');
    assert.strictEqual(seen.payload.data.toString('utf8'), 'via-hub');
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
