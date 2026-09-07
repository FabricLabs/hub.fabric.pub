'use strict';

const crypto = require('crypto');

/** Align with `fabricIdentityBackupCrypto` / Passport backup export. */
const LOCAL_IDENTITY_KDF_ITERATIONS = 210000;
const LOCAL_IDENTITY_AT_REST_V2 = 'aes-256-gcm-pbkdf2-sha256';

function deriveKeyV2 (password, saltBuf) {
  return crypto.pbkdf2Sync(
    String(password || ''),
    saltBuf,
    LOCAL_IDENTITY_KDF_ITERATIONS,
    32,
    'sha256'
  );
}

function deriveKeyLegacy (password, saltHex) {
  return crypto.createHash('sha256')
    .update(String(saltHex || '') + String(password || ''))
    .digest();
}

/**
 * Encrypt key material for browser localStorage (v2: PBKDF2 + AES-256-GCM).
 * @param {string} material UTF-8 key material (xprv / master)
 * @param {string} password
 * @returns {{ passwordSalt: string, xprvEnc: string, atRestEncryption: string, kdfIterations: number }}
 */
function encryptLocalIdentityMaterial (material, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKeyV2(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(String(material).trim(), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    passwordSalt: salt.toString('hex'),
    xprvEnc: `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`,
    atRestEncryption: LOCAL_IDENTITY_AT_REST_V2,
    kdfIterations: LOCAL_IDENTITY_KDF_ITERATIONS
  };
}

/**
 * Decrypt stored key material (v2 GCM or legacy CBC).
 * @param {object} parsed localStorage record
 * @param {string} password
 * @returns {string}
 */
function decryptLocalIdentityMaterial (parsed, password) {
  if (!parsed || !parsed.xprvEnc || !parsed.passwordSalt) {
    throw new Error('Stored identity does not use encryption password storage.');
  }
  const parts = String(parsed.xprvEnc).split(':');
  if (parsed.atRestEncryption === LOCAL_IDENTITY_AT_REST_V2 || parts.length === 3) {
    if (parts.length !== 3) throw new Error('Invalid encrypted key format.');
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const blob = Buffer.from(parts[2], 'hex');
    if (iv.length !== 12) throw new Error('Invalid AES-GCM iv.');
    const salt = Buffer.from(String(parsed.passwordSalt), 'hex');
    const key = deriveKeyV2(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(blob), decipher.final()]);
    return plain.toString('utf8').trim();
  }
  if (parts.length !== 2) throw new Error('Invalid encrypted key format.');
  const keyBytes = deriveKeyLegacy(password, parsed.passwordSalt);
  const iv = Buffer.from(parts[0], 'hex');
  const blob = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBytes, iv);
  let decrypted = decipher.update(blob, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted.trim();
}

module.exports = {
  LOCAL_IDENTITY_KDF_ITERATIONS,
  LOCAL_IDENTITY_AT_REST_V2,
  encryptLocalIdentityMaterial,
  decryptLocalIdentityMaterial
};
