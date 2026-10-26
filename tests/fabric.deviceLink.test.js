'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const SIGNING_TAGS = require('@fabric/core/functions/signingTags');
const {
  DEVICE_LINK_PREFIX,
  DEVICE_LINK_OFFER_TAG,
  DEVICE_LINK_TAG,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage,
  verifyIdentitySchnorr
} = require('../functions/fabricDeviceLink');

const ORIGIN = 'http://127.0.0.1:8080';

describe('fabricDeviceLink', function () {
  it('uses the core signing tags', function () {
    assert.strictEqual(DEVICE_LINK_OFFER_TAG, SIGNING_TAGS.DEVICE_LINK_OFFER);
    assert.strictEqual(DEVICE_LINK_TAG, SIGNING_TAGS.DEVICE_LINK);
  });

  it('builds and parses mutual link messages bound to session and origin', function () {
    const sessionId = '1a'.repeat(24);
    const nonce = 'ab'.repeat(32);
    const a = new Identity(new Key()).id;
    const b = new Identity(new Key()).id;
    const msg = buildDeviceLinkMessage(sessionId, nonce, a, b, 'Passport', ORIGIN);
    assert.ok(msg.startsWith(`${DEVICE_LINK_PREFIX}:link:`));
    const p = parseDeviceLinkMessage(msg);
    assert.ok(p);
    assert.strictEqual(p.kind, 'link');
    assert.strictEqual(p.sessionId, sessionId);
    assert.strictEqual(p.nonce, nonce);
    assert.strictEqual(p.initiatorId, a);
    assert.strictEqual(p.responderId, b);
    assert.strictEqual(p.label, 'Passport');
    assert.strictEqual(p.origin, ORIGIN);
  });

  it('rejects a link message without a bound session id', function () {
    const nonce = 'ab'.repeat(32);
    const a = new Identity(new Key()).id;
    const b = new Identity(new Key()).id;
    assert.throws(() => {
      buildDeviceLinkMessage('short', nonce, a, b, 'Passport', ORIGIN);
    }, /sessionId/);
  });

  it('refuses ids that are not Fabric ids', function () {
    const a = new Identity(new Key()).id;
    assert.throws(() => {
      buildDeviceLinkMessage('1a'.repeat(24), 'ab'.repeat(32), a, 'id1other:evil', 'Hub', ORIGIN);
    }, /id1/);
  });

  it('does not parse older link versions', function () {
    const nonce = 'ab'.repeat(32);
    assert.strictEqual(parseDeviceLinkMessage(`fabric:device-link:1:${nonce}:id1a:id1b:Passport`), null);
    assert.strictEqual(parseDeviceLinkMessage(`fabric:device-link:2:offer:${'2b'.repeat(24)}:${nonce}:id1a:Passport`), null);
  });

  it('verifies tagged offer signatures and refuses other tags', function () {
    const ident = new Identity(new Key());
    const fabric = ident.fabricKey;
    const sessionId = '2b'.repeat(24);
    const nonce = 'cd'.repeat(32);
    const offer = buildDeviceLinkOfferMessage(sessionId, nonce, ident.id, 'DemoApplication', ORIGIN);
    assert.ok(offer.startsWith(`${DEVICE_LINK_PREFIX}:offer:${sessionId}:`));
    const sig = fabric.signSchnorr(Buffer.from(offer, 'utf8'), DEVICE_LINK_OFFER_TAG).toString('hex');
    const identity = { id: ident.id, xpub: fabric.xpub };
    assert.strictEqual(verifyIdentitySchnorr(offer, sig, fabric.pubkey, identity, DEVICE_LINK_OFFER_TAG).ok, true);
    assert.strictEqual(verifyIdentitySchnorr(offer, sig, fabric.pubkey, identity, DEVICE_LINK_TAG).ok, false);
  });
});
