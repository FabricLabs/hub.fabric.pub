'use strict';

/**
 * @fileoverview The Hub root key when no operator key is configured (no `FABRIC_XPRV` / seed /
 * mnemonic, no unlocked `~/.fabric/wallet.json`). It is generated once and kept in the Hub
 * store as `ROOT_KEY`, so the identity key, cosigner key, admin tokens, and federation
 * memberships survive restarts. The desktop shell seals it with Electron `safeStorage`; the CLI
 * keeps it in a 0600 file. A file that exists but cannot be read is an error, never replaced.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Key = require('@fabric/core/types/key');

const ROOT_KEY_FILE = 'ROOT_KEY';
const ROOT_KEY_TYPE = 'FabricHubRootKey';
const HUB_ROOT_KEY_REQUEST = 'hub-root-key-request';
const HUB_ROOT_KEY_RESULT = 'hub-root-key-result';

/**
 * @param {string} storeDir Hub store (`stores/hub`)
 * @returns {string}
 */
function rootKeyPath (storeDir) {
  return path.join(path.resolve(String(storeDir)), ROOT_KEY_FILE);
}

/** @private */
function checkedXprv (xprv, filePath) {
  const value = String(xprv || '').trim();
  try {
    const key = new Key({ xprv: value });
    if (key.xprv === value) return value;
  } catch (_) {}
  throw new Error(`${filePath} does not hold an extended private key`);
}

/**
 * @param {string} filePath
 * @param {Object} [opts]
 * @param {function(Buffer): string} [opts.unseal] required for a sealed file
 * @returns {string|null} xprv, or null when there is no file
 */
function readHubRootKey (filePath, opts = {}) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch (_) {
    record = null;
  }
  if (!record || record.type !== ROOT_KEY_TYPE || record.version !== 1) {
    throw new Error(`${filePath} is not a Hub root key file`);
  }
  if (!record.sealed) return checkedXprv(record.xprv, filePath);
  if (typeof opts.unseal !== 'function') {
    throw new Error(`${filePath} is sealed with the desktop app's OS keychain; start the Hub from the desktop app, or set FABRIC_XPRV`);
  }
  let xprv;
  try {
    xprv = opts.unseal(Buffer.from(String(record.ciphertext || ''), 'base64'));
  } catch (err) {
    throw new Error(`Could not unseal ${filePath} (${err && err.message ? err.message : err}); the Hub will not replace it`);
  }
  return checkedXprv(xprv, filePath);
}

/**
 * Read the Hub root key, or create it when there is none.
 * @param {Object} opts
 * @param {string} opts.filePath
 * @param {function(string): Buffer} [opts.seal] seal new keys (desktop `safeStorage.encryptString`)
 * @param {function(Buffer): string} [opts.unseal] unseal (desktop `safeStorage.decryptString`)
 * @returns {{ xprv: string, created: boolean, sealed: boolean }}
 */
function loadOrCreateHubRootKey (opts = {}) {
  const filePath = opts.filePath;
  if (!filePath) throw new Error('filePath is required');
  const existing = readHubRootKey(filePath, opts);
  if (existing) return { xprv: existing, created: false, sealed: isSealed(filePath) };

  const xprv = new Key({ seed: crypto.randomBytes(64).toString('hex') }).xprv;
  const record = { type: ROOT_KEY_TYPE, version: 1, createdAt: new Date().toISOString() };
  if (typeof opts.seal === 'function') {
    const ciphertext = Buffer.from(opts.seal(xprv));
    if (typeof opts.unseal === 'function' && String(opts.unseal(ciphertext)) !== xprv) {
      throw new Error('The OS keychain did not return the sealed Hub key');
    }
    record.sealed = true;
    record.ciphertext = ciphertext.toString('base64');
  } else {
    record.sealed = false;
    record.xprv = xprv;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try {
    // link() refuses to replace a file another process wrote first.
    fs.linkSync(tmp, filePath);
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
    const winner = readHubRootKey(filePath, opts);
    return { xprv: winner, created: false, sealed: isSealed(filePath) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
  return { xprv, created: true, sealed: record.sealed };
}

/** @private */
function isSealed (filePath) {
  try {
    return !!JSON.parse(fs.readFileSync(filePath, 'utf8')).sealed;
  } catch (_) {
    return false;
  }
}

module.exports = {
  ROOT_KEY_FILE,
  HUB_ROOT_KEY_REQUEST,
  HUB_ROOT_KEY_RESULT,
  rootKeyPath,
  readHubRootKey,
  loadOrCreateHubRootKey
};
