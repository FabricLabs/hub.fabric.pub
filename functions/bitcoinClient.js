'use strict';

const crypto = require('crypto');
const BIP32 = require('bip32').default;
const ecc = require('@fabric/core/types/ecc');
const payments = require('bitcoinjs-lib/src/payments');

const SETTINGS_KEY = 'fabric.bitcoin.upstream';
const PAYJOIN_PREFS_KEY = 'fabric.bitcoin.payjoinPreferences';
const LOCAL_WALLET_KEY = 'fabric.bitcoin.wallets';
const BALANCE_CACHE_KEY = 'fabric.bitcoin.balanceCache';
const BALANCE_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes - use cache if fetch fails and cache is newer
/** @deprecated Migrated once into receive + send keys; removed after read. */
const SESSION_BIP44_ACCOUNT_KEY = 'fabric.bitcoin.bip44Account';
/** Legacy sessionStorage (payment derivation uses fixed account index 0; keys kept for migration/tests). */
const SESSION_BIP44_RECEIVE_KEY = 'fabric.bitcoin.bip44ReceiveAccount';
/** @see SESSION_BIP44_RECEIVE_KEY */
const SESSION_BIP44_SEND_KEY = 'fabric.bitcoin.bip44SendAccount';
/** Legacy localStorage defaults (Settings UI no longer writes; payment path is fixed account 0). */
const LOCAL_BIP44_RECEIVE_DEFAULT_KEY = 'fabric.bitcoin.defaultBip44ReceiveAccount';
/** @see LOCAL_BIP44_RECEIVE_DEFAULT_KEY */
const LOCAL_BIP44_SEND_DEFAULT_KEY = 'fabric.bitcoin.defaultBip44SendAccount';
/**
 * All browser ↔ Hub Bitcoin payment flows use this BIP44 account under the Fabric identity master:
 * external addresses m/44'/0'/n'/0/* and change m/44'/0'/n'/1/*. Identity remains the signing root; n is fixed here.
 */
const BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX = 0;
/** Fired when session BIP44 keys change (legacy; payment wallet uses a fixed account and ignores session for derivation). */
const BITCOIN_WALLET_BRANCH_CHANGED = 'fabricBitcoinWalletBranchChanged';
/**
 * After a successful unlock, we persist the derived BIP44 payment-account xpub so a locked identity
 * (master xpub only) still resolves the same walletId / descriptors as the active browser session.
 */
const SPEND_XPUB_WATCH_KEY = 'fabric.bitcoin.spendXpubWatch';
const { safeIdentityErr } = require('./fabricSafeLog');

function loadSpendXpubWatchForIdentity (identity = {}) {
  const fabricId = identity && identity.id ? String(identity.id).trim() : '';
  const masterXpub = identity && identity.xpub ? String(identity.xpub).trim() : '';
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SPEND_XPUB_WATCH_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !p.spendAccountXpub) return null;
    const spendX = String(p.spendAccountXpub).trim();
    if (!spendX) return null;
    if (fabricId) {
      if (String(p.fabricIdentityId || '').trim() !== fabricId) return null;
    } else if (p.masterXpub && masterXpub && String(p.masterXpub).trim() !== masterXpub) {
      return null;
    }
    return spendX;
  } catch (_) {
    return null;
  }
}

function saveSpendXpubWatchForIdentity (identity = {}, wallet = {}) {
  const fabricId = identity && identity.id ? String(identity.id).trim() : '';
  const masterXpub = identity && identity.xpub ? String(identity.xpub).trim() : '';
  const spendAccountXpub = wallet && wallet.xpub ? String(wallet.xpub).trim() : '';
  if (!spendAccountXpub || !String(identity.xprv || '').trim()) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(SPEND_XPUB_WATCH_KEY, JSON.stringify({
      fabricIdentityId: fabricId || null,
      masterXpub: masterXpub || null,
      spendAccountXpub,
      walletId: wallet.walletId ? String(wallet.walletId) : null
    }));
  } catch (_) {}
}

function clearSpendXpubWatch () {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(SPEND_XPUB_WATCH_KEY);
  } catch (_) {}
}

function emitBitcoinWalletBranchChangedFromSession (detailRole) {
  try {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    const r =
      detailRole === 'receive' || detailRole === 'send' || detailRole === 'both' ? detailRole : 'both';
    window.dispatchEvent(new CustomEvent(BITCOIN_WALLET_BRANCH_CHANGED, {
      detail: {
        role: r,
        receive: loadSessionBip44Account({ role: 'receive' }),
        send: loadSessionBip44Account({ role: 'send' })
      }
    }));
  } catch (_) {}
}

function migrateLegacyBip44IfNeeded () {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    const legacy = window.sessionStorage.getItem(SESSION_BIP44_ACCOUNT_KEY);
    if (legacy == null || legacy === '') return;
    if (!window.sessionStorage.getItem(SESSION_BIP44_SEND_KEY)) {
      window.sessionStorage.setItem(SESSION_BIP44_SEND_KEY, legacy);
    }
    if (!window.sessionStorage.getItem(SESSION_BIP44_RECEIVE_KEY)) {
      window.sessionStorage.setItem(SESSION_BIP44_RECEIVE_KEY, legacy);
    }
    window.sessionStorage.removeItem(SESSION_BIP44_ACCOUNT_KEY);
  } catch (_) {}
}

function normalizeBaseUrl (value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function loadUpstreamSettings () {
  const defaults = {
    explorerBaseUrl: '/services/bitcoin',
    paymentsBaseUrl: '/services/bitcoin/payments',
    lightningBaseUrl: '/services/lightning',
    payjoinBaseUrl: '/services/payjoin',
    apiToken: ''
  };

  try {
    if (typeof window === 'undefined' || !window.localStorage) return defaults;
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      explorerBaseUrl: normalizeBaseUrl(parsed && parsed.explorerBaseUrl) || defaults.explorerBaseUrl,
      paymentsBaseUrl: normalizePaymentsBaseUrl(parsed && parsed.paymentsBaseUrl),
      lightningBaseUrl: normalizeLightningBaseUrl(parsed && parsed.lightningBaseUrl),
      payjoinBaseUrl: normalizePayjoinBaseUrl(parsed && parsed.payjoinBaseUrl),
      apiToken: String(parsed && parsed.apiToken ? parsed.apiToken : '')
    };
  } catch (e) {
    return defaults;
  }
}

/**
 * Defaults: Payjoin-oriented flows on (operator deposit, payments receive/send guidance).
 * Persisted in localStorage for the browser session / device.
 */
function defaultPayjoinPreferences () {
  return {
    operatorDeposit: true,
    paymentsReceive: true,
    paymentsSend: true
  };
}

function loadPayjoinPreferences () {
  const d = defaultPayjoinPreferences();
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...d };
    const raw = window.localStorage.getItem(PAYJOIN_PREFS_KEY);
    if (!raw) return { ...d };
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return { ...d };
    return { ...d, ...p };
  } catch (e) {
    return { ...d };
  }
}

function savePayjoinPreferences (patch = {}) {
  const next = Object.assign(loadPayjoinPreferences(), patch);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PAYJOIN_PREFS_KEY, JSON.stringify(next));
    }
  } catch (e) {}
  return next;
}

function saveUpstreamSettings (settings = {}) {
  const next = {
    explorerBaseUrl: normalizeBaseUrl(settings.explorerBaseUrl),
    paymentsBaseUrl: normalizePaymentsBaseUrl(settings.paymentsBaseUrl),
    lightningBaseUrl: normalizeLightningBaseUrl(settings.lightningBaseUrl),
    payjoinBaseUrl: normalizePayjoinBaseUrl(settings.payjoinBaseUrl),
    apiToken: String(settings.apiToken || '')
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('fabricBitcoinUpstreamChanged', { detail: next }));
      } catch (_) {}
    }
  } catch (e) {}

  return next;
}

/**
 * Derive wallet ID from xpub using the same formula as Fabric Bitcoin service (walletName).
 * Ensures client walletId matches the Hub's internal wallet name when identities align.
 * @param {string} xpub - BIP32 extended public key
 * @returns {string} 64-char hex (SHA256(SHA256(xpub)))
 */
function deriveWalletIdFromXpub (xpub = '') {
  const raw = String(xpub || '').trim();
  if (!raw) return '';
  const preimage = crypto.createHash('sha256').update(raw).digest('hex');
  return crypto.createHash('sha256').update(preimage).digest('hex');
}

