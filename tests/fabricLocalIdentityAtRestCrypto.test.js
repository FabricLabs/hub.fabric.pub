'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  encryptLocalIdentityMaterial,
  decryptLocalIdentityMaterial,
  LOCAL_IDENTITY_AT_REST_V2
} = require('../functions/fabricLocalIdentityAtRestCrypto');

describe('fabricLocalIdentityAtRestCrypto', function () {
  it('round-trips v2 PBKDF2 + AES-GCM', function () {
    const sealed = encryptLocalIdentityMaterial('xprv9secretmaterial', 'correcthorse');
    assert.strictEqual(sealed.atRestEncryption, LOCAL_IDENTITY_AT_REST_V2);
    const plain = decryptLocalIdentityMaterial({
      passwordProtected: true,
      passwordSalt: sealed.passwordSalt,
      xprvEnc: sealed.xprvEnc,
      atRestEncryption: sealed.atRestEncryption
    }, 'correcthorse');
    assert.strictEqual(plain, 'xprv9secretmaterial');
  });

  it('still decrypts legacy sha256 + AES-CBC records', function () {
    const pwd = 'legacy-pass';
    const salt = crypto.randomBytes(16).toString('hex');
    const keyBytes = crypto.createHash('sha256').update(salt + pwd).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBytes, iv);
    const enc = Buffer.concat([cipher.update('legacy-xprv', 'utf8'), cipher.final()]);
    const parsed = {
      passwordProtected: true,
      passwordSalt: salt,
      xprvEnc: `${iv.toString('hex')}:${enc.toString('hex')}`
    };
    assert.strictEqual(decryptLocalIdentityMaterial(parsed, pwd), 'legacy-xprv');
  });
});
