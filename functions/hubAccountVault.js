'use strict';

/**
 * The browser's only local identity record: a core `FabricAccountVault`
 * (master xprv sealed by the lock password, the current account + network,
 * and the public data of every pair used so far). Unlocking opens the master
 * in memory; each (account, network) pair derives the identity key, the
 * wallet (`m/84'` + `m/44'`), and the cosigner key from it. Nothing private
 * is ever written unsealed, and no mnemonic is kept.
 */

const accountKeys = require('@fabric/core/functions/accountKeys');

const STORAGE_KEY = 'fabric.identity.local';
const LOCAL_IDENTITY_PASSWORD_MIN = 8;
const ACCOUNT_NETWORKS = Object.freeze(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest']);
const MAX_ACCOUNT_INDEX = 0x7fffffff;

/**
 * @param {*} record
 * @returns {boolean}
 */
function isAccountVault (record) {
  return !!(
    record &&
    typeof record === 'object' &&
    record.type === 'FabricAccountVault' &&
    record.v === 2 &&
    record.seal &&
    record.current &&
    record.accounts &&
    typeof record.accounts === 'object'
  );
}

/**
 * Passport sign-in record: identity id + pubkey only (keys stay in Passport).
 * @param {*} record
 * @returns {boolean}
 */
function isPassportRecord (record) {
  return !!(
    record &&
    typeof record === 'object' &&
    record.linkedFromPassport &&
    record.id &&
    /^0[23][0-9a-f]{64}$/.test(String(record.pubkey || '').toLowerCase()) &&
    !record.seal
  );
}

/**
 * @param {string} network
 * @returns {string} Canonical account network, or '' when unknown.
 */
function accountNetwork (network) {
  try {
    return accountKeys.normalizeAccountNetwork(network);
  } catch (_) {
    return '';
  }
}

/**
 * @param {*} value
 * @returns {number} Account index, or -1 when invalid.
 */
function accountIndex (value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= MAX_ACCOUNT_INDEX ? n : -1;
}

/** @private */
function assertLockPassword (lockPassword) {
  const pwd = String(lockPassword || '');
  if (pwd.trim().length < LOCAL_IDENTITY_PASSWORD_MIN) {
    const err = new Error(`Password must be at least ${LOCAL_IDENTITY_PASSWORD_MIN} characters.`);
    err.code = 'FABRIC_LOCAL_PASSWORD_POLICY';
    throw err;
  }
  return pwd;
}

/**
 * Public wallet of an account (the same shape a Passport `wallet` disclosure has).
 * @param {{ segwit: { xpub: string, path?: string }, standard: { xpub: string, path?: string } }} wallet
 * @returns {object}
 */
function publicWallet (wallet) {
  if (!wallet || !wallet.segwit || !wallet.standard) return null;
  const segwit = { xpub: String(wallet.segwit.xpub) };
  const standard = { xpub: String(wallet.standard.xpub) };
  if (wallet.segwit.path) segwit.path = String(wallet.segwit.path);
  if (wallet.standard.path) standard.path = String(wallet.standard.path);
  return { segwit, standard, receive: 'segwit', descriptors: accountKeys.walletDescriptors({ segwit, standard }) };
}

/**
 * In-memory identity for a vault pair's public view (no keys).
 * @param {object} view `accountPublicView` entry
 * @returns {object}
 */
function identityFromView (view) {
  return {
    id: view.identity.id,
    pubkey: view.identity.pubkey,
    network: view.network,
    label: view.label,
    fabricIdentityMode: 'account',
    fabricAccountIndex: view.account,
    wallet: publicWallet(view.wallet),
    cosigner: view.cosigner ? { pubkey: view.cosigner.pubkey } : null,
    passwordProtected: true,
    xprv: null,
    masterXprv: null
  };
}

/**
 * Unlocked identity for one pair: the identity key (`xprv`) signs Fabric
 * messages; `masterXprv` stays in memory for wallet, cosigner, and account
 * switching.
 * @param {string} master
 * @param {{ account: number, network: string, label?: string }} pair
 * @returns {object}
 */
function unlockedIdentity (master, pair = {}) {
  const derived = accountKeys.deriveAccount(master, { account: pair.account, network: pair.network });
  return Object.assign(identityFromView(accountKeys.accountPublicView(derived, pair.label)), {
    xprv: derived.identity.key.xprv,
    masterXprv: accountKeys.normalizeMasterXprv(master)
  });
}

/**
 * Locked identity for the vault's current pair.
 * @param {object} vault
 * @returns {object|null}
 */
function lockedIdentity (vault) {
  if (!isAccountVault(vault)) return null;
  const view = accountKeys.currentVaultAccount(vault);
  return view ? identityFromView(view) : null;
}

/**
 * Drop every private key from an in-memory identity.
 * @param {object} identity
 * @returns {object}
 */
function lockIdentity (identity) {
  if (!identity || typeof identity !== 'object') return identity;
  return Object.assign({}, identity, { xprv: null, masterXprv: null });
}

/**
 * Read a stored `fabric.identity.local` record. Only the vault and the
 * Passport record resolve; any other shape (older plaintext, watch-only xpub,
 * account-node records) is ignored.
 * @param {*} parsed
 * @returns {{ kind: ('vault'|'passport'|null), identity: (object|null) }}
 */
function readStoredIdentity (parsed) {
  if (isAccountVault(parsed)) {
    try {
      const identity = lockedIdentity(parsed);
      if (identity) return { kind: 'vault', identity };
    } catch (_) {}
    return { kind: null, identity: null };
  }
  if (isPassportRecord(parsed)) {
    return {
      kind: 'passport',
      identity: {
        id: String(parsed.id),
        pubkey: String(parsed.pubkey).toLowerCase(),
        network: parsed.network ? String(parsed.network) : undefined,
        signer: parsed.signer ? String(parsed.signer) : undefined,
        wallet: null,
        xprv: null,
        passwordProtected: false,
        linkedFromPassport: true
      }
    };
  }
  return { kind: null, identity: null };
}

/**
 * Master xprv from a mnemonic and optional BIP39 passphrase (the derivation
 * password). Callers drop both right after.
 * @param {string} mnemonic
 * @param {string} [passphrase]
 * @returns {string}
 */
function masterFromMnemonic (mnemonic, passphrase = '') {
  return accountKeys.importSeed(mnemonic, passphrase);
}

/**
 * New vault sealed with the lock password, plus the unlocked identity.
 * @param {{ master: string, lockPassword: string, account?: number, network?: string, label?: string }} params
 * @returns {{ vault: object, identity: object }}
 */
function createVault (params = {}) {
  const lockPassword = assertLockPassword(params.lockPassword);
  const network = accountNetwork(params.network) || 'mainnet';
  const account = accountIndex(params.account != null ? params.account : 0);
  if (account < 0) throw new RangeError('invalid account index');
  const master = accountKeys.normalizeMasterXprv(params.master);
  const vault = accountKeys.createAccountVault({ master, lockPassword, account, network, label: params.label });
  const view = accountKeys.currentVaultAccount(vault);
  return { vault, identity: unlockedIdentity(master, { account, network, label: view && view.label }) };
}

/**
 * Open the vault with the lock password.
 * @param {object} vault
 * @param {string} lockPassword
 * @returns {object} Unlocked identity for the current pair.
 */
function unlockVault (vault, lockPassword) {
  if (!isAccountVault(vault)) throw new TypeError('account vault required');
  const master = accountKeys.unsealMaster(vault.seal, String(lockPassword || ''));
  const view = accountKeys.currentVaultAccount(vault) || {};
  return unlockedIdentity(master, {
    account: vault.current.account,
    network: vault.current.network,
    label: view.label
  });
}

/**
 * Switch the vault to another account and/or network. With the master (an
 * unlocked identity) any pair derives; locked, only cached pairs.
 * @param {object} vault
 * @param {{ account: number, network: string, master?: string, label?: string }} params
 * @returns {{ vault: object, identity: object }}
 */
function switchVaultAccount (vault, params = {}) {
  if (!isAccountVault(vault)) throw new TypeError('account vault required');
  const network = accountNetwork(params.network);
  if (!network) throw new RangeError(`unknown network: ${params.network}`);
  const account = accountIndex(params.account);
  if (account < 0) throw new RangeError('invalid account index');
  const master = params.master ? accountKeys.normalizeMasterXprv(params.master) : null;
  const next = accountKeys.selectVaultAccount(vault, { account, network, master: master || undefined, label: params.label });
  const view = accountKeys.currentVaultAccount(next);
  const identity = master
    ? unlockedIdentity(master, { account, network, label: view && view.label })
    : identityFromView(view);
  return { vault: next, identity };
}

/**
 * Pairs the vault can switch to without unlocking.
 * @param {object} vault
 * @returns {Array<{ account: number, network: string, label: string, id: string }>}
 */
function cachedAccounts (vault) {
  if (!isAccountVault(vault)) return [];
  return Object.keys(vault.accounts).map((k) => vault.accounts[k]).filter(Boolean).map((v) => ({
    account: v.account,
    network: v.network,
    label: v.label,
    id: v.identity && v.identity.id
  })).sort((a, b) => (a.network === b.network ? a.account - b.account : a.network.localeCompare(b.network)));
}

/**
 * Wallet signing keys of an unlocked identity (account-level extended keys).
 * @param {object} identity
 * @returns {{ segwit: { xprv: string, xpub: string }, standard: { xprv: string, xpub: string } }|null}
 */
function walletSigningKeys (identity) {
  const master = identity && identity.masterXprv ? String(identity.masterXprv).trim() : '';
  if (!master) return null;
  const network = accountNetwork(identity.network) || 'mainnet';
  const account = accountIndex(identity.fabricAccountIndex != null ? identity.fabricAccountIndex : 0);
  if (account < 0) return null;
  const derived = accountKeys.deriveAccount(master, { account, network });
  const pair = (side) => ({
    xprv: accountKeys.extendedKeyForNetwork(derived.wallet[side].key.xprv, network),
    xpub: derived.wallet[side].xpub
  });
  return { segwit: pair('segwit'), standard: pair('standard') };
}

/**
 * Fabric signer of an unlocked identity, in the `{ id, fabricKey }` shape core
 * `fabricIdentitySchnorr` signs with.
 * @param {object} identity
 * @returns {{ id: string, fabricKey: object }|null}
 */
function identitySigner (identity) {
  const xprv = identity && identity.xprv ? String(identity.xprv).trim() : '';
  if (!xprv || !identity.id) return null;
  const Key = require('@fabric/core/types/key');
  const fabricKey = new Key({ xprv });
  if (identity.pubkey && String(fabricKey.pubkey).toLowerCase() !== String(identity.pubkey).toLowerCase()) return null;
  return { id: String(identity.id), fabricKey };
}

/**
 * Cosigner key of an unlocked identity (`m/87'/B'/n'/0/0`).
 * @param {object} identity
 * @returns {object|null} core Key
 */
function cosignerKey (identity) {
  const master = identity && identity.masterXprv ? String(identity.masterXprv).trim() : '';
  if (!master) return null;
  const network = accountNetwork(identity.network) || 'mainnet';
  const account = accountIndex(identity.fabricAccountIndex != null ? identity.fabricAccountIndex : 0);
  if (account < 0) return null;
  return accountKeys.deriveAccount(master, { account, network }).cosigner.key;
}

module.exports = {
  STORAGE_KEY,
  LOCAL_IDENTITY_PASSWORD_MIN,
  ACCOUNT_NETWORKS,
  MAX_ACCOUNT_INDEX,
  isAccountVault,
  isPassportRecord,
  accountNetwork,
  accountIndex,
  publicWallet,
  identityFromView,
  unlockedIdentity,
  lockedIdentity,
  lockIdentity,
  readStoredIdentity,
  masterFromMnemonic,
  generateMnemonic: accountKeys.generateMnemonic,
  createVault,
  unlockVault,
  switchVaultAccount,
  cachedAccounts,
  walletSigningKeys,
  identitySigner,
  cosignerKey
};
