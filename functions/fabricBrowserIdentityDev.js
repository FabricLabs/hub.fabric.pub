'use strict';

const crypto = require('crypto');
const {
  readStorageString,
  writeStorageString,
  removeStorageKey
} = require('./fabricBrowserState');

/** Persistent marker so a wiped dev seed stays wiped across Hub launches. */
const DEV_SEED_SUPPRESSION_KEY = 'fabric.identity.devSeedSuppressedFor';

/**
 * Stable digest of a dev-seed mnemonic (with optional BIP39 passphrase).
 * Used to mark a specific seed as "wiped" so the next Hub launch does not
 * silently re-import it, even with `FABRIC_DEV_BROWSER_IDENTITY = 'force'`.
 *
 * @param {string} seed
 * @param {string} [passphrase]
 * @returns {string} hex sha256 digest
 */
function devSeedDigest (seed, passphrase) {
  const s = String(seed || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const p = String(passphrase || '');
  return crypto.createHash('sha256').update(s + '|' + p).digest('hex');
}

function readDevSeedSuppressionDigest () {
  try {
    if (typeof window === 'undefined') return '';
    return String(readStorageString(DEV_SEED_SUPPRESSION_KEY) || '');
  } catch (_) {
    return '';
  }
}

function isDevSeedSuppressed (seed, passphrase) {
  const stored = readDevSeedSuppressionDigest();
  if (!stored) return false;
  if (!seed) return false;
  return stored === devSeedDigest(seed, passphrase);
}

function suppressDevSeed (seed, passphrase) {
  if (typeof window === 'undefined') return '';
  const d = devSeedDigest(seed, passphrase);
  try { writeStorageString(DEV_SEED_SUPPRESSION_KEY, d); } catch (_) {}
  return d;
}

/**
 * Mark the dev seed this machine serves (if any) as wiped, so Remove identity
 * sticks across reloads. Call after clearing browser identity storage.
 * @returns {string} digest written, or ''
 */
function suppressActiveDevSeed () {
  if (typeof window === 'undefined') return '';
  const seed = String(window.FABRIC_DEV_BROWSER_SEED || '').trim();
  if (!seed) return '';
  const passRaw = window.FABRIC_DEV_BROWSER_PASSPHRASE;
  return suppressDevSeed(seed, passRaw != null ? String(passRaw) : '');
}

function clearDevSeedSuppression () {
  if (typeof window === 'undefined') return false;
  try { removeStorageKey(DEV_SEED_SUPPRESSION_KEY); } catch (_) {}
  return true;
}

/**
 * Apply `window.FABRIC_DEV_BROWSER_SEED` (from `assets/config.local.js` or
 * `FABRIC_DEV_PUSH_BROWSER_IDENTITY` HTML injection) as an unlocked identity
 * held in memory only: nothing is written to storage, so a reload derives it
 * again from the seed this machine serves itself. A sealed identity already
 * saved in this browser wins unless `FABRIC_DEV_BROWSER_IDENTITY = 'force'`.
 * No-op when the seed is missing or was wiped with Remove identity.
 *
 * @param {{ network?: string, hasStoredIdentity?: boolean }} [opts]
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, suppressed?: boolean, error?: string, identity?: object }}
 */
function applyFabricDevBrowserSeedBootstrap (opts = {}) {
  if (typeof window === 'undefined') {
    return { ok: false, skipped: true, reason: 'no-window' };
  }
  const seed = String(window.FABRIC_DEV_BROWSER_SEED || '').trim();
  if (!seed) return { ok: false, skipped: true, reason: 'no-seed' };
  const passRaw = window.FABRIC_DEV_BROWSER_PASSPHRASE;
  const passphrase = passRaw != null ? String(passRaw) : '';
  if (isDevSeedSuppressed(seed, passphrase)) {
    return {
      ok: false,
      suppressed: true,
      error: 'Dev-seed bootstrap is off because the identity was removed in this browser (Remove identity). Restore from the recovery phrase in the identity menu.'
    };
  }
  const force = String(window.FABRIC_DEV_BROWSER_IDENTITY || '').toLowerCase() === 'force';
  if (opts.hasStoredIdentity && !force) return { ok: false, skipped: true, reason: 'stored-identity' };
  try {
    const { masterFromMnemonic, unlockedIdentity } = require('./hubAccountVault');
    const master = masterFromMnemonic(seed.toLowerCase().replace(/\s+/g, ' '), passphrase);
    const identity = unlockedIdentity(master, { account: 0, network: opts.network || 'regtest' });
    identity.passwordProtected = false;
    identity.devSeed = true;
    return { ok: true, identity };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

module.exports = {
  DEV_SEED_SUPPRESSION_KEY,
  devSeedDigest,
  readDevSeedSuppressionDigest,
  isDevSeedSuppressed,
  suppressDevSeed,
  suppressActiveDevSeed,
  clearDevSeedSuppression,
  applyFabricDevBrowserSeedBootstrap
};
