'use strict';

/**
 * @fileoverview Tor v3 onion service keys in Tor's own on-disk format, so the
 * Hub knows its `.onion` address before Tor starts and keeps it across restarts.
 *
 * A key is an ed25519 keypair. Tor stores the *expanded* secret (64 bytes:
 * clamped SHA-512 of the seed) in `hs_ed25519_secret_key` and the public key
 * in `hs_ed25519_public_key`, each behind a 32-byte header; `hostname` holds
 * the address (rend-spec-v3 §6: base32(pubkey | checksum[0:2] | 0x03)).
 * The same expanded secret is what ControlPort `ADD_ONION ED25519-V3:` takes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_KEY_FILE = 'hs_ed25519_secret_key';
const PUBLIC_KEY_FILE = 'hs_ed25519_public_key';
const HOSTNAME_FILE = 'hostname';

/** @private */
const SECRET_HEADER = header('== ed25519v1-secret: type0 ==');
/** @private */
const PUBLIC_HEADER = header('== ed25519v1-public: type0 ==');
/** @private */
const ONION_VERSION = 3;
/** @private */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** @private 32-byte Tor key file header, NUL padded. */
function header (text) {
  const out = Buffer.alloc(32);
  out.write(text, 'ascii');
  return out;
}

/** @private RFC 4648 base32, lowercase, no padding. */
function base32 (buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * @param {Buffer} publicKey 32-byte ed25519 public key
 * @returns {string} `<56 chars>.onion`
 */
function onionAddressFromPublicKey (publicKey) {
  if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32) {
    throw new Error('onion public key must be 32 bytes');
  }
  const version = Buffer.from([ONION_VERSION]);
  const checksum = crypto.createHash('sha3-256')
    .update(Buffer.from('.onion checksum', 'ascii'))
    .update(publicKey)
    .update(version)
    .digest()
    .subarray(0, 2);
  return `${base32(Buffer.concat([publicKey, checksum, version]))}.onion`;
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isOnionAddress (address) {
  return /^[a-z2-7]{56}\.onion$/.test(String(address || ''));
}

/**
 * New onion service key.
 * @returns {{ secretKey: Buffer, publicKey: Buffer, address: string }} `secretKey` is the 64-byte expanded secret.
 */
function generateOnionKey () {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d, 'base64url');
  const publicKey = Buffer.from(jwk.x, 'base64url');
  const secretKey = crypto.createHash('sha512').update(seed).digest();
  secretKey[0] &= 248;
  secretKey[31] &= 127;
  secretKey[31] |= 64;
  return { secretKey, publicKey, address: onionAddressFromPublicKey(publicKey) };
}

/** @private */
function readKeyFile (filePath, expectedHeader, length) {
  const raw = fs.readFileSync(filePath);
  if (raw.length !== 32 + length || !raw.subarray(0, 32).equals(expectedHeader)) {
    throw new Error(`${filePath} is not a Tor v3 onion key file`);
  }
  return raw.subarray(32);
}

/** @private */
function writePrivate (filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

/**
 * Write a key as a Tor `HiddenServiceDir` (mode 0700, files 0600).
 * @param {string} dir
 * @param {{ secretKey: Buffer, publicKey: Buffer }} key
 * @returns {string} address
 */
function writeHiddenServiceDir (dir, key) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  const address = onionAddressFromPublicKey(key.publicKey);
  writePrivate(path.join(dir, SECRET_KEY_FILE), Buffer.concat([SECRET_HEADER, key.secretKey]));
  writePrivate(path.join(dir, PUBLIC_KEY_FILE), Buffer.concat([PUBLIC_HEADER, key.publicKey]));
  writePrivate(path.join(dir, HOSTNAME_FILE), `${address}\n`);
  return address;
}

/**
 * Key of a `HiddenServiceDir`, or null when it holds none.
 * @param {string} dir
 * @returns {({ secretKey: Buffer, publicKey: Buffer, address: string })|null}
 */
function readHiddenServiceDir (dir) {
  const secretPath = path.join(dir, SECRET_KEY_FILE);
  if (!fs.existsSync(secretPath)) return null;
  const secretKey = readKeyFile(secretPath, SECRET_HEADER, 64);
  const publicKey = readKeyFile(path.join(dir, PUBLIC_KEY_FILE), PUBLIC_HEADER, 32);
  return { secretKey, publicKey, address: onionAddressFromPublicKey(publicKey) };
}

/**
 * The Hub's onion key: read from `dir`, or created there once.
 * @param {string} dir
 * @returns {{ secretKey: Buffer, publicKey: Buffer, address: string, created: boolean }}
 */
function loadOrCreateOnionKey (dir) {
  const existing = readHiddenServiceDir(dir);
  if (existing) {
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
    return Object.assign(existing, { created: false });
  }
  const key = generateOnionKey();
  writeHiddenServiceDir(dir, key);
  return Object.assign(key, { created: true });
}

/**
 * Key blob for ControlPort `ADD_ONION`.
 * @param {Buffer} secretKey 64-byte expanded secret
 * @returns {string}
 */
function addOnionKeyBlob (secretKey) {
  return `ED25519-V3:${Buffer.from(secretKey).toString('base64')}`;
}

module.exports = {
  HOSTNAME_FILE,
  PUBLIC_KEY_FILE,
  SECRET_KEY_FILE,
  addOnionKeyBlob,
  generateOnionKey,
  isOnionAddress,
  loadOrCreateOnionKey,
  onionAddressFromPublicKey,
  readHiddenServiceDir,
  writeHiddenServiceDir
};
