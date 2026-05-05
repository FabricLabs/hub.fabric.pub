'use strict';

const assert = require('assert');

describe('fabricIdentityBackupCrypto', function () {
  it('encrypts then decrypts an inner backup payload', async function () {
    const crypto = require('crypto');
    if (typeof globalThis.crypto === 'undefined') {
      globalThis.crypto = crypto.webcrypto;
    }
    const {
      encryptFabricIdentityBackupPayload,
      decryptFabricIdentityBackupToPayload
    } = require('../functions/fabricIdentityBackupCrypto');

    const inner = {
      type: 'fabric-identity-backup-inner',
      version: 1,
      id: 'test-id',
      xpub: 'xpub661MyMwAqRbcF89Xj71Wc7Yd9wz7Y6VZfGqFZ8nqS9xQz9Qz',
      xprv: 'xprv9s21ZrQH143K2cCWaTZPjPDwac1CzTW4LKMfzLFEMNZJUoDYppxpyPgZXY7CZkjefGJTrTyqKnMrM4RG6nGn7Q9cwjHggCtn3CdFGJahaWY'
    };
    const enc = await encryptFabricIdentityBackupPayload(inner, 'test-pass-ok!');
    assert.strictEqual(enc.version, 2);
    assert.ok(enc.ciphertext);
    const plain = await decryptFabricIdentityBackupToPayload(enc, 'test-pass-ok!');
    assert.strictEqual(plain.xprv, inner.xprv);
    assert.strictEqual(plain.xpub, inner.xpub);
  });
});
