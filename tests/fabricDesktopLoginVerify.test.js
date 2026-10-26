'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { signSiteLoginResponse } = require('@fabric/core/functions/fabricSiteLogin');
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

  it('verifies a signed SiteLoginResponse bound to the session message', function () {
    const ident = new Identity(new Key());
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const fabric = signSiteLoginResponse({ origin, nonce, signer: 'passport', xpub: ident.fabricKey.xpub }, ident.fabricKey).uri;
    const payload = { ok: true, status: 'signed', fabric, message: buildLoginMessage(sessionId, origin, nonce) };
    const v = verifyFabricDesktopLoginSignedPayload(payload, { sessionId, origin });
    assert.strictEqual(v.ok, true);
  });

  it('rejects a response signed for another nonce', function () {
    const ident = new Identity(new Key());
    const sessionId = crypto.randomBytes(24).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const fabric = signSiteLoginResponse({
      origin,
      nonce: crypto.randomBytes(32).toString('hex'),
      signer: 'passport',
      xpub: ident.fabricKey.xpub
    }, ident.fabricKey).uri;
    const payload = {
      ok: true,
      status: 'signed',
      fabric,
      message: buildLoginMessage(sessionId, origin, crypto.randomBytes(32).toString('hex'))
    };
    assert.strictEqual(verifyFabricDesktopLoginSignedPayload(payload, { sessionId, origin }).ok, false);
  });

  it('rejects a raw Schnorr payload without a SiteLoginResponse', function () {
    const ident = new Identity(new Key());
    const fabricKey = ident.fabricKey;
    const sessionId = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const origin = 'http://127.0.0.1:8080';
    const message = buildLoginMessage(sessionId, origin, nonce);
    const payload = {
      ok: true,
      status: 'signed',
      signature: fabricKey.signSchnorr(Buffer.from(message, 'utf8'), 'Fabric/Sign').toString('hex'),
      pubkeyHex: fabricKey.pubkey,
      message,
      identity: { id: ident.id, xpub: fabricKey.xpub }
    };
    assert.strictEqual(verifyFabricDesktopLoginSignedPayload(payload, { sessionId, origin }).ok, false);
  });
});
