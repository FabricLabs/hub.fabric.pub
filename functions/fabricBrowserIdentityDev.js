'use strict';

const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');

/**
 * Store an unlocked Fabric browser identity from a BIP39 mnemonic (and optional BIP39 passphrase).
 * Used by HubInterface dev bootstrap and IdentityManager "import mnemonic" flow.
 *
 * @param {Object} opts
 * @param {string} opts.seed - Mnemonic phrase (same field as @fabric/core Identity `seed`).
 * @param {string} [opts.passphrase] - Optional BIP39 extension passphrase (not the UI "encryption password").
 * @param {boolean} [opts.force] - When true, replace existing fabric.identity.local.
 * @returns {{ ok: boolean, error?: string, identity?: { id: string, xpub: string, xprv: string } }}
 */
function storeUnlockedIdentityFromMnemonic (opts = {}) {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'localStorage unavailable' };
  }
  const phrase = String(opts.seed || '').trim();
  if (!phrase) return { ok: false, error: 'Missing mnemonic' };
  const force = !!opts.force;
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
      masterXprv: String(xprv).trim(),
      id: idStr,
      xpub: dk.xpub,
      xprv: String(xprv).trim(),
      passwordProtected: false
    };
    writeStorageJSON('fabric.identity.local', payload);
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

module.exports = {
  storeUnlockedIdentityFromMnemonic
};