/** Hub/client wallet id for the Fabric identity master xpub (before per-account derivation). */
function identityRootWalletId (identity = {}) {
  const xpub = identity && identity.xpub ? String(identity.xpub).trim() : '';
  if (!xpub) return '';
  return deriveWalletIdFromXpub(xpub);
}

function receiveAccountTagFromContext (wallet = {}) {
  const n = wallet.bitcoinBip44Account;
  if (n == null || n === '') return 'master';
  const idx = Number(n);
  if (!Number.isFinite(idx)) return 'master';
  return String(Math.floor(idx));
}

/**
 * localStorage bucket for the receive-address chain: one identity, one BIP44 account’s external 0/* pool.
 * Keys by identity root so switching “next receive” account does not orphan prior indices.
 */
function receiveAddressPoolStorageKey (identity, wallet = {}) {
  const legacyKey = String(wallet.walletId || wallet.id || '').trim();
  const root = identityRootWalletId(identity);
  if (!root || !legacyKey) return { poolKey: legacyKey, legacyKey };
  const tag = receiveAccountTagFromContext(wallet);
  return { poolKey: `${root}|recv|${tag}`, legacyKey };
}

function _bip44IndexFromStoredString (raw) {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'master' || s === 'legacy') return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 0x7fffffff) return null;
  return n;
}

/**
 * Read persisted default BIP44 branch from localStorage (Settings). Does not consider sessionStorage.
 * @param {'receive'|'send'} role
 * @returns {string|null} 'master', '0'…'3', or null if unset (same as master for derivation)
 */
function loadPersistedDefaultBip44Raw (role) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const key = role === 'receive' ? LOCAL_BIP44_RECEIVE_DEFAULT_KEY : LOCAL_BIP44_SEND_DEFAULT_KEY;
    const v = window.localStorage.getItem(key);
    if (v == null || !String(v).trim()) return null;
    return String(v).trim();
  } catch (_) {
    return null;
  }
}

/**
 * @param {'receive'|'send'} role
 * @returns {number|null} null = master xpub; else BIP44 account index
 */
function _effectiveDefaultBip44Index (role) {
  return _bip44IndexFromStoredString(loadPersistedDefaultBip44Raw(role));
}

/**
 * Save default receive/send BIP44 branch (Settings). value: 'master', 0–3, or null to clear.
 * @param {'receive'|'send'} role
 */
function savePersistedDefaultBip44Account (role, value) {
  const key = role === 'receive' ? LOCAL_BIP44_RECEIVE_DEFAULT_KEY : LOCAL_BIP44_SEND_DEFAULT_KEY;
  try {
    migrateLegacyBip44IfNeeded();
    if (typeof window === 'undefined' || !window.localStorage) return false;
    if (value === null || value === undefined || value === '') {
      window.localStorage.removeItem(key);
    } else {
      const s = typeof value === 'string' ? value.trim().toLowerCase() : value;
      if (s === 'master' || s === 'legacy') {
        window.localStorage.setItem(key, 'master');
      } else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(Math.floor(n)));
      }
    }
  } catch (_) {
    return false;
  }
  emitBitcoinWalletBranchChangedFromSession('both');
  return true;
}

/**
 * True if this tab has an explicit sessionStorage override (URL query or legacy picker).
 * @param {'receive'|'send'} role
 */
function hasBip44SessionOverride (role) {
  try {
    migrateLegacyBip44IfNeeded();
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    const k = role === 'receive' ? SESSION_BIP44_RECEIVE_KEY : SESSION_BIP44_SEND_KEY;
    const raw = window.sessionStorage.getItem(k);
    return raw != null && String(raw).trim() !== '';
  } catch (_) {
    return false;
  }
}

/**
 * Effective BIP44 account after session override and Settings defaults.
 * @param {'receive'|'send'} role
 * @returns {number|null} null = Fabric master xpub; 0+ = m/44'/0'/n'
 */
function loadSessionBip44Account (opts = {}) {
  const role = opts && opts.role === 'receive' ? 'receive' : 'send';
  try {
    migrateLegacyBip44IfNeeded();
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return _effectiveDefaultBip44Index(role);
    }
    const key = role === 'receive' ? SESSION_BIP44_RECEIVE_KEY : SESSION_BIP44_SEND_KEY;
    const raw = window.sessionStorage.getItem(key);
    if (raw == null || !String(raw).trim()) {
      return _effectiveDefaultBip44Index(role);
    }
    const s = String(raw).trim().toLowerCase();
    if (s === 'master' || s === 'legacy') return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 0x7fffffff) {
      return _effectiveDefaultBip44Index(role);
    }
    return n;
  } catch (e) {
    return _effectiveDefaultBip44Index(role);
  }
}

/**
 * Per-tab sessionStorage override. Pass null to remove override (use Settings default).
 * Pass 'master' to force master xpub for this tab even when Settings default is an account.
 * @param {number|string|null|undefined} value - account index, 'master', or null/'' to clear override
 * @param {{ role?: 'receive'|'send' }} [opts] - default role send (Payments / Bitcoin home).
 */
function saveSessionBip44Account (value, opts = {}) {
  const role = opts && opts.role === 'receive' ? 'receive' : 'send';
  const key = role === 'receive' ? SESSION_BIP44_RECEIVE_KEY : SESSION_BIP44_SEND_KEY;
  try {
    migrateLegacyBip44IfNeeded();
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (value === null || value === undefined || value === '') {
        window.sessionStorage.removeItem(key);
      } else if (typeof value === 'string' && String(value).trim().toLowerCase() === 'master') {
        window.sessionStorage.setItem(key, 'master');
      } else if (typeof value === 'string' && String(value).trim().toLowerCase() === 'legacy') {
        window.sessionStorage.setItem(key, 'master');
      } else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, String(Math.floor(n)));
        }
      }
    }
  } catch (e) {}
  emitBitcoinWalletBranchChangedFromSession(role);
}

/**
 * Derive extended keys at m/44'/0'/accountIndex' from the Fabric identity master (matches @fabric/core Key Bitcoin path shape).
 * @param {string} masterXprv
 * @param {string} masterXpub - used to pick test/main network for bip32 decode
 * @param {number} accountIndex
 */
function deriveFabricBitcoinAccountKeys (masterXprv, masterXpub, accountIndex) {
  const idx = Math.floor(Number(accountIndex));
  if (!Number.isFinite(idx) || idx < 0) throw new Error('Invalid BIP44 account index.');
  const decodeNetwork = getNetworkFromXpub(masterXpub || masterXprv);
  const bip32 = new BIP32(ecc);
  const master = bip32.fromBase58(String(masterXprv).trim(), decodeNetwork);
  const path = `m/44'/0'/${idx}'`;
  const acct = master.derivePath(path);
  return {
    xprv: acct.toBase58(),
    xpub: acct.neutered().toBase58(),
    path
  };
}

/**
 * Wallet context for Hub Bitcoin APIs (walletId, xpub, …).
 * One browser wallet (one identity): {@link getSpendWalletContext} / {@link getNextReceiveWalletContext} always use
 * {@link BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX} under the master. Callers may pass `fixedBitcoinBip44Account` to override;
 * otherwise session + Settings defaults apply (legacy / advanced use).
 * @param {object} identity - Fabric identity (master xpub / xprv on the identity object)
 * @param {{ role?: 'receive'|'send', fixedBitcoinBip44Account?: number }} [opts] - role affects legacy session lookup only when fixed index omitted
 */
