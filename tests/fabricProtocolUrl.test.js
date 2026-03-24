'use strict';

const assert = require('assert');
const Message = require('@fabric/core/types/message');
const {
  parseHexFabricMessage,
  fabricMessageSummaryFromHex,
  normalizeHex,
  parseOpaqueFabricMessageHex
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
});
