'use strict';

const assert = require('assert');
const envelope = require('../functions/fabricBridgeEnvelope');

describe('fabricBridgeEnvelope', function () {
  it('createEnvelope and tryParse round-trip', function () {
    const e = envelope.createEnvelope('HubClientChat', { text: 'hi', n: 1 }, { t: 2 });
    const s = JSON.stringify(e);
    const parsed = envelope.tryParse(JSON.parse(s));
    assert.ok(parsed);
    assert.strictEqual(parsed.fabricType, 'HubClientChat');
    assert.deepStrictEqual(parsed.payload, { text: 'hi', n: 1 });
    assert.deepStrictEqual(parsed.meta, { t: 2 });
  });

  it('tryParse rejects non-envelopes', function () {
    assert.strictEqual(envelope.tryParse(null), null);
    assert.strictEqual(envelope.tryParse({ fabricType: 'x' }), null);
    assert.strictEqual(envelope.tryParse({ '@fabric/BridgeEnvelope': true, v: 0, fabricType: 'x' }), null);
  });

  it('stringifyEnvelope', function () {
    const body = envelope.stringifyEnvelope('Test', { a: true });
    const p = envelope.tryParse(JSON.parse(body));
    assert.strictEqual(p.fabricType, 'Test');
    assert.strictEqual(p.payload.a, true);
  });
});