function getWalletContextFromIdentity (identity = {}, opts = {}) {
  let xpub = identity && identity.xpub ? String(identity.xpub) : '';
  let xprv = identity && identity.xprv ? String(identity.xprv) : '';
  const id = identity && identity.id ? String(identity.id) : '';
  const address = identity && identity.address ? String(identity.address) : '';
  const role = opts && opts.role === 'receive' ? 'receive' : 'send';
  const fixed = opts && opts.fixedBitcoinBip44Account;
  const accountN =
    fixed != null && Number.isFinite(Number(fixed)) && Number(fixed) >= 0
      ? Math.floor(Number(fixed))
      : loadSessionBip44Account({ role });

  if (accountN != null && xprv) {
    try {
      const d = deriveFabricBitcoinAccountKeys(xprv, xpub, accountN);
      xpub = d.xpub;
      xprv = d.xprv;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[bitcoinClient] BIP44 tab account derive failed; using master key.', safeIdentityErr(e));
      }
    }
  }

  if (!String(identity.xprv || '').trim()) {
    const watchedSpend = loadSpendXpubWatchForIdentity(identity);
    if (watchedSpend) {
      xpub = watchedSpend;
      xprv = '';
    } else if (identity && identity.passwordProtected) {
      // Locked Fabric identity: payment account xpub is not derivable from the stored master xpub alone.
      // Avoid querying the wrong descriptor set until an unlock persists saveSpendXpubWatchForIdentity().
      xpub = '';
      xprv = '';
    }
  }

  // Use Fabric ID that matches internal wallet name: SHA256(SHA256(xpub)) when xpub present
  const walletId = xpub
    ? deriveWalletIdFromXpub(xpub)
    : (address && /^[a-fA-F0-9]{64}$/.test(address) ? address : null) ||
      (id && /^[a-fA-F0-9]{64}$/.test(id) ? id : null) ||
      (() => {
        const basis = id || 'anonymous';
        const fingerprint = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
        return `fabric-${fingerprint}`;
      })();

  const fingerprint = crypto.createHash('sha256').update(xpub || id || 'anonymous').digest('hex').slice(0, 16);

  /**
   * BIP84-style descriptors for the identity's receive and change chains.
   * Used by the address API (scantxoutset) to retrieve per-user balance when txindex is available.
   * Format: wpkh(xpub/0/*) receive, wpkh(xpub/1/*) change.
   */
  const descriptors = xpub
    ? [
        { desc: `wpkh(${xpub}/0/*)`, chain: 'receive', path: 'm/0/*' },
        { desc: `wpkh(${xpub}/1/*)`, chain: 'change', path: 'm/1/*' }
      ]
    : [];

  const hasPrivateKey = !!String(identity.xprv || '').trim();
  const out = {
    walletId,
    fingerprint,
    xpub,
    hasPrivateKey,
    descriptors,
    bitcoinBip44Account: accountN
  };
  if (String(xprv || '').trim()) out.xprv = String(xprv).trim();
  return out;
}

/** One browser wallet: xpub/walletId for balance, UTXOs, spends, change chain (BIP44 account 0 under identity master). */
function getSpendWalletContext (identity = {}) {
  return getWalletContextFromIdentity(identity, {
    role: 'send',
    fixedBitcoinBip44Account: BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX
  });
}

/** Same account as spends; xpub/walletId for the next external receive address (invoices, deposits). */
function getNextReceiveWalletContext (identity = {}) {
  return getWalletContextFromIdentity(identity, {
    role: 'receive',
    fixedBitcoinBip44Account: BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX
  });
}

function getNetworkFromXpub (xpub = '') {
  const raw = String(xpub || '').trim();
  const isTest = raw.startsWith('tpub') || raw.startsWith('upub') || raw.startsWith('vpub');
  return isTest
    ? {
        bech32: 'tb',
        bip32: { public: 0x043587cf, private: 0x04358394 },
        pubKeyHash: 0x6f,
        scriptHash: 0xc4,
        wif: 0xef
      }
    : {
        bech32: 'bc',
        bip32: { public: 0x0488b21e, private: 0x0488ade4 },
        pubKeyHash: 0x00,
        scriptHash: 0x05,
        wif: 0x80
      };
}

/** Network config for bitcoinjs-lib by name; use when Hub is regtest so addresses are bcrt1. */
function getNetworkForBitcoinJs (networkName = '') {
  const n = String(networkName || '').toLowerCase();
  if (n === 'regtest') {
    return {
      bech32: 'bcrt',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    };
  }
  if (n === 'testnet' || n === 'signet') {
    return {
      bech32: 'tb',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    };
  }
  if (n === 'mainnet' || n === 'main') {
    return {
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80
    };
  }
  return null;
}

function loadBalanceCache () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(BALANCE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function saveBalanceCache (store = {}) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(store || {}));
    }
  } catch (e) {}
}

/**
 * Get cached balance for a wallet. Returns null if no cache or cache is stale.
 * @param {string} walletId - Wallet ID (derived from xpub)
 * @param {number} [maxAgeMs] - Max age in ms; if cache is older, returns null
 * @returns {{ balanceSats: number, confirmedSats: number, unconfirmedSats: number, fetchedAt: number }|null}
 */
function getCachedBalance (walletId = '', maxAgeMs = BALANCE_CACHE_MAX_AGE_MS) {
  const id = String(walletId || '').trim();
  if (!id) return null;
  if (maxAgeMs === 0) return null; // bypass cache when explicitly requested
  const store = loadBalanceCache();
  const entry = store[id];
  if (!entry || typeof entry !== 'object') return null;
  const fetchedAt = Number(entry.fetchedAt || 0);
  if (fetchedAt <= 0 || (maxAgeMs > 0 && Date.now() - fetchedAt > maxAgeMs)) return null;
  return {
    balanceSats: Number(entry.balanceSats || 0),
    confirmedSats: Number(entry.confirmedSats || entry.balanceSats || 0),
    unconfirmedSats: Number(entry.unconfirmedSats || 0),
    fetchedAt
  };
}

/**
 * Save balance to cache. Only stores non-sensitive data (no keys).
 */
function setCachedBalance (walletId = '', data = {}) {
  const id = String(walletId || '').trim();
  if (!id) return;
  const store = loadBalanceCache();
  store[id] = {
    balanceSats: Number(data.balanceSats ?? data.balance ?? 0),
    confirmedSats: Number(data.confirmedSats ?? data.balanceSats ?? data.balance ?? 0),
    unconfirmedSats: Number(data.unconfirmedSats ?? 0),
    fetchedAt: Date.now()
  };
  saveBalanceCache(store);
}

/**
 * Clear balance cache for a wallet. Call after faucet or block generation so the next
 * fetch returns fresh data instead of stale 0.
 */
function clearBalanceCache (walletId = '') {
  const id = String(walletId || '').trim();
  if (!id) return;
  const store = loadBalanceCache();
  delete store[id];
  saveBalanceCache(store);
}

function loadLocalWalletStore () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(LOCAL_WALLET_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function saveLocalWalletStore (store = {}) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_WALLET_KEY, JSON.stringify(store || {}));
    }
  } catch (e) {}
}

/**
 * Derive receive address from xpub at index.
 * @param {string} xpub - Extended public key
 * @param {number} index - Address index
 * @param {string} [networkName] - Hub network ('regtest', 'testnet', 'mainnet') so address uses bcrt1/tb1/bc1; omit to infer from xpub
 */
function deriveReceiveAddressFromXpub (xpub = '', index = 0, networkName = '') {
  if (!xpub) return null;
  const bip32 = new BIP32(ecc);
  const decodeNetwork = getNetworkFromXpub(xpub);
  const account = bip32.fromBase58(String(xpub), decodeNetwork);
  const child = account.derive(0).derive(Number(index || 0));
  const pubkey = child.publicKey;
  const addressNetwork = (networkName && getNetworkForBitcoinJs(networkName)) || decodeNetwork;
  const payment = payments.p2wpkh({ pubkey, network: addressNetwork });
  if (!payment || !payment.address) return null;
  return {
    address: String(payment.address),
    derivationPath: `m/0/${Number(index || 0)}`,
    index: Number(index || 0),
    type: 'p2wpkh'
  };
}

/**
 * Derive address from xpub at chain/index. Chain 0 = receive, 1 = change.
 */
function deriveAddressFromXpub (xpub = '', chain = 0, index = 0, networkName = '') {
  if (!xpub) return null;
  const bip32 = new BIP32(ecc);
  const decodeNetwork = getNetworkFromXpub(xpub);
  const account = bip32.fromBase58(String(xpub), decodeNetwork);
  const child = account.derive(Number(chain)).derive(Number(index));
  const pubkey = child.publicKey;
  const addressNetwork = (networkName && getNetworkForBitcoinJs(networkName)) || decodeNetwork;
  const payment = payments.p2wpkh({ pubkey, network: addressNetwork });
  if (!payment || !payment.address) return null;
  return payment.address;
}

/**
 * Derive watch addresses for mempool scan. Returns addresses for receive (0/*) and change (1/*).
 * Used to detect unconfirmed incoming payments.
 */
function deriveWatchAddresses (wallet = {}, networkName = '', maxReceive = 25, maxChange = 25) {
  const xpub = String(wallet.xpub || '').trim();
  if (!xpub) return [];
  const addrs = [];
  for (let i = 0; i < maxReceive; i++) {
    const a = deriveAddressFromXpub(xpub, 0, i, networkName);
    if (a) addrs.push(a);
  }
  for (let i = 0; i < maxChange; i++) {
    const a = deriveAddressFromXpub(xpub, 1, i, networkName);
    if (a) addrs.push(a);
  }
  return addrs;
}

