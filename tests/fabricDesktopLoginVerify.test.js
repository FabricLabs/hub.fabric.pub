'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  verifyFabricDesktopLoginSignedPayload,
  parseDesktopLoginMessage,
  originsMatchForDesktopSession
} = require('../functions/fabricDesktopLoginVerify');

const PREFIX = 'fabric:hub-login:1';

function buildLoginMessage (sessionId, origin, nonce) {
  return `${PREFIX}:${nonce}:${sessionId}:${origin}`;
}

describe('fabricDesktopLoginVerify', function () {
  it('parses login messages with complex origins', function () {
    const sid = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const msg = buildLoginMessage(sid, origin, nonce);
    const p = parseDesktopLoginMessage(msg);
    assert.ok(p);
    assert.strictEqual(p.sessionId, sid);
    assert.strictEqual(p.origin, origin);
    assert.strictEqual(p.nonce, nonce);
  });

  it('matches localhost vs 127.0.0.1 for same port', function () {
    assert.strictEqual(
      originsMatchForDesktopSession('http://localhost:8080', 'http://127.0.0.1:8080'),
      true
    );
  });

  it('verifies Schnorr + binding for a synthetic hub payload', function () {
    const key = new Key();
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const message = buildLoginMessage(sessionId, origin, nonce);
    const sig = key.signSchnorr(Buffer.from(message, 'utf8'));
    const ident = new Identity(key);
    const payload = {
      ok: true,
      status: 'signed',
      signature: sig.toString('hex'),
      pubkeyHex: key.pubkey,
      message,
      identity: { id: ident.id, xpub: key.xpub }
    };
    const v = verifyFabricDesktopLoginSignedPayload(payload, { sessionId, origin });
    assert.strictEqual(v.ok, true);
  });

  it('rejects tampered message bytes', function () {
    const key = new Key();
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const message = buildLoginMessage(sessionId, origin, nonce);
    const sig = key.signSchnorr(Buffer.from(message, 'utf8'));
    const ident = new Identity(key);
    const payload = {
      ok: true,
      status: 'signed',
      signature: sig.toString('hex'),
      pubkeyHex: key.pubkey,
      message: message + 'x',
      identity: { id: ident.id, xpub: key.xpub }
    };
    const v = verifyFabricDesktopLoginSignedPayload(payload, { sessionId, origin });
    assert.strictEqual(v.ok, false);
  });
});
