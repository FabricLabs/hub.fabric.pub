'use strict';

const crypto = require('crypto');
const BIP32 = require('bip32').default;
const ecc = require('@fabric/core/types/ecc');
const { payments } = require('bitcoinjs-lib');
const { encodeBitcoinUri } = require('@fabric/core/functions/bip21');
const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');

const SETTINGS_KEY = 'fabric.bitcoin.upstream';
const PAYJOIN_PREFS_KEY = 'fabric.bitcoin.payjoinPreferences';
const LOCAL_WALLET_KEY = 'fabric.bitcoin.wallets';
const BALANCE_CACHE_KEY = 'fabric.bitcoin.balanceCache';
const BALANCE_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes - use cache if fetch fails and cache is newer
const STANDARD_WATCH_GAP = 20;
const { safeIdentityErr } = require('./fabricSafeLog');
const { walletSigningKeys } = require('./hubAccountVault');

function normalizeBaseUrl (value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

/**
 * Reject cross-origin absolute URLs for in-app Hub API fetches (Lightning channel create, etc.).
 * Explorer and third-party block explorer URLs are handled in separate code paths.
 */
function assertHubRelativeOrSameOriginRequestUrl (url) {
  const s = String(url || '');
  if (!s) throw new Error('URL required');
  if (s.startsWith('//')) throw new Error('Refusing protocol-relative URL');
  if (!/^https?:\/\//i.test(s)) return s;
  if (typeof window === 'undefined' || !window.location) return s;
  const p = new URL(s, window.location.href);
  if (p.origin !== window.location.origin) {
    throw new Error('This request must be same-origin or a relative path');
  }
  return s;
}

function loadUpstreamSettings () {
  const defaults = {
    explorerBaseUrl: '/services/bitcoin',
    paymentsBaseUrl: '/payments',
    lightningBaseUrl: '/services/lightning',
    payjoinBaseUrl: '/services/payjoin',
    apiToken: ''
  };

  try {
    if (typeof window === 'undefined') return defaults;
    const parsed = readStorageJSON(SETTINGS_KEY, null);
    if (!parsed || typeof parsed !== 'object') return defaults;
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
    paymentsSend: true,
    /** Default Payjoin deposit address: Hub-built P2TR (operator + beacon federation reserve leaves). BIP77 unchanged. */
    receiveTaprootJoinmarket: true
  };
}

function loadPayjoinPreferences () {
  const d = defaultPayjoinPreferences();
  try {
    if (typeof window === 'undefined') return { ...d };
    const p = readStorageJSON(PAYJOIN_PREFS_KEY, null);
    if (!p) return { ...d };
    if (!p || typeof p !== 'object') return { ...d };
    return { ...d, ...p };
  } catch (e) {
    return { ...d };
  }
}

function savePayjoinPreferences (patch = {}) {
  const next = Object.assign(loadPayjoinPreferences(), patch);
  try {
    if (typeof window !== 'undefined') {
      writeStorageJSON(PAYJOIN_PREFS_KEY, next);
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
    if (typeof window !== 'undefined') {
      writeStorageJSON(SETTINGS_KEY, next);
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

/**
 * Wallet context for Hub Bitcoin APIs: the identity's account wallet only.
 * New addresses (receive and change) come from the SegWit account
 * (`m/84'/B'/n'`, {@link xpub}); the standard account (`m/44'/B'/n'`,
 * {@link standardXpub}) is watched for balance and coins. With the identity
 * unlocked, both account keys are included for signing.
 * @param {object} identity In-memory identity (`wallet`, `masterXprv` when unlocked)
 * @returns {{ walletId: string, fingerprint: string, xpub: string, standardXpub: string, hasPrivateKey: boolean, descriptors: object|null, account: (number|null), network: (string|null), xprv?: string, standardXprv?: string }}
 */
function getSpendWalletContext (identity = {}) {
  const wallet = identity && identity.wallet && typeof identity.wallet === 'object' ? identity.wallet : null;
  const xpub = wallet && wallet.segwit && wallet.segwit.xpub ? String(wallet.segwit.xpub).trim() : '';
  const standardXpub = wallet && wallet.standard && wallet.standard.xpub ? String(wallet.standard.xpub).trim() : '';
  const id = identity && identity.id ? String(identity.id) : '';
  const walletId = xpub
    ? deriveWalletIdFromXpub(xpub)
    : `fabric-${crypto.createHash('sha256').update(id || 'anonymous').digest('hex').slice(0, 16)}`;
  const fingerprint = crypto.createHash('sha256').update(xpub || id || 'anonymous').digest('hex').slice(0, 16);
  const account = identity && identity.fabricAccountIndex != null && identity.fabricAccountIndex !== ''
    ? Math.floor(Number(identity.fabricAccountIndex))
    : null;
  const out = {
    walletId,
    fingerprint,
    xpub,
    standardXpub,
    hasPrivateKey: false,
    descriptors: wallet && wallet.descriptors ? wallet.descriptors : null,
    account: Number.isFinite(account) ? account : null,
    network: identity && identity.network ? String(identity.network) : null
  };
  if (xpub) {
    let keys = null;
    try {
      keys = walletSigningKeys(identity);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[bitcoinClient] wallet key derivation failed:', safeIdentityErr(e));
      }
    }
    if (keys && keys.segwit.xpub === xpub) {
      out.xprv = keys.segwit.xprv;
      out.standardXprv = keys.standard.xprv;
      out.hasPrivateKey = true;
    }
  }
  return out;
}

/** Same account as spends; new external receive addresses come from its SegWit chain. */
function getNextReceiveWalletContext (identity = {}) {
  return getSpendWalletContext(identity);
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
    if (typeof window === 'undefined') return {};
    const parsed = readStorageJSON(BALANCE_CACHE_KEY, {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function saveBalanceCache (store = {}) {
  try {
    if (typeof window !== 'undefined') {
      writeStorageJSON(BALANCE_CACHE_KEY, store || {});
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
    if (typeof window === 'undefined') return {};
    const parsed = readStorageJSON(LOCAL_WALLET_KEY, {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    return {};
  }
}

function saveLocalWalletStore (store = {}) {
  try {
    if (typeof window !== 'undefined') {
      writeStorageJSON(LOCAL_WALLET_KEY, store || {});
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
 * @param {string} [script] `wpkh` (default) or `pkh`
 */
function deriveAddressFromXpub (xpub = '', chain = 0, index = 0, networkName = '', script = 'wpkh') {
  if (!xpub) return null;
  const bip32 = new BIP32(ecc);
  const decodeNetwork = getNetworkFromXpub(xpub);
  const account = bip32.fromBase58(String(xpub), decodeNetwork);
  const child = account.derive(Number(chain)).derive(Number(index));
  const pubkey = child.publicKey;
  const addressNetwork = (networkName && getNetworkForBitcoinJs(networkName)) || decodeNetwork;
  const payment = script === 'pkh'
    ? payments.p2pkh({ pubkey, network: addressNetwork })
    : payments.p2wpkh({ pubkey, network: addressNetwork });
  if (!payment || !payment.address) return null;
  return payment.address;
}

/**
 * Derive watch addresses for mempool scan: receive (0/*) and change (1/*) of
 * the SegWit account, plus pkh and wpkh of the standard account (gap 20).
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
  const standardXpub = String(wallet.standardXpub || '').trim();
  if (standardXpub) {
    for (const script of ['pkh', 'wpkh']) {
      for (const chain of [0, 1]) {
        for (let i = 0; i < STANDARD_WATCH_GAP; i++) {
          const a = deriveAddressFromXpub(standardXpub, chain, i, networkName, script);
          if (a) addrs.push(a);
        }
      }
    }
  }
  return addrs;
}

function deriveAndStoreReceiveAddress (wallet = {}, options = {}) {
  const networkName = options && options.network;
  const xpub = String(wallet.xpub || '').trim();
  const legacyKey = String(wallet.walletId || wallet.id || '').trim();
  if (!legacyKey || !xpub) return null;

  const storageKey = legacyKey;
  const store = loadLocalWalletStore();
  const current = (store[storageKey] && typeof store[storageKey] === 'object') ? store[storageKey] : {};
  const addresses = Array.isArray(current.receiveAddresses) ? current.receiveAddresses : [];

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
  const networkName = options && options.network;
  const xpub = String(wallet.xpub || '').trim();
  const legacyKey = String(wallet.walletId || wallet.id || '').trim();
  if (!legacyKey || !xpub) return null;

  const storageKey = legacyKey;
  const store = loadLocalWalletStore();
  const current = (store[storageKey] && typeof store[storageKey] === 'object') ? store[storageKey] : {
    id: legacyKey,
    xpub,
    currentIndex: -1,
    receiveAddresses: []
  };

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
  if (normalized === '/payments') return '/services/bitcoin/wallets';
  if (/\/services\/bitcoin$/i.test(normalized)) return `${normalized}/wallets`;
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return normalized.replace(/\/payments$/i, '/wallets');
  if (/\/wallet$/i.test(normalized)) return normalized.replace(/\/wallet$/i, '/wallets');
  return normalized;
}

/** Canonical watch-only xpub HTTP API (`GET …/xpub`, `/xpub/utxos`, `/xpub/transactions`). */
function normalizeXpubWatchBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/services/bitcoin/xpub';
  if (normalized === '/payments') return '/services/bitcoin/xpub';
  if (/\/services\/bitcoin$/i.test(normalized)) return `${normalized}/xpub`;
  if (/\/services\/bitcoin\/wallets$/i.test(normalized)) return normalized.replace(/\/wallets$/i, '/xpub');
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return normalized.replace(/\/payments$/i, '/xpub');
  if (/\/wallet$/i.test(normalized)) return normalized.replace(/\/wallet$/i, '/xpub');
  return normalized;
}

function normalizePaymentsBaseUrl (value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '/payments';
  if (normalized === '/services/bitcoin/payments') return '/payments';
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return '/payments';
  if (/\/services\/bitcoin$/i.test(normalized)) return '/payments';
  if (/\/services\/bitcoin\/wallets$/i.test(normalized)) return '/payments';
  if (normalized === '/payments') return '/payments';
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
  if (normalized === '/services/payjoin') return '/services/payjoin';
  if (/\/services\/payjoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/payments\/payjoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/services\/bitcoin\/payjoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/services\/bitcoin$/i.test(normalized)) return '/services/payjoin';
  if (/\/services\/bitcoin\/payments$/i.test(normalized)) return '/services/payjoin';
  if (normalized === '/payments') return '/services/payjoin';
  return normalized;
}

function isBitcoinServiceEndpoint (baseUrl = '') {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/services\/bitcoin$/i.test(normalized);
}

/**
 * Auth for bitcoinClient HTTP: hub admin token only when the base targets Hub
 * `/services/bitcoin` (relative or absolute). External explorers/payments URLs
 * get `apiToken` only so admin credentials are not leaked off-host.
 * @param {object} [settings]
 * @param {string} [baseUrl]
 * @returns {string}
 */
function resolveBitcoinClientAuthToken (settings = {}, baseUrl = '') {
  const apiToken = String(settings.apiToken || '').trim();
  const hubAdminToken = String(settings.hubAdminToken || '').trim();
  if (!hubAdminToken) return apiToken;
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return apiToken;
  if (/^https?:\/\//i.test(normalized) && !/\/services\/bitcoin(\/|$)/i.test(normalized)) {
    return apiToken;
  }
  return hubAdminToken || apiToken;
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

async function fetchExplorerDataAtBase (settings = {}, wallet = {}, options = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return { blocks: [], transactions: [] };

  if (isBitcoinServiceEndpoint(baseUrl)) {
    const netRaw = options.network != null ? String(options.network) : '';
    const net = netRaw ? netRaw.toLowerCase() : 'regtest';
    const listTxParams = { limit: 10 };
    const adminTok = options.adminToken != null ? String(options.adminToken).trim() : '';
    if (adminTok) {
      listTxParams.adminToken = adminTok;
    } else if (wallet && wallet.xpub) {
      const addrs = deriveWatchAddresses(wallet, net, 25, 25);
      if (addrs.length > 0) listTxParams.addresses = addrs.join(',');
    }
    const rpcTok = resolveBitcoinClientAuthToken(settings, baseUrl);
    const [blocksData, txData] = await Promise.all([
      callBitcoinServiceMethod(baseUrl, 'ListBlocks', { limit: 10 }, rpcTok).catch(() => []),
      callBitcoinServiceMethod(baseUrl, 'ListTransactions', listTxParams, rpcTok).catch(() => [])
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

async function fetchExplorerData (settings = {}, wallet = {}, options = {}) {
  return fetchExplorerDataAtBase(settings, wallet, options);
}

async function fetchBitcoinStatusAtBase (settings = {}) {
  const baseUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  if (!baseUrl) return { available: false, status: 'UNAVAILABLE' };
  const authTok = resolveBitcoinClientAuthToken(settings, baseUrl);
  const result = await tryRequests(baseUrl, [
    { path: '' }
  ], authTok);
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

/**
 * Compact block summaries for a height window (Hub `GET /services/bitcoin/blocks?around=`).
 * Ascending by height. Used by the block-view chain scroller.
 * @param {object} [settings]
 * @param {object} [opts]
 * @param {number} opts.around — center height
 * @param {number} [opts.before=10]
 * @param {number} [opts.after=2]
 * @returns {Promise<object[]>}
 */
async function fetchBlockWindow (settings = {}, opts = {}) {
  const bUrl = resolveBaseUrl(settings.explorerBaseUrl, '/services/bitcoin');
  const around = Math.floor(Number(opts.around));
  if (!bUrl || !Number.isFinite(around) || around < 0) return [];
  const before = opts.before != null ? Math.floor(Number(opts.before)) : 10;
  const after = opts.after != null ? Math.floor(Number(opts.after)) : 2;
  const q = new URLSearchParams();
  q.set('around', String(around));
  if (Number.isFinite(before)) q.set('before', String(before));
  if (Number.isFinite(after)) q.set('after', String(after));

  if (isBitcoinServiceEndpoint(bUrl)) {
    const rpcTok = resolveBitcoinClientAuthToken(settings, bUrl);
    const data = await callBitcoinServiceMethod(bUrl, 'ListBlocks', {
      around,
      ...(Number.isFinite(before) ? { before } : {}),
      ...(Number.isFinite(after) ? { after } : {})
    }, rpcTok).catch(() => null);
    return pickArray(data, ['blocks', 'items', 'results', 'data']);
  }

  const result = await tryRequests(bUrl, [
    { path: `/blocks?${q.toString()}` }
  ], settings.apiToken);
  if (!result) return [];
  return pickArray(result.data, ['blocks', 'items', 'results', 'data']);
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
  const xpub = wallet.xpub ? String(wallet.xpub).trim() : '';
  const walletId = String(wallet.walletId || '').trim();
  if (!xpub && !walletId) return {};

  if (xpub) {
    const baseUrl = normalizeXpubWatchBaseUrl(settings.paymentsBaseUrl);
    if (!baseUrl) return {};
    const params = new URLSearchParams();
    params.set('xpub', xpub);
    if (wallet.standardXpub) params.set('standardXpub', String(wallet.standardXpub).trim());
    const network = options.network != null ? String(options.network) : '';
    if (network) {
      const addrs = deriveWatchAddresses(wallet, network, 25, 25);
      if (addrs.length > 0) params.set('addresses', addrs.join(','));
    }
    const q = params.toString();
    const summary = await tryRequests(baseUrl, [{ path: q ? `?${q}` : '' }], resolveBitcoinClientAuthToken(settings, baseUrl));
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
      setCachedBalance(walletId || `xpub:${xpub.slice(0, 48)}`, result);
      return result;
    }
    return raw;
  }

  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return {};

  const encodedId = encodeURIComponent(walletId);
  const params = new URLSearchParams();
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }

  const path = params.toString() ? `/${encodedId}?${params.toString()}` : `/${encodedId}`;
  const summary = await tryRequests(baseUrl, [
    { path }
  ], resolveBitcoinClientAuthToken(settings, baseUrl));

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
 * @param {object} wallet - Wallet context (walletId, xpub from getSpendWalletContext)
 * @param {object} [options] - { maxCacheAgeMs: number } - use 0 to skip cache
 * @returns {Promise<object>} Summary with balanceSats, confirmedSats, unconfirmedSats; uses cache on fetch failure
 */
async function fetchWalletSummaryWithCache (settings = {}, wallet = {}, options = {}) {
  const walletId = String(wallet.walletId || '').trim();
  const xpub = wallet.xpub ? String(wallet.xpub).trim() : '';
  const cacheKey = walletId || (xpub ? `xpub:${xpub.slice(0, 48)}` : '');
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

  const cached = cacheKey ? getCachedBalance(cacheKey, maxCacheAgeMs) : null;
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
  const local = deriveAndStoreReceiveAddress(wallet, { network: options.network });
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
  const xpub = wallet.xpub ? String(wallet.xpub).trim() : '';
  const walletIdEnc = encodeURIComponent(wallet.walletId || '');

  if (xpub) {
    const baseUrl = normalizeXpubWatchBaseUrl(settings.paymentsBaseUrl);
    if (!baseUrl) return [];
    const params = new URLSearchParams();
    params.set('xpub', xpub);
    if (wallet.standardXpub) params.set('standardXpub', String(wallet.standardXpub).trim());
    const network = options.network != null ? String(options.network) : '';
    if (network) {
      const addrs = deriveWatchAddresses(wallet, network, 25, 25);
      if (addrs.length > 0) params.set('addresses', addrs.join(','));
    }
    const qs = params.toString();
    const path = qs ? `/utxos?${qs}` : '/utxos';
    const result = await tryRequests(baseUrl, [{ path }], resolveBitcoinClientAuthToken(settings, baseUrl));
    return pickArray(result ? result.data : {}, ['utxos', 'items', 'results', 'data']);
  }

  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return [];
  if (!walletIdEnc) return [];

  const params = new URLSearchParams();
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }
  const qs = params.toString();
  const path = qs ? `/${walletIdEnc}/utxos?${qs}` : `/${walletIdEnc}/utxos`;

  const result = await tryRequests(baseUrl, [
    { path }
  ], resolveBitcoinClientAuthToken(settings, baseUrl));

  return pickArray(result ? result.data : {}, ['utxos', 'items', 'results', 'data']);
}

async function fetchWalletTransactions (settings = {}, wallet = {}, options = {}) {
  const xpub = wallet.xpub ? String(wallet.xpub).trim() : '';
  const walletId = String(wallet.walletId || '').trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));

  if (xpub) {
    const baseUrl = normalizeXpubWatchBaseUrl(settings.paymentsBaseUrl);
    if (!baseUrl) return [];
    const authTok = resolveBitcoinClientAuthToken(settings, baseUrl);
    const params = new URLSearchParams();
    params.set('xpub', xpub);
    if (wallet.standardXpub) params.set('standardXpub', String(wallet.standardXpub).trim());
    params.set('limit', String(limit));
    const network = options.network != null ? String(options.network) : '';
    if (network) {
      const addrs = deriveWatchAddresses(wallet, network, 25, 25);
      if (addrs.length > 0) params.set('addresses', addrs.join(','));
    }
    const path = `/transactions?${params.toString()}`;
    const result = await tryRequests(baseUrl, [{ path }], authTok);
    return pickArray(result ? result.data : {}, ['transactions', 'items', 'results', 'data']);
  }

  const baseUrl = normalizeWalletsBaseUrl(settings.paymentsBaseUrl);
  if (!baseUrl) return [];
  if (!walletId) return [];
  const authTok = resolveBitcoinClientAuthToken(settings, baseUrl);

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  const network = options.network != null ? String(options.network) : '';
  if (network && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, network, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }

  const path = `/${encodeURIComponent(walletId)}/transactions?${params.toString()}`;
  const result = await tryRequests(baseUrl, [{ path }], authTok);
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
    throw new Error('Admin token is required: POST /payments (or legacy POST /services/bitcoin/payments) spends from this hub\'s bitcoind wallet and broadcasts a real transaction (identity xpub selects wallet id for the request).');
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
  const params = new URLSearchParams();
  params.set('walletId', wallet.walletId || '');
  params.set('limit', String(limit));
  const netRaw = options.network != null ? String(options.network) : '';
  const net = netRaw ? netRaw.toLowerCase() : 'regtest';
  if (wallet && wallet.xpub) {
    const addrs = deriveWatchAddresses(wallet, net, 25, 25);
    if (addrs.length > 0) params.set('addresses', addrs.join(','));
  }
  const authTok = resolveBitcoinClientAuthToken(settings, baseUrl);
  const result = await tryRequests(baseUrl, [
    { path: `?${params.toString()}` }
  ], authTok);
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
 * Compressed secp256k1 pubkey hex of the wallet's first SegWit receive key
 * (`m/84'/B'/n'/0/0`) — the Taproot crowdfund beneficiary. Locked identities
 * still have the account xpub. Empty string if unavailable.
 */
function getCrowdfundingBeneficiaryPubkeyHex (identity = {}) {
  const w = getSpendWalletContext(identity);
  const xpub = String(w.xpub || '').trim();
  if (!xpub) return '';
  try {
    const root = new BIP32(ecc).fromBase58(xpub, getNetworkFromXpub(xpub));
    return Buffer.from(root.derive(0).derive(0).publicKey).toString('hex');
  } catch (e) {
    return '';
  }
}

/**
 * 32-byte secp256k1 secret for the same leaf as {@link getCrowdfundingBeneficiaryPubkeyHex}.
 * Only while the identity is unlocked; null otherwise.
 * @param {object} identity
 * @returns {Buffer|null}
 */
function getCrowdfundingBeneficiaryPrivateKey32 (identity = {}) {
  const w = getSpendWalletContext(identity);
  const xprv = String(w.xprv || '').trim();
  if (!xprv) return null;
  try {
    const root = new BIP32(ecc).fromBase58(xprv, getNetworkFromXpub(w.xpub));
    const child = root.derive(0).derive(0);
    return child.privateKey ? Buffer.from(child.privateKey) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Default on-chain payout destination: the wallet's first SegWit receive address, matching the beneficiary pubkey.
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
    throw new Error('Unlock your identity so the wallet key (m/84\'/B\'/n\'/0/0) is available to sign.');
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
  try {
    if (!Number.isFinite(n) || n <= 0) return encodeBitcoinUri({ address: addr });
    return encodeBitcoinUri({ address: addr, amount: n });
  } catch (_) {
    return '';
  }
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
  if (!payTo) return '/payments';
  const qs = new URLSearchParams();
  qs.set('payTo', payTo);
  if (Number.isFinite(amountSats) && amountSats > 0) qs.set('payAmountSats', String(amountSats));
  return `/payments?${qs.toString()}`;
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

  const receiveTemplate = String(options.receiveTemplate || '').trim();
  const payload = {
    walletId: wallet.walletId,
    xpub: wallet.xpub,
    address: options.address || wallet.address || '',
    amountSats: Number(options.amountSats || 0),
    label: options.label || '',
    memo: options.memo || '',
    expiresInSeconds: Number(options.expiresInSeconds || 0) || undefined
  };
  if (receiveTemplate) payload.receiveTemplate = receiveTemplate;
  const fed = String(options.federationXOnlyHex || '').trim();
  if (fed) payload.federationXOnlyHex = fed;

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
 * POST .../sessions/:id/contribute — Hub adds and signs one wallet input to a stored payjoin
 * original (BIP78 receiver contribution); the sender then re-signs with SIGHASH_ALL.
 * @param {string} adminToken - setup admin token (Bearer)
 * @param {{ psbt?: string, bip78Params?: Object }} [options] - optional original PSBT (else the session's latest proposal)
 */
async function contributeToPayjoinProposal (settings = {}, sessionId = '', adminToken = '', options = {}) {
  const baseUrl = normalizePayjoinBaseUrl(settings.payjoinBaseUrl || settings.explorerBaseUrl);
  const id = encodeURIComponent(String(sessionId || '').trim());
  if (!baseUrl) throw new Error('Payjoin API base URL is not configured.');
  if (!id) throw new Error('Payjoin session ID is required.');
  const token = String(adminToken || '').trim();
  if (!token) throw new Error('Admin token is required for a Hub payjoin contribution.');
  const root = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
  const body = {};
  if (options && options.psbt) body.psbt = String(options.psbt);
  if (options && options.bip78Params) body.bip78Params = options.bip78Params;
  const data = await requestJSON(`${root}/sessions/${id}/contribute`, {
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
  const url = assertHubRelativeOrSameOriginRequestUrl(`${baseUrl}/channels`);
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
  resolveBitcoinClientAuthToken,
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
  fetchBlockWindow,
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
  encodeBitcoinUri,
  buildCrowdfundFunderBitcoinUri,
  buildCrowdfundPaymentsDeepLink,
  crowdfundCampaignApiUrl,
  fetchPayjoinCapabilities,
  createPayjoinDeposit,
  fetchPayjoinSessions,
  fetchPayjoinSession,
  submitPayjoinProposal,
  contributeToPayjoinProposal,
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