function deriveAndStoreReceiveAddress (wallet = {}, options = {}) {
  const identity = options && options.identity;
  const networkName = options && options.network;
  const xpub = String(wallet.xpub || '').trim();
  const legacyKey = String(wallet.walletId || wallet.id || '').trim();
  if (!legacyKey || !xpub) return null;

  let storageKey = legacyKey;
  if (identity && typeof identity === 'object' && identity.xpub) {
    const { poolKey } = receiveAddressPoolStorageKey(identity, wallet);
    if (poolKey) storageKey = poolKey;
  }

  const store = loadLocalWalletStore();
  let current = (store[storageKey] && typeof store[storageKey] === 'object') ? store[storageKey] : {};
  let migratedFromLegacy = false;

  if (
    (!Array.isArray(current.receiveAddresses) || current.receiveAddresses.length === 0) &&
    storageKey !== legacyKey &&
    store[legacyKey] &&
    typeof store[legacyKey] === 'object'
  ) {
    const leg = store[legacyKey];
    if (Array.isArray(leg.receiveAddresses) && leg.receiveAddresses.length > 0) {
      current = { ...leg, xpub };
      migratedFromLegacy = true;
    }
  }

  const addresses = Array.isArray(current.receiveAddresses) ? current.receiveAddresses : [];

  if (migratedFromLegacy && addresses.length > 0 && storageKey !== legacyKey) {
    store[storageKey] = {
      ...current,
      id: legacyKey,
      xpub,
      updatedAt: new Date().toISOString()
    };
    saveLocalWalletStore(store);
  }

  if (addresses.length > 0) {
    const latest = addresses[addresses.length - 1];
    const idx = Number(latest.index ?? 0);
    const derived = deriveReceiveAddressFromXpub(xpub, idx, networkName);
    const currentAddress = derived ? derived.address : (latest.address || '');
    return {
      id: legacyKey,
      currentAddress,
      currentIndex: idx,
      receiveAddresses: addresses
    };
  }

  const derived = deriveReceiveAddressFromXpub(xpub, 0, networkName);
  if (!derived) return null;

  const nextWallet = {
    id: legacyKey,
    xpub,
    currentIndex: derived.index,
    currentAddress: derived.address,
    receiveAddresses: [derived],
    updatedAt: new Date().toISOString()
  };

  store[storageKey] = nextWallet;
  saveLocalWalletStore(store);
  return nextWallet;
}

function reserveNextReceiveAddress (wallet = {}, options = {}) {
  const identity = options && options.identity;
  const networkName = options && options.network;
  const xpub = String(wallet.xpub || '').trim();
  const legacyKey = String(wallet.walletId || wallet.id || '').trim();
  if (!legacyKey || !xpub) return null;

  let storageKey = legacyKey;
  if (identity && typeof identity === 'object' && identity.xpub) {
    const { poolKey } = receiveAddressPoolStorageKey(identity, wallet);
    if (poolKey) storageKey = poolKey;
  }

  const store = loadLocalWalletStore();
  let current = (store[storageKey] && typeof store[storageKey] === 'object') ? store[storageKey] : {
    id: legacyKey,
    xpub,
    currentIndex: -1,
    receiveAddresses: []
  };

  if (
    (!Array.isArray(current.receiveAddresses) || current.receiveAddresses.length === 0) &&
    storageKey !== legacyKey &&
    store[legacyKey] &&
    typeof store[legacyKey] === 'object'
  ) {
    const leg = store[legacyKey];
    if (Array.isArray(leg.receiveAddresses) && leg.receiveAddresses.length > 0) {
      current = { ...leg, xpub };
    }
  }

  const prevAddrs = Array.isArray(current.receiveAddresses) ? current.receiveAddresses : [];
  const nextIndex = Number(current.currentIndex !== undefined && current.currentIndex !== null
    ? current.currentIndex
    : -1) + 1;
  const derived = deriveReceiveAddressFromXpub(xpub, nextIndex, networkName);
  if (!derived) return null;

  const nextWallet = {
    ...current,
    id: legacyKey,
    xpub,
    currentIndex: nextIndex,
    currentAddress: derived.address,
    receiveAddresses: [...prevAddrs, derived],
    updatedAt: new Date().toISOString()
  };

  store[storageKey] = nextWallet;
  saveLocalWalletStore(store);
  return nextWallet;
}

function makeHeaders (apiToken = '', method = 'GET') {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  return headers;
}

async function requestJSON (url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const headers = makeHeaders(options.apiToken, method);
  const response = await fetch(url, { method, headers, body });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let msg = `${response.status} ${response.statusText}`;
    try {
      const errJson = JSON.parse(text);
      if (errJson && (errJson.message || errJson.error)) {
        msg = errJson.message || errJson.error;
        if (errJson.detail) msg += ': ' + String(errJson.detail);
      } else if (text) msg += ': ' + text.slice(0, 200);
    } catch (_) {
      if (text) msg += ': ' + text.slice(0, 200);
    }
    throw new Error(msg);
  }
  return response.json();
}

function pickArray (payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function pickObject (payload, keys = []) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const key of keys) {
      const v = payload[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    }
    return payload;
  }
  return {};
}

async function tryRequests (baseUrl, requests = [], apiToken = '') {
  if (!baseUrl) return null;
  let lastError = null;

  for (const req of requests) {
    const method = req.method || 'GET';
    const path = req.path ?? '';
    const root = baseUrl.replace(/\/+$/, '');
    let url = root;
    if (path) {
      if (path.startsWith('?')) url = `${root}${path}`;
      else url = `${root}${path.startsWith('/') ? path : '/' + path}`;
    }
    try {
      const data = await requestJSON(url, { method, body: req.body, apiToken });
      return { data, path, method };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return null;
}

function resolveBaseUrl (value, fallback = '/services/bitcoin') {
  const normalized = normalizeBaseUrl(value);
  return normalized || normalizeBaseUrl(fallback);
}

function normalizeWalletsBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/bitcoin/wallets';
  if (/\/services\/bitcoin$/i.test(normalized)) return `${normalized}/wallets`;
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return normalized.replace(/\/payments$/i, '/wallets');
  if (/\/wallet$/i.test(normalized)) return normalized.replace(/\/wallet$/i, '/wallets');
  return normalized;
}

function normalizePaymentsBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/bitcoin/payments';
  if (/\/services\/bitcoin$/i.test(normalized)) return `${normalized}/payments`;
  if (/\/services\/bitcoin\/wallets$/i.test(normalized)) return normalized.replace(/\/wallets$/i, '/payments');
  return normalized;
}

function normalizeAddressesBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/bitcoin/addresses';
  if (/\/services\/bitcoin$/i.test(normalized)) return `${normalized}/addresses`;
  if (/\/services\/bitcoin\/wallets$/i.test(normalized)) return normalized.replace(/\/wallets$/i, '/addresses');
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return normalized.replace(/\/payments$/i, '/addresses');
  return normalized;
}

function normalizeLightningBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/lightning';
  if (/\/services\/bitcoin$/i.test(normalized)) return '/services/lightning';
  if (/\/services\/bitcoin\/lightning$/i.test(normalized)) return '/services/lightning';
  return normalized;
}

function normalizePayjoinBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/payjoin';
  if (/\/services\/bitcoin\/payjoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/services\/bitcoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return '/services/payjoin';
  return normalized;
}

function isBitcoinServiceEndpoint (baseUrl = '') {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/services\/bitcoin$/i.test(normalized);
}

async function callBitcoinServiceMethod (baseUrl, method, params = {}, apiToken = '') {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) throw new Error('Bitcoin service endpoint is not configured.');
  return requestJSON(normalized, {
    method: 'POST',
    body: { method, params },
    apiToken
  });
}

async function fetchExplorerDataAtBase (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return { blocks: [], transactions: [] };

  if (isBitcoinServiceEndpoint(baseUrl)) {
    const [blocksData, txData] = await Promise.all([
      callBitcoinServiceMethod(baseUrl, 'ListBlocks', { limit: 10 }, settings.apiToken).catch(() => []),
      callBitcoinServiceMethod(baseUrl, 'ListTransactions', { limit: 10 }, settings.apiToken).catch(() => [])
    ]);
    return {
      blocks: pickArray(blocksData, ['blocks', 'items', 'results', 'data']),
      transactions: pickArray(txData, ['transactions', 'items', 'results', 'data'])
    };
  }

  const blocksResp = await tryRequests(baseUrl, [
    { path: '/blocks?limit=10' },
    { path: '/api/blocks?limit=10' },
    { path: '/v1/blocks?limit=10' }
  ], settings.apiToken);

  const txResp = await tryRequests(baseUrl, [
    { path: '/transactions?limit=10' },
    { path: '/api/transactions?limit=10' },
    { path: '/v1/transactions?limit=10' }
  ], settings.apiToken);

  return {
    blocks: blocksResp ? pickArray(blocksResp.data, ['blocks', 'items', 'results', 'data']) : [],
    transactions: txResp ? pickArray(txResp.data, ['transactions', 'items', 'results', 'data']) : []
  };
}

