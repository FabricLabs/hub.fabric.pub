'use strict';

const assert = require('assert');
const { normalizeFederationSignatureScheme } = require('../functions/federationSignatureScheme');

describe('federationSignatureScheme', () => {
  it('defaults to schnorr and accepts bls aliases', () => {
    assert.strictEqual(normalizeFederationSignatureScheme(undefined), 'schnorr');
    assert.strictEqual(normalizeFederationSignatureScheme('schnorr'), 'schnorr');
    assert.strictEqual(normalizeFederationSignatureScheme('bls'), 'bls');
    assert.strictEqual(normalizeFederationSignatureScheme('BLS12-381'), 'bls');
    assert.strictEqual(normalizeFederationSignatureScheme(true), 'bls');
    assert.strictEqual(normalizeFederationSignatureScheme('musig2'), 'schnorr');
  });
});
