'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const {
  parseHexFabricMessage,
  fabricMessageSummaryFromHex,
  normalizeHex,
  parseOpaqueFabricMessageHex,
  decodeOpaqueFabricUri
} = require('../functions/fabricProtocolUrl');

describe('fabricProtocolUrl', function () {
  it('normalizeHex strips 0x', function () {
    assert.strictEqual(normalizeHex('0xAbCd'), 'AbCd');
  });

  it('parseHexFabricMessage rejects bad hex', function () {
    const r = parseHexFabricMessage('gg');
    assert.strictEqual(r.ok, false);
  });

  it('round-trips a serialized Message', function () {
    const m = new Message({ type: 'GenericMessage', data: { test: true } });
    const hex = m.toBuffer().toString('hex');
    const r = parseHexFabricMessage(hex);
    assert.strictEqual(r.ok, true);
    assert.ok(r.message);
    const out = fabricMessageSummaryFromHex(hex);
    assert.strictEqual(out.ok, true);
    // GenericMessage is outer opcode GENERIC_MESSAGE (15103), not P2P_BASE_MESSAGE.
    assert.strictEqual(out.summary.typeName, 'GENERIC_MESSAGE');
    assert.ok(out.summary.byteLength >= 208);
  });

  it('parseOpaqueFabricMessageHex reads fabric:deadbeef…', function () {
    const m = new Message({ type: 'GenericMessage', data: { x: 1 } });
    const hex = m.toBuffer().toString('hex');
    const opaque = `fabric:${hex}`;
    assert.strictEqual(parseOpaqueFabricMessageHex(opaque), hex);
    assert.strictEqual(parseOpaqueFabricMessageHex('fabric://login?x=1'), null);
  });

  it('decodeOpaqueFabricUri reads hex frames and refuses fabric:// and garbage', function () {
    const m = new Message({ type: 'GenericMessage', data: { x: 1 } });
    const out = decodeOpaqueFabricUri(`fabric:${m.toBuffer().toString('hex')}`);
    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.summary.typeName, 'GENERIC_MESSAGE');
    assert.strictEqual(decodeOpaqueFabricUri('fabric://login?x=1').ok, false);
    assert.strictEqual(decodeOpaqueFabricUri('fabric:zz').ok, false);
  });

  it('decodeOpaqueFabricUri checks the author signature with a current core', function () {
    let siteLogin = null;
    try {
      siteLogin = require('@fabric/core/functions/fabricSiteLogin');
      require('@fabric/core/functions/fabricUri');
    } catch (_) {
      this.skip();
    }
    const Key = require('@fabric/core/types/key');
    const key = new Key();
    const nonce = 'a'.repeat(64);
    const response = siteLogin.signSiteLoginResponse({ origin: 'https://shop.example', nonce, signer: 'passport' }, key);
    const out = decodeOpaqueFabricUri(response.uri);
    assert.strictEqual(out.ok, true, out.error);
    assert.strictEqual(out.verified, true);
    assert.strictEqual(out.signed, true);
    assert.ok(out.author);
    const hex = out.hex;
    const flipped = hex.slice(0, -2) + (hex.endsWith('00') ? '01' : '00');
    assert.strictEqual(decodeOpaqueFabricUri(`fabric:${flipped}`).ok, false);
  });
});
