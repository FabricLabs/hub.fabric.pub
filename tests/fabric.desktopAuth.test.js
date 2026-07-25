'use strict';

const assert = require('assert');
const {
  buildLoginMessage,
  DESKTOP_LOGIN_PREFIX,
  originsMatchForDesktopSession,
  hasClientSignatureBody
} = require('../functions/fabricDesktopAuth');

describe('fabricDesktopAuth', function () {
  it('buildLoginMessage uses a stable canonical format', function () {
    const m = buildLoginMessage('sess1', 'http://127.0.0.1:8080', 'nonce42');
    assert.strictEqual(m, `${DESKTOP_LOGIN_PREFIX}:nonce42:sess1:http://127.0.0.1:8080`);
  });

  it('originsMatchForDesktopSession treats localhost and 127.0.0.1 as equivalent (same port)', function () {
    assert.strictEqual(
      originsMatchForDesktopSession('http://127.0.0.1:8080', 'http://localhost:8080'),
      true
    );
    assert.strictEqual(
      originsMatchForDesktopSession('http://localhost:9', 'http://127.0.0.1:8080'),
      false
    );
  });

  it('originsMatchForDesktopSession requires exact host for non-loopback', function () {
    assert.strictEqual(
      originsMatchForDesktopSession('http://192.168.1.5:8080', 'http://192.168.1.5:8080'),
      true
    );
    assert.strictEqual(
      originsMatchForDesktopSession('http://192.168.1.6:8080', 'http://192.168.1.5:8080'),
      false
    );
  });

  it('hasClientSignatureBody detects player-login completion payloads', function () {
    assert.strictEqual(hasClientSignatureBody({}), false);
    assert.strictEqual(hasClientSignatureBody({ signature: 'aa', pubkeyHex: 'bb' }), false);
    const sig = 'a'.repeat(128);
    const pub = '02' + 'ab'.repeat(32);
    assert.strictEqual(hasClientSignatureBody({
      signature: sig,
      pubkeyHex: pub,
      identity: { id: 'id1test', xpub: 'xpub661MyMwAqRbc' }
    }), true);
  });
});
