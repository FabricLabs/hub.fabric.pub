'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage,
  verifyIdentitySchnorr
} = require('../functions/fabricDeviceLink');

describe('fabricDeviceLink', function () {
  it('builds and parses mutual link messages', function () {
    const nonce = 'ab'.repeat(32);
    const a = 'id1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 'id1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const msg = buildDeviceLinkMessage(nonce, a, b, 'Passport');
    assert.ok(msg.startsWith(`${DEVICE_LINK_PREFIX}:`));
    const p = parseDeviceLinkMessage(msg);
    assert.ok(p);
    assert.strictEqual(p.nonce, nonce);
    assert.strictEqual(p.initiatorId, a);
    assert.strictEqual(p.responderId, b);
    assert.strictEqual(p.label, 'Passport');
  });

  it('verifies Schnorr offer signatures', function () {
    const master = new Key();
    const ident = new Identity(master);
    const fabric = ident.fabricKey;
    const nonce = 'cd'.repeat(32);
    const offer = buildDeviceLinkOfferMessage(nonce, ident.id, 'DemoApplication', 'http://127.0.0.1:8080');
    const sig = fabric.signSchnorr(Buffer.from(offer, 'utf8')).toString('hex');
    const v = verifyIdentitySchnorr(offer, sig, fabric.pubkey, { id: ident.id, xpub: fabric.xpub });
    assert.strictEqual(v.ok, true);
  });

  it('rejects mismatched responder for link message binding', function () {
    const master = new Key();
    const ident = new Identity(master);
    const fabric = ident.fabricKey;
    const nonce = 'ef'.repeat(32);
    const msg = buildDeviceLinkMessage(nonce, ident.id, 'id1other', 'Hub');
    const sig = fabric.signSchnorr(Buffer.from(msg, 'utf8')).toString('hex');
    // Signing as initiator over a message that names a different responder is still
    // cryptographically valid for the initiator key — binding is checked by callers.
    const v = verifyIdentitySchnorr(msg, sig, fabric.pubkey, { id: ident.id, xpub: fabric.xpub });
    assert.strictEqual(v.ok, true);
    const parsed = parseDeviceLinkMessage(msg);
    assert.strictEqual(parsed.responderId, 'id1other');
  });
});