async function fetchExplorerData (settings = {}) {
  return fetchExplorerDataAtBase(settings);
}

async function fetchBitcoinStatusAtBase (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return { available: false, status: 'UNAVAILABLE' };
  const result = await tryRequests(baseUrl, [
    { path: '' }
  ], settings.apiToken);
  return pickObject(result ? result.data : {}, ['status', 'result', 'data']);
}

async function fetchBitcoinStatus (settings = {}) {
  return fetchBitcoinStatusAtBase(settings);
}

async function fetchBlockByHash (settings = {}, blockhash = '') {
  const bUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const hash = String(blockhash || '').trim();
  if (!bUrl || !hash) return null;
  const result = await tryRequests(bUrl, [
    { path: `/blocks/${encodeURIComponent(hash)}` }
  ], settings.apiToken);
  const obj = pickObject(result ? result.data : {}, ['block', 'data', 'result']);
  if (obj && Object.keys(obj).length) return obj;
  return null;
}

async function fetchTransactionByHash (settings = {}, txhash = '') {
  const bUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const hash = String(txhash || '').trim();
  if (!bUrl || !hash) return null;
  const result = await tryRequests(bUrl, [
    { path: `/transactions/${encodeURIComponent(hash)}` }
  ], settings.apiToken);
  const obj = pickObject(result ? result.data : {}, ['transaction', 'data', 'result']);
  if (obj && Object.keys(obj).length) return obj;
  return null;
}

/**
 * Raw transaction hex for PSBT prevouts. Same GET as explorer tx view; requires txindex when unconfirmed.
 * @returns {Promise<string>} hex or '' if missing
 */
async function fetchTransactionHex (settings = {}, txhash = '') {
  const bUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const hash = String(txhash || '').trim();
  if (!bUrl || !hash) return '';
  try {
    const root = normalizeBaseUrl(bUrl);
    const data = await requestJSON(`${root}/transactions/${encodeURIComponent(hash)}`, {
      method: 'GET',
      apiToken: settings.apiToken
    });
    return data && data.hex ? String(data.hex) : '';
  } catch (e) {
    return '';
  }
}

async function fetchWalletSummary (settings = {}, wallet = {}, options = {}) {
  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return {};

  const walletId = String(wallet.walletId || '').trim();
  if (!walletId) return {};

  const encodedId = encodeURIComponent(walletId);
  const params = new URLSearchParams();
  if (wallet.xpub) params.set('xpub', wallet.xpub);
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }

  const path = params.toString() ? `/${encodedId}?${params.toString()}` : `/${encodedId}`;
  const summary = await tryRequests(baseUrl, [
    { path }
  ], settings.apiToken);

  const raw = pickObject(summary ? summary.data : {}, ['wallet', 'data']);
  if (raw && typeof raw === 'object') {
    const balanceSats = raw.balanceSats ?? raw.balance_sats;
    const confirmedSats = raw.confirmedSats ?? raw.confirmed_sats ?? balanceSats;
    const unconfirmedSats = raw.unconfirmedSats ?? raw.unconfirmed_sats;
    const fromSummary = (v) => (v != null && typeof v === 'number') ? Math.round(v * 100000000) : undefined;
    const result = {
      ...raw,
      balanceSats: balanceSats != null ? Number(balanceSats) : (raw.summary && raw.summary.trusted != null ? fromSummary(raw.summary.trusted) : undefined),
      confirmedSats: confirmedSats != null ? Number(confirmedSats) : (raw.summary && raw.summary.trusted != null ? fromSummary(raw.summary.trusted) : undefined),
      unconfirmedSats: unconfirmedSats != null ? Number(unconfirmedSats) : (raw.summary && raw.summary.untrustedPending != null ? fromSummary(raw.summary.untrustedPending) : undefined)
    };
    setCachedBalance(walletId, result);
    return result;
  }
  return raw;
}

/**
 * Fetch wallet summary with cache fallback. Uses cached balance when fetch fails.
 * Keys never leave the browser; only xpub is sent for watch-only balance.
 * @param {object} settings - Upstream settings
 * @param {object} wallet - Wallet context (walletId, xpub from getWalletContextFromIdentity)
 * @param {object} [options] - { maxCacheAgeMs: number } - use 0 to skip cache
 * @returns {Promise<object>} Summary with balanceSats, confirmedSats, unconfirmedSats; uses cache on fetch failure
 */
async function fetchWalletSummaryWithCache (settings = {}, wallet = {}, options = {}) {
  const walletId = String(wallet.walletId || '').trim();
  const bypassCache = !!(options.bypassCache || options.maxCacheAgeMs === 0);
  const maxCacheAgeMs = bypassCache ? 0 : (options.maxCacheAgeMs != null ? Number(options.maxCacheAgeMs) : BALANCE_CACHE_MAX_AGE_MS);

  try {
    const summary = await fetchWalletSummary(settings, wallet, options);
    if (summary && (summary.balanceSats != null || summary.balance != null)) {
      return summary;
    }
  } catch (e) {
    // Fall through to cache
  }

  const cached = getCachedBalance(walletId, Infinity);
  if (cached) {
    return {
      balanceSats: cached.balanceSats,
      confirmedSats: cached.confirmedSats,
      unconfirmedSats: cached.unconfirmedSats,
      _fromCache: true,
      _cachedAt: cached.fetchedAt
    };
  }
  return {};
}

/**
 * Look up balance for a single address. Server does not hold keys; uses scantxoutset.
 * Works for any on-chain address. Requires Hub Bitcoin service with txindex.
 */
async function fetchAddressBalance (settings = {}, address = '') {
  const baseUrl = normalizeAddressesBaseUrl(settings.paymentsBaseUrl || settings.explorerBaseUrl);
  if (!baseUrl) return null;

  const raw = String(address || '').trim();
  if (!raw) return null;

  const path = `/${encodeURIComponent(raw)}/balance`;
  const result = await tryRequests(baseUrl, [{ path }], settings.apiToken);
  return pickObject(result ? result.data : {}, ['address', 'balance', 'balanceSats', 'confirmedSats', 'unconfirmedSats', 'keysHeldByServer']);
}

async function fetchReceiveAddress (settings = {}, wallet = {}, options = {}) {
  const local = deriveAndStoreReceiveAddress(wallet, {
    network: options.network,
    identity: options.identity
  });
  if (local && local.currentAddress) return local.currentAddress;

  const baseUrl = normalizeAddressesBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return '';

  const walletId = encodeURIComponent(wallet.walletId || '');
  if (!walletId) return '';
  const result = await tryRequests(baseUrl, [
    { path: `?walletId=${walletId}` }
  ], settings.apiToken);

  const body = pickObject(result ? result.data : {}, ['address', 'data', 'result']);
  if (typeof body === 'string') return body;
  if (body.address) return String(body.address);
  if (body.bech32) return String(body.bech32);
  return '';
}

async function fetchUTXOs (settings = {}, wallet = {}, options = {}) {
  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return [];

  const walletId = encodeURIComponent(wallet.walletId || '');
  if (!walletId) return [];

  const params = new URLSearchParams();
  if (wallet.xpub) params.set('xpub', wallet.xpub);
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }
  const qs = params.toString();
  const path = qs ? `/${walletId}/utxos?${qs}` : `/${walletId}/utxos`;

  const result = await tryRequests(baseUrl, [
    { path }
  ], settings.apiToken);

  return pickArray(result ? result.data : {}, ['utxos', 'items', 'results', 'data']);
}

async function fetchWalletTransactions (settings = {}, wallet = {}, options = {}) {
  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return [];

  const walletId = String(wallet.walletId || '').trim();
  if (!walletId) return [];

  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const params = new URLSearchParams();
  if (wallet.xpub) params.set('xpub', wallet.xpub);
  params.set('limit', String(limit));
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }

  const path = `/${encodeURIComponent(walletId)}/transactions?${params.toString()}`;
  const result = await tryRequests(baseUrl, [{ path }], settings.apiToken);
  return pickArray(result ? result.data : {}, ['transactions', 'items', 'results', 'data']);
}

