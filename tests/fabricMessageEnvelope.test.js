'use strict';

const assert = require('assert');
const { validateEnvelopeV1, buildGenericMessageFromEnvelope, DEFAULT_SIGN_PROMPT } = require('../functions/fabricMessageEnvelope');

const author32 = 'aa'.repeat(32);

describe('fabricMessageEnvelope', function () {
  it('validates v1 none encryption', function () {
    const e = {
      '@fabric/MessageEnvelope': '1',
      encryption: 'none',
      author: { kind: 'taproot_contract_pubkey_hash', hex: author32 },
      signers: [{ role: 'alice', pubkeyHashHex: 'bb'.repeat(32), mustSign: true, notified: true }],
      display: { prompt: 'Custom would like you to sign:' },
      intent: 'contract_sign_request'
    };
    const v = validateEnvelopeV1(e);
    assert.strictEqual(v.ok, true);
    const msg = buildGenericMessageFromEnvelope(e);
    assert.ok(msg && msg.toBuffer && msg.toBuffer().length > 200);
  });

  it('rejects bad author hex', function () {
    const v = validateEnvelopeV1({
      '@fabric/MessageEnvelope': '1',
      encryption: 'none',
      author: { kind: 'taproot_contract_pubkey_hash', hex: 'bad' }
    });
    assert.strictEqual(v.ok, false);
  });

  it('DEFAULT_SIGN_PROMPT is non-empty', function () {
    assert.ok(DEFAULT_SIGN_PROMPT.length > 10);
  });
});
