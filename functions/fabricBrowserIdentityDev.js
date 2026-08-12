'use strict';

const crypto = require('crypto');
const {
  readStorageJSON,
  writeStorageJSON,
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

function clearDevSeedSuppression () {
  if (typeof window === 'undefined') return false;
  try { removeStorageKey(DEV_SEED_SUPPRESSION_KEY); } catch (_) {}
  return true;
}

/**
 * Store an unlocked Fabric browser identity from a BIP39 mnemonic (and optional BIP39 passphrase).
 * Used by HubInterface dev bootstrap and IdentityManager "import mnemonic" flow.
 *
 * Behavior:
 * - If the user explicitly wiped this exact seed via {@link suppressDevSeed},
 *   the call returns `{ ok: false, suppressed: true }` regardless of `force`.
 * - Without `force`, an existing `fabric.identity.local` causes `{ ok: false, error: 'Identity already stored ...' }`.
 *
 * @param {Object} opts
 * @param {string} opts.seed - Mnemonic phrase (same field as @fabric/core Identity `seed`).
 * @param {string} [opts.passphrase] - Optional BIP39 extension passphrase (not the UI "encryption password").
 * @param {boolean} [opts.force] - When true, replace existing fabric.identity.local.
 * @param {boolean} [opts.ignoreSuppression] - When true (used by Identity manager "Restore from dev seed"), bypass the wipe marker.
 * @returns {{ ok: boolean, error?: string, suppressed?: boolean, identity?: { id: string, xpub: string, xprv: string } }}
 */
function storeUnlockedIdentityFromMnemonic (opts = {}) {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'localStorage unavailable' };
  }
  const phrase = String(opts.seed || '').trim();
  if (!phrase) return { ok: false, error: 'Missing mnemonic' };
  const force = !!opts.force;
  const ignoreSuppression = !!opts.ignoreSuppression;

  if (!ignoreSuppression && isDevSeedSuppressed(phrase, opts.passphrase)) {
    return {
      ok: false,
      suppressed: true,
      error: 'Dev-seed bootstrap was suppressed by Forget local identity. Use "Restore from dev seed" in the Identity panel to re-enable.'
    };
  }

  try {
    if (!force && readStorageJSON('fabric.identity.local', null)) {
      return { ok: false, error: 'Identity already stored (use force to replace)' };
    }
  } catch (e) {
    return { ok: false, error: 'Cannot read storage' };
  }

  const Identity = require('@fabric/core/types/identity');
  const {
    deriveFabricAccountIdentityKeys,
    fabricRootXpubFromMasterXprv
  } = require('./fabricAccountDerivedIdentity');
  const pass = opts.passphrase != null && String(opts.passphrase).trim() !== ''
    ? String(opts.passphrase)
    : null;
  try {
    const ident = new Identity(pass ? { seed: phrase, passphrase: pass } : { seed: phrase });
    const xprv = ident.key && ident.key.xprv;
    const xpub = ident.key && ident.key.xpub;
    if (!xprv || !xpub) return { ok: false, error: 'Key derivation failed' };
    const fabricAccountIndex = 0;
    const dk = deriveFabricAccountIdentityKeys(String(xprv).trim(), fabricAccountIndex, 0);
    const masterXpub = fabricRootXpubFromMasterXprv(String(xprv).trim());
    const idStr = String(dk.id);
    const payload = {
      fabricIdentityMode: 'account',
      fabricAccountIndex,
      masterXpub,
      id: idStr,
      xpub: dk.xpub,
      passwordProtected: false
    };
    writeStorageJSON('fabric.identity.local', payload);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('fabric.identity.unlocked', JSON.stringify({
          id: idStr,
          xpub: dk.xpub,
          xprv: dk.xprv,
          masterXprv: String(xprv).trim(),
          masterXpub,
          fabricIdentityMode: 'account',
          fabricAccountIndex
        }));
      }
    } catch (_) {}
    /** Re-enabling implies the user wants this seed to bootstrap again. */
    try { clearDevSeedSuppression(); } catch (_) {}
    return {
      ok: true,
      identity: {
        id: idStr,
        xpub: dk.xpub,
        xprv: dk.xprv,
        masterXprv: String(xprv).trim(),
        masterXpub,
        fabricIdentityMode: 'account',
        fabricAccountIndex: fabricAccountIndex
      }
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/**
 * Apply `window.FABRIC_DEV_BROWSER_SEED` (from `assets/config.local.js` or
 * `FABRIC_DEV_PUSH_BROWSER_IDENTITY` HTML injection) into local browser identity.
 * No-op when the seed is missing or suppressed.
 *
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, suppressed?: boolean, error?: string, identity?: object }}
 */
function applyFabricDevBrowserSeedBootstrap () {
  if (typeof window === 'undefined') {
    return { ok: false, skipped: true, reason: 'no-window' };
  }
  const seed = String(window.FABRIC_DEV_BROWSER_SEED || '').trim();
  if (!seed) return { ok: false, skipped: true, reason: 'no-seed' };
  const passRaw = window.FABRIC_DEV_BROWSER_PASSPHRASE;
  const passphrase = passRaw != null && String(passRaw).trim() !== ''
    ? String(passRaw)
    : undefined;
  const force = String(window.FABRIC_DEV_BROWSER_IDENTITY || '').toLowerCase() === 'force';
  return storeUnlockedIdentityFromMnemonic({
    seed,
    passphrase,
    force
  });
}

/**
 * Merge session unlock material onto a watch-only identity record (constructor / hydrate).
 * @param {object|null} identity
 * @returns {object|null}
 */
function mergeUnlockedSessionIntoIdentity (identity) {
  if (!identity || typeof identity !== 'object') return identity;
  if (typeof window === 'undefined' || !window.sessionStorage) return identity;
  let unlocked = null;
  try {
    unlocked = JSON.parse(window.sessionStorage.getItem('fabric.identity.unlocked') || 'null');
  } catch (_) {
    return identity;
  }
  if (!unlocked || typeof unlocked !== 'object') return identity;
  const idMatch = identity.id != null && unlocked.id != null &&
    String(identity.id) === String(unlocked.id);
  const xpubMatch = identity.xpub && unlocked.xpub &&
    String(identity.xpub) === String(unlocked.xpub);
  if (!idMatch && !xpubMatch) return identity;
  if (!unlocked.xprv) return identity;
  return Object.assign({}, identity, {
    xprv: unlocked.xprv,
    masterXprv: unlocked.masterXprv || identity.masterXprv || undefined,
    masterXpub: unlocked.masterXpub || identity.masterXpub || undefined,
    fabricIdentityMode: unlocked.fabricIdentityMode || identity.fabricIdentityMode,
    fabricAccountIndex: unlocked.fabricAccountIndex != null
      ? unlocked.fabricAccountIndex
      : identity.fabricAccountIndex,
    plaintextUnlockAvailable: false,
    passwordProtected: false
  });
}

module.exports = {
  DEV_SEED_SUPPRESSION_KEY,
  devSeedDigest,
  readDevSeedSuppressionDigest,
  isDevSeedSuppressed,
  suppressDevSeed,
  clearDevSeedSuppression,
  storeUnlockedIdentityFromMnemonic,
  applyFabricDevBrowserSeedBootstrap,
  mergeUnlockedSessionIntoIdentity
};
