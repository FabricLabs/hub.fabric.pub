'use strict';

/**
 * Encrypt a Fabric identity backup JSON payload for download (browser Web Crypto).
 * @param {object} plaintextPayload - Keys to encrypt (xprv, mnemonic, etc.)
 * @param {string} password - User-chosen password for the file
 * @returns {Promise<object>} Serializable backup object (version 2)
 */
async function encryptFabricIdentityBackupPayload (plaintextPayload, password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Backup password must be at least 8 characters.');
  }
  if (
    typeof globalThis.crypto === 'undefined' ||
    !globalThis.crypto.subtle ||
    typeof globalThis.crypto.getRandomValues !== 'function'
  ) {
    throw new Error('Secure backup requires Web Crypto (HTTPS or localhost).');
  }
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(plaintextPayload));

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 210000,
      hash: 'SHA-256'
    },
    baseKey,
    256
  );
  const aesKey = await subtle.importKey(
    'raw',
    bits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintextBytes);

  function u8ToB64 (u8) {
    let s = '';
    u8.forEach((b) => {
      s += String.fromCharCode(b);
    });
    if (typeof btoa !== 'undefined') return btoa(s);
    return Buffer.from(u8).toString('base64');
  }

  return {
    type: 'fabric-identity-backup',
    version: 2,
    encryption: 'aes-256-gcm-pbkdf2-sha256',
    kdf: { iterations: 210000, salt: u8ToB64(salt) },
    iv: u8ToB64(iv),
    ciphertext: u8ToB64(new Uint8Array(ciphertext))
  };
}

function b64ToU8 (b64) {
  if (typeof atob !== 'undefined') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Decrypt a version-2 backup file back to the inner JSON object (same shape as v1 plaintext backups).
 * @param {object} encryptedFile
 * @param {string} password
 * @returns {Promise<object>}
 */
async function decryptFabricIdentityBackupToPayload (encryptedFile, password) {
  if (!encryptedFile || typeof encryptedFile !== 'object') {
    throw new Error('Invalid backup file.');
  }
  if (encryptedFile.version !== 2 || !encryptedFile.ciphertext) {
    throw new Error('Not an encrypted Fabric identity backup.');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Backup password must be at least 8 characters.');
  }
  if (
    typeof globalThis.crypto === 'undefined' ||
    !globalThis.crypto.subtle
  ) {
    throw new Error('Secure backup decryption requires Web Crypto (HTTPS or localhost).');
  }
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();

  const salt = b64ToU8(String(encryptedFile.kdf?.salt || ''));
  const iv = b64ToU8(String(encryptedFile.iv || ''));
  const rawCipher = b64ToU8(String(encryptedFile.ciphertext || ''));

  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const iterations = Number(encryptedFile.kdf?.iterations || 210000) || 210000;
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    256
  );
  const aesKey = await subtle.importKey(
    'raw',
    bits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, rawCipher);
  const decoder = new TextDecoder();
  const text = decoder.decode(plainBuf);
  return JSON.parse(text);
}

module.exports = {
  encryptFabricIdentityBackupPayload,
  decryptFabricIdentityBackupToPayload
};
