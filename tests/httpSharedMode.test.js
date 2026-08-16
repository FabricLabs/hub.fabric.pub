'use strict';

const assert = require('assert');
const {
  isHttpSharedModeEnabled,
  resolveHttpListenHost,
  applySharedModeWebsocketGate
} = require('../functions/httpSharedMode');

describe('httpSharedMode', () => {
  it('treats common truthy persisted shapes as shared', () => {
    assert.strictEqual(isHttpSharedModeEnabled(true), true);
    assert.strictEqual(isHttpSharedModeEnabled(1), true);
    assert.strictEqual(isHttpSharedModeEnabled('true'), true);
    assert.strictEqual(isHttpSharedModeEnabled('1'), true);
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
  });

  it('treats falsey and unknown as not shared', () => {
    assert.strictEqual(isHttpSharedModeEnabled(false), false);
    assert.strictEqual(isHttpSharedModeEnabled(0), false);
    assert.strictEqual(isHttpSharedModeEnabled('false'), false);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
    assert.strictEqual(isHttpSharedModeEnabled(null), false);
  });

  it('re-exports resolveHttpListenHost from @fabric/http', () => {
    assert.strictEqual(typeof resolveHttpListenHost, 'function');
    assert.strictEqual(resolveHttpListenHost({ mode: 'relay', env: {} }), '127.0.0.1');
    assert.strictEqual(resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
    assert.strictEqual(
      resolveHttpListenHost({ host: '10.0.0.8', env: { INTERFACE: '0.0.0.0' } }),
      '10.0.0.8'
    );
  });

  it('applySharedModeWebsocketGate requires token when shared + env token', () => {
    assert.strictEqual(typeof applySharedModeWebsocketGate, 'function');
    const gated = applySharedModeWebsocketGate({}, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'secret-ws' }
    });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.strictEqual(gated.websocket.clientToken, 'secret-ws');
    const off = applySharedModeWebsocketGate({ websocket: { requireClientToken: false } }, {
      bindAll: true,
      env: { FABRIC_WS_CLIENT_TOKEN: 'secret-ws' }
    });
    assert.strictEqual(off.websocket.requireClientToken, false);
  });

  it('applySharedModeWebsocketGate fail-closes shared bind without env token', () => {
    const gated = applySharedModeWebsocketGate({}, { bindAll: true, env: {} });
    assert.strictEqual(gated.websocket.requireClientToken, true);
    assert.ok(!gated.websocket.clientToken);
  });
});