async function requestFaucet (settings = {}, options = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) throw new Error('Explorer/bitcoin API base URL is not configured.');

  const payload = {
    address: String(options.address || '').trim(),
    amountSats: Number(options.amountSats || 10000)
  };
  if (!payload.address) throw new Error('Destination address is required for faucet.');

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/faucet', body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['status', 'network', 'source', 'faucet', 'error']);
}

async function sendPayment (settings = {}, wallet = {}, payment = {}) {
  const baseUrl = normalizePaymentsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) throw new Error('Payments API base URL is not configured.');

  const adminToken = String(payment.adminToken || payment.token || '').trim();
  if (!adminToken) {
    throw new Error('Admin token is required: POST /services/bitcoin/payments spends from this hub\'s bitcoind wallet and broadcasts a real transaction (identity xpub selects wallet id for the request).');
  }

  const payload = {
    walletId: wallet.walletId,
    xpub: wallet.xpub,
    to: payment.to,
    amountSats: Number(payment.amountSats || 0),
    memo: payment.memo || '',
    adminToken
  };
  const walletId = String(wallet.walletId || '').trim();
  if (!walletId) throw new Error('Wallet ID is required for payment requests.');

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '', body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['payment', 'result', 'data']);
}

/**
 * Spend from the Hub node's bitcoind wallet (regtest/ops). Requires setup admin token.
 * @param {object} settings - loadUpstreamSettings(); uses explorerBaseUrl → POST /services/bitcoin
 * @param {{ to: string, amountSats: number, memo?: string }} payment
 * @param {string} adminToken - fabric.hub.adminToken
 */
async function sendBridgePayment (settings = {}, payment = {}, adminToken = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!isBitcoinServiceEndpoint(baseUrl)) {
    throw new Error('Hub Bitcoin RPC base (/services/bitcoin) is required for bridge payments.');
  }
  const token = String(adminToken || '').trim();
  if (!token) throw new Error('Admin token is required to pay from the Hub wallet.');

  const to = String(payment.to || '').trim();
  const amountSats = Math.round(Number(payment.amountSats || 0));
  if (!to) throw new Error('Destination address is required.');
  if (!Number.isFinite(amountSats) || amountSats <= 0) throw new Error('amountSats must be a positive integer.');

  return callBitcoinServiceMethod(baseUrl, 'sendpayment', {
    to,
    amountSats,
    memo: String(payment.memo || ''),
    adminToken: token
  }, settings.apiToken);
}

/**
 * Whether a tx pays at least amountSats to address (L1 proof).
 * GET `.../transactions/:txid?address=&amountSats=` (same transaction resource; query selects payment-proof response).
 * JSON-RPC `verifyl1payment` on POST /services/bitcoin is an alternate for non-HTTP clients.
 */
async function verifyL1Payment (settings = {}, proof = {}) {
  const txid = String(proof.txid || '').trim();
  const address = String(proof.address || proof.to || '').trim();
  const amountSats = Number(proof.amountSats || 0);
  if (!txid) throw new Error('Transaction id (txid) is required.');
  if (!address) throw new Error('Destination address is required.');
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error('amountSats must be a positive integer.');
  }

  const qs = new URLSearchParams({
    address,
    amountSats: String(Math.round(amountSats))
  });
  const path = `/transactions/${encodeURIComponent(txid)}?${qs.toString()}`;

  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) throw new Error('Bitcoin API base URL is not configured.');
  const root = normalizeBaseUrl(baseUrl);
  const data = await requestJSON(`${root}${path}`, {
    method: 'GET',
    apiToken: settings.apiToken
  });
  return data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'verified')
    ? data
    : { verified: false, ...data };
}

async function fetchPayments (settings = {}, wallet = {}, options = {}) {
  const baseUrl = normalizePaymentsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return [];
  const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
  const walletId = encodeURIComponent(wallet.walletId || '');
  const result = await tryRequests(baseUrl, [
    { path: `?walletId=${walletId}&limit=${limit}` }
  ], settings.apiToken);
  return pickArray(result ? result.data : {}, ['payments', 'items', 'results', 'data']);
}

async function fetchCrowdfundingCampaigns (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const data = await requestJSON(`${baseUrl}/crowdfunding/campaigns`, { method: 'GET' });
  return pickArray(data, ['campaigns']);
}

async function createCrowdfundingCampaign (settings = {}, body = {}, adminToken = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const token = String(adminToken || '').trim();
  if (!token) throw new Error('Admin token is required to create a campaign.');
  return requestJSON(`${baseUrl}/crowdfunding/campaigns`, {
    method: 'POST',
    body,
    apiToken: token
  });
}

async function fetchCrowdfundingAcpDonationPsbt (settings = {}, campaignId = '', amountSats = 0) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  const amt = Math.round(Number(amountSats));
  const q = Number.isFinite(amt) && amt > 0 ? `?amountSats=${encodeURIComponent(String(amt))}` : '';
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}/acp-donation-psbt${q}`, { method: 'GET' });
}

async function fetchCrowdfundingCampaign (settings = {}, campaignId = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  if (!id) throw new Error('campaignId is required');
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}`, { method: 'GET' });
}

async function fetchCrowdfundingPayoutPsbt (settings = {}, campaignId = '', opts = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  const dest = String((opts && opts.destination) || (opts && opts.to) || '').trim();
  const feeSats = Math.max(1, Math.round(Number(opts && opts.feeSats != null ? opts.feeSats : 1000)));
  if (!id) throw new Error('campaignId is required');
  if (!dest) throw new Error('Payout destination address is required.');
  const q = `?destination=${encodeURIComponent(dest)}&feeSats=${encodeURIComponent(String(feeSats))}`;
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}/payout-psbt${q}`, { method: 'GET' });
}

async function postCrowdfundingPayoutSignArbiter (settings = {}, campaignId = '', psbtBase64 = '', adminToken = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  const token = String(adminToken || '').trim();
  if (!id) throw new Error('campaignId is required');
  if (!token) throw new Error('Admin token required for arbiter co-sign.');
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}/payout-sign-arbiter`, {
    method: 'POST',
    body: { psbtBase64: String(psbtBase64 || '').trim() },
    apiToken: token
  });
}

async function postCrowdfundingPayoutBroadcast (settings = {}, campaignId = '', psbtBase64 = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  if (!id) throw new Error('campaignId is required');
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}/payout-broadcast`, {
    method: 'POST',
    body: { psbtBase64: String(psbtBase64 || '').trim() }
  });
}

/**
 * Admin: after CLTV height, build arbiter-signed refund tx (vault → destination).
 * Body: destinationAddress, fundedTxid, feeSats?, vout? (optional if unambiguous).
 */
async function postCrowdfundingRefundPrepare (settings = {}, campaignId = '', body = {}, adminToken = '') {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const id = encodeURIComponent(String(campaignId || '').trim());
  const token = String(adminToken || '').trim();
  if (!id) throw new Error('campaignId is required');
  if (!token) throw new Error('Admin token required for refund prepare.');
  const b = body && typeof body === 'object' ? body : {};
  return requestJSON(`${baseUrl}/crowdfunding/campaigns/${id}/refund-prepare`, {
    method: 'POST',
    body: {
      destinationAddress: String(b.destinationAddress || b.toAddress || '').trim(),
      fundedTxid: String(b.fundedTxid || b.txid || '').trim(),
      feeSats: b.feeSats != null ? Math.max(1, Math.round(Number(b.feeSats))) : undefined,
      vout: b.vout != null && b.vout !== '' ? Number(b.vout) : undefined
    },
    apiToken: token
  });
}

/**
 * Compressed secp256k1 pubkey hex for m/44'/0'/0'/0/0 (BIP44 payment account external #0) — Taproot crowdfund beneficiary.
 * Uses the same account + external path as {@link getSpendWalletContext} / Payments. With a master xprv on the identity,
 * derives m/44'/0'/0'/0/0; when locked, uses the persisted spend-account xpub from wallet context if present.
 * Empty string if unavailable.
 */
function getCrowdfundingBeneficiaryPubkeyHex (identity = {}) {
  const w = getSpendWalletContext(identity);
  const masterXprv = String(identity && identity.xprv || '').trim();
  const masterXpub = String(identity && identity.xpub || '').trim();

  let accountXprv = '';
  let accountXpub = '';

  if (masterXprv) {
    try {
      const d = deriveFabricBitcoinAccountKeys(masterXprv, masterXpub, BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX);
      accountXprv = String(d.xprv || '').trim();
      accountXpub = String(d.xpub || '').trim();
    } catch (e) {
      // Some runtime identity snapshots provide non-master xprv material.
      // Fall back to watch-only account xpub derivation so "Fill from wallet" still works.
      accountXpub = String(w.xpub || masterXpub || '').trim();
      if (!accountXpub) return '';
    }
  } else {
    // Crowdfund "beneficiary pubkey" should still derive from a logged-in identity xpub,
    // even when wallet context intentionally suppresses watch-only API descriptors.
    accountXpub = String(w.xpub || masterXpub || '').trim();
    if (!accountXpub) return '';
  }

  try {
    const net = getNetworkFromXpub(accountXpub || accountXprv);
    const bip32Inst = new BIP32(ecc);
    const root = accountXprv
      ? bip32Inst.fromBase58(accountXprv, net)
      : bip32Inst.fromBase58(accountXpub, net);
    const child = root.derive(0).derive(0);
    return Buffer.from(child.publicKey).toString('hex');
  } catch (e) {
    return '';
  }
}

/**
 * 32-byte secp256k1 secret for m/44'/0'/0'/0/0 — same leaf as {@link getCrowdfundingBeneficiaryPubkeyHex}.
 * Only when identity master xprv can derive the payment account; null if locked / watch-only.
 * @param {object} identity
 * @returns {Buffer|null}
 */
function getCrowdfundingBeneficiaryPrivateKey32 (identity = {}) {
  const masterXprv = String(identity && identity.xprv || '').trim();
  const masterXpub = String(identity && identity.xpub || '').trim();
  if (!masterXprv) return null;
  let accountXprv = '';
  let accountXpub = '';
  try {
    const d = deriveFabricBitcoinAccountKeys(masterXprv, masterXpub, BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX);
    accountXprv = String(d.xprv || '').trim();
    accountXpub = String(d.xpub || '').trim();
  } catch (e) {
    return null;
  }
  if (!accountXprv) return null;
  try {
    const net = getNetworkFromXpub(accountXpub || accountXprv);
    const bip32Inst = new BIP32(ecc);
    const root = bip32Inst.fromBase58(accountXprv, net);
    const child = root.derive(0).derive(0);
    if (!child.privateKey) return null;
    return Buffer.from(child.privateKey);
  } catch (e) {
    return null;
  }
}

/**
 * Default on-chain payout destination: BIP44 account 0 external address index 0 (wpkh), matching beneficiary pubkey path.
 * @param {object} identity
 * @param {string} networkName - Hub network name (regtest, testnet, mainnet, …)
 * @returns {string} address or ''
 */
function getCrowdfundingBeneficiaryPayoutAddress (identity = {}, networkName = '') {
  const w = getSpendWalletContext(identity);
  const xpub = String(w.xpub || '').trim();
  if (!xpub) return '';
  const derived = deriveReceiveAddressFromXpub(xpub, 0, networkName);
  return derived && derived.address ? String(derived.address) : '';
}

/**
 * Sign all inputs of a Taproot crowdfund payout PSBT with the beneficiary key (browser-only).
 * @param {string} psbtBase64
 * @param {object} identity
 * @param {string} networkName
 * @returns {string} psbtBase64
 */
function signCrowdfundingPayoutPsbtBeneficiary (psbtBase64 = '', identity = {}, networkName = 'regtest') {
  const b64 = String(psbtBase64 || '').trim();
  if (!b64) throw new Error('PSBT base64 is required.');
  const priv = getCrowdfundingBeneficiaryPrivateKey32(identity);
  if (!priv) {
    throw new Error('Unlock identity so the BIP44 payment key (m/44\'/0\'/0\'/0/0) is available to sign.');
  }
  const bitcoin = require('bitcoinjs-lib');
  const crowdfundingTaproot = require('./crowdfundingTaproot');
  const network = crowdfundingTaproot.networkForFabricName(networkName);
  let psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(b64, { network });
  } catch (e) {
    throw new Error((e && e.message) ? e.message : 'Invalid PSBT.');
  }
  if (psbt.inputCount < 1) throw new Error('PSBT has no inputs.');
  crowdfundingTaproot.signAllInputsWithKey(psbt, priv);
  return psbt.toBase64();
}

/**
 * BIP21 URI for on-chain payment to a crowdfund vault (`bitcoin:…?amount=`).
 * @param {string} address
 * @param {number} [amountBtc] - optional; omit or non-positive for address-only URI
 * @returns {string}
 */
function buildCrowdfundFunderBitcoinUri (address, amountBtc) {
  const addr = String(address || '').trim();
  if (!addr) return '';
  const n = Number(amountBtc);
  if (!Number.isFinite(n) || n <= 0) return `bitcoin:${addr}`;
  const amt = n.toFixed(8).replace(/\.?0+$/, '') || '0';
  return `bitcoin:${addr}?amount=${amt}`;
}

/**
 * In-app Payments path with `payTo` / `payAmountSats` query (see `BitcoinPaymentsHomeRoute`).
 * @param {Object} opts
 * @param {string} [opts.payTo]
 * @param {string} [opts.address] - alias for payTo
 * @param {number} [opts.amountSats]
 */
function buildCrowdfundPaymentsDeepLink (opts = {}) {
  const payTo = String(opts.payTo || opts.address || '').trim();
  const amountSats = Math.round(Number(opts.amountSats != null ? opts.amountSats : opts.payAmountSats || 0));
  if (!payTo) return '/services/bitcoin/payments';
  const qs = new URLSearchParams();
  qs.set('payTo', payTo);
  if (Number.isFinite(amountSats) && amountSats > 0) qs.set('payAmountSats', String(amountSats));
  return `/services/bitcoin/payments?${qs.toString()}`;
}

/**
 * Resolved GET URL for campaign JSON (`…/crowdfunding/campaigns/:id`).
 * @param {Object} settings
 * @param {string} campaignId
 * @returns {string}
 */
function crowdfundCampaignApiUrl (settings = {}, campaignId = '') {
  const id = String(campaignId || '').trim();
  if (!id) return '';
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return '';
  const root = normalizeBaseUrl(baseUrl);
  return `${root}/crowdfunding/campaigns/${encodeURIComponent(id)}`;
}

async function fetchPayjoinCapabilities (settings = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  if (!baseUrl) return { available: false };
  const result = await tryRequests(baseUrl, [
    { path: '' }
  ], settings.apiToken);
  return pickObject(result ? result.data : {}, ['capabilities', 'result', 'data']);
}

async function createPayjoinDeposit (settings = {}, wallet = {}, options = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  if (!baseUrl) throw new Error('Payjoin API base URL is not configured.');

  const payload = {
    walletId: wallet.walletId,
    xpub: wallet.xpub,
    address: options.address || wallet.address || '',
    amountSats: Number(options.amountSats || 0),
    label: options.label || '',
    memo: options.memo || '',
    expiresInSeconds: Number(options.expiresInSeconds || 0) || undefined
  };

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/sessions', body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['session', 'result', 'data']);
}

async function fetchPayjoinSessions (settings = {}, options = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  if (!baseUrl) return [];

  const limit = Math.max(1, Math.min(200, Number(options.limit || 25)));
  const includeExpired = options.includeExpired !== false;
  const result = await tryRequests(baseUrl, [
    { path: `/sessions?limit=${limit}&includeExpired=${includeExpired ? 'true' : 'false'}` }
  ], settings.apiToken);
  return pickArray(result ? result.data : {}, ['sessions', 'items', 'results', 'data']);
}

async function fetchPayjoinSession (settings = {}, sessionId = '') {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  const id = encodeURIComponent(String(sessionId || '').trim());
  if (!baseUrl || !id) return {};
  const result = await tryRequests(baseUrl, [
    { path: `/sessions/${id}` }
  ], settings.apiToken);
  return pickObject(result ? result.data : {}, ['session', 'result', 'data']);
}

async function submitPayjoinProposal (settings = {}, sessionId = '', proposal = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  const id = encodeURIComponent(String(sessionId || '').trim());
  if (!baseUrl) throw new Error('Payjoin API base URL is not configured.');
  if (!id) throw new Error('Payjoin session ID is required.');

  const payload = {
    psbt: proposal.psbt || '',
    txhex: proposal.txhex || ''
  };

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: `/sessions/${id}/proposals`, body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['result', 'session', 'data']);
}

/**
 * POST .../sessions/:id/acp-hub-boost — Hub appends + signs a wallet input on an ANYONECANPAY|ALL payer PSBT.
 * @param {string} adminToken - setup admin token (Bearer)
 * @param {{ psbt?: string }} [options] - optional PSBT (else server uses latest proposal on session)
 */
async function applyPayjoinAcpHubBoost (settings = {}, sessionId = '', adminToken = '', options = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  const id = encodeURIComponent(String(sessionId || '').trim());
  if (!baseUrl) throw new Error('Payjoin API base URL is not configured.');
  if (!id) throw new Error('Payjoin session ID is required.');
  const token = String(adminToken || '').trim();
  if (!token) throw new Error('Admin token is required for ACP Hub boost.');
  const root = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
  const body = {};
  if (options && options.psbt) body.psbt = String(options.psbt);
  const data = await requestJSON(`${root}/sessions/${id}/acp-hub-boost`, {
    method: 'POST',
    body: Object.keys(body).length ? body : undefined,
    apiToken: token
  });
  return data && typeof data === 'object' ? data : {};
}

async function generateBlock (settings = {}, options = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) throw new Error('Explorer API base URL is not configured.');

  const payload = {
    count: Number(options.count || 1)
  };
  if (options.address) payload.address = String(options.address);

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/blocks', body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['result', 'data']);
}

async function fetchBitcoinPeers (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return [];
  try {
    const result = await tryRequests(baseUrl, [
      { path: '/peers' }
    ], settings.apiToken);
    const data = result && result.data;
    if (Array.isArray(data)) return data;
  } catch (e) {}
  return [];
}

async function fetchBitcoinNetworkSummary (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return {};
  try {
    const result = await tryRequests(baseUrl, [
      { path: '/network' }
    ], settings.apiToken);
    const data = result && result.data;
    if (data && typeof data === 'object') return data;
  } catch (e) {}
  return {};
}

async function broadcastRawTransaction (settings = {}, hex = '', opts = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) throw new Error('Explorer API base URL is not configured.');
  const raw = String(hex || '').replace(/\s+/g, '');
  if (!raw) throw new Error('Raw transaction hex is required.');
  const adminToken = String(opts.adminToken || '').trim();
  const root = normalizeBaseUrl(baseUrl);
  const url = `${root}/broadcast`;
  const headers = makeHeaders(settings.apiToken, 'POST');
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hex: raw })
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!response.ok) {
    const msg = (data && (data.message || data.error)) || `${response.status} ${response.statusText}`;
    throw new Error(String(msg));
  }
  return data && typeof data === 'object' ? data : {};
}

async function createLightningInvoice (settings = {}, wallet = {}, invoice = {}) {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) throw new Error('Lightning API base URL is not configured.');

  const payload = {
    walletId: wallet.walletId,
    amountSats: Number(invoice.amountSats || 0),
    memo: invoice.memo || ''
  };

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/invoices', body: payload }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['invoice', 'result', 'data']);
}

async function payLightningInvoice (settings = {}, wallet = {}, invoice = '') {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) throw new Error('Lightning API base URL is not configured.');
  if (!invoice) throw new Error('Invoice is required.');

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/payments', body: { walletId: wallet.walletId, invoice } }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['payment', 'result', 'data']);
}

async function decodeLightningInvoice (settings = {}, invoice = '') {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) throw new Error('Lightning API base URL is not configured.');
  if (!invoice) throw new Error('Invoice is required.');

  const result = await tryRequests(baseUrl, [
    { method: 'POST', path: '/decodes', body: { invoice } }
  ], settings.apiToken);

  return pickObject(result ? result.data : {}, ['decoded', 'result', 'data']);
}

async function fetchLightningStatus (settings = {}) {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) return { available: false, status: 'UNAVAILABLE' };
  const result = await tryRequests(baseUrl, [
    { path: '' }
  ], settings.apiToken);
  // Return full response so node (depositAddress, balanceSats, balanceUnconfirmedSats) is preserved
  const raw = result && result.data && typeof result.data === 'object' ? result.data : {};
  return Object.keys(raw).length ? raw : { available: false, status: 'UNAVAILABLE' };
}

async function fetchLightningChannels (settings = {}) {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) return { channels: [], outputs: [] };
  const result = await tryRequests(baseUrl, [
    { path: '/channels' }
  ], settings.apiToken);
  const data = result ? result.data : {};
  return {
    channels: Array.isArray(data.channels) ? data.channels : [],
    outputs: Array.isArray(data.outputs) ? data.outputs : []
  };
}

async function createLightningChannel (settings = {}, channel = {}) {
  const baseUrl = normalizeLightningBaseUrl(settings.lightningBaseUrl || '/services/lightning');
  if (!baseUrl) throw new Error('Lightning API base URL is not configured.');
  const remote = String(channel.remote || channel.connectString || '').trim();
  const peerId = String(channel.peerId || channel.peer_id || '').trim();
  if (!remote && !peerId) throw new Error('remote (id@ip:port) or peerId is required');
  const payload = {
    peerId: peerId || undefined,
    remote: remote || undefined,
    amountSats: Number(channel.amountSats || channel.amount_sats || 0),
    pushMsat: channel.pushMsat != null ? Number(channel.pushMsat) : (channel.push_msat != null ? Number(channel.push_msat) : undefined)
  };
  const url = `${baseUrl}/channels`;
  const headers = makeHeaders(settings.apiToken || '', 'POST');
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  let data = {};
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : {};
  } catch (_) {}
  if (!response.ok) {
    return (data && typeof data === 'object' && (data.error || data.detail)) ? data : { error: 'Channel creation failed', detail: response.statusText };
  }
  return pickObject(data, ['channel', 'result', 'data']) || data;
}

module.exports = {
  loadUpstreamSettings,
  saveUpstreamSettings,
  defaultPayjoinPreferences,
  loadPayjoinPreferences,
  savePayjoinPreferences,
  deriveWalletIdFromXpub,
  loadSessionBip44Account,
  saveSessionBip44Account,
  loadPersistedDefaultBip44Raw,
  savePersistedDefaultBip44Account,
  hasBip44SessionOverride,
  BITCOIN_PAYMENTS_BIP44_ACCOUNT_INDEX,
  BITCOIN_WALLET_BRANCH_CHANGED,
  deriveFabricBitcoinAccountKeys,
  loadSpendXpubWatchForIdentity,
  saveSpendXpubWatchForIdentity,
  clearSpendXpubWatch,
  getWalletContextFromIdentity,
  getSpendWalletContext,
  getNextReceiveWalletContext,
  deriveAndStoreReceiveAddress,
  reserveNextReceiveAddress,
  getCachedBalance,
  setCachedBalance,
  clearBalanceCache,
  fetchExplorerData,
  fetchBitcoinStatus,
  fetchBlockByHash,
  fetchTransactionByHash,
  fetchTransactionHex,
  fetchWalletSummary,
  fetchWalletSummaryWithCache,
  fetchAddressBalance,
  fetchReceiveAddress,
  fetchUTXOs,
  fetchWalletTransactions,
  fetchPayments,
  fetchCrowdfundingCampaigns,
  fetchCrowdfundingCampaign,
  createCrowdfundingCampaign,
  fetchCrowdfundingAcpDonationPsbt,
  fetchCrowdfundingPayoutPsbt,
  postCrowdfundingPayoutSignArbiter,
  postCrowdfundingPayoutBroadcast,
  postCrowdfundingRefundPrepare,
  getCrowdfundingBeneficiaryPubkeyHex,
  getCrowdfundingBeneficiaryPrivateKey32,
  getCrowdfundingBeneficiaryPayoutAddress,
  signCrowdfundingPayoutPsbtBeneficiary,
  buildCrowdfundFunderBitcoinUri,
  buildCrowdfundPaymentsDeepLink,
  crowdfundCampaignApiUrl,
  fetchPayjoinCapabilities,
  createPayjoinDeposit,
  fetchPayjoinSessions,
  fetchPayjoinSession,
  submitPayjoinProposal,
  applyPayjoinAcpHubBoost,
  generateBlock,
  fetchBitcoinPeers,
  fetchBitcoinNetworkSummary,
  broadcastRawTransaction,
  requestFaucet,
  sendPayment,
  sendBridgePayment,
  verifyL1Payment,
  createLightningInvoice,
  createLightningChannel,
  fetchLightningStatus,
  fetchLightningChannels,
  payLightningInvoice,
  decodeLightningInvoice
};
