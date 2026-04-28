'use strict';

const { createFabricBrowserStore } = require('./fabricBrowserStore');

const FABRIC_STATE_KEY = 'fabric:state';

function getFabricBrowserGlobal () {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.window != null) return globalThis.window;
  } catch (_) {}
  try {
    if (typeof window !== 'undefined') return window;
  } catch (_) {}
  return undefined;
}

const LEGACY_KEY_PATHS = {
  'fabric.identity.local': '/identity/local',
  'fabric.hub.adminToken': '/hub/adminToken',
  'fabric.hub.adminTokenExpiresAt': '/hub/adminTokenExpiresAt',
  'fabric.hub.address': '/hub/address',
  'fabric.delegation': '/delegation',
  'fabric.hub.federationSpendingPrefs': '/preferences/federationSpending',
  'fabric.hub.alertDismissals': '/ui/alertDismissals',
  'fabric:uiNotifications': '/ui/notifications',
  'fabric.joinmarket.poolSizesBtc': '/joinmarket/poolSizesBtc',
  'fabric.bitcoin.upstream': '/bitcoin/upstream',
  'fabric.bitcoin.payjoinPreferences': '/bitcoin/payjoinPreferences',
  'fabric.bitcoin.wallets': '/bitcoin/wallets',
  'fabric.bitcoin.balanceCache': '/bitcoin/balanceCache',
  'fabric.bitcoin.spendXpubWatch': '/bitcoin/spendXpubWatch',
  'fabric.bitcoin.defaultBip44ReceiveAccount': '/bitcoin/defaultBip44ReceiveAccount',
  'fabric.bitcoin.defaultBip44SendAccount': '/bitcoin/defaultBip44SendAccount',
  'fabric.bitcoin.invoices': '/invoices',
  'fabric:documents': '/documents',
  'fabric:messages': '/messages',
  'fabric:distributeProposals': '/distributeProposals',
  'fabric.peers.primaryFabricAddress': '/peers/primaryFabricAddress'
};

function hasLocalStorage () {
  try {
    const w = getFabricBrowserGlobal();
    return !!w && !!w.localStorage;
  } catch (e) {
    return false;
  }
}

let _fabricStateSingleton = null;

function resetFabricBrowserStateStore () {
  _fabricStateSingleton = null;
}

/**
 * Single {@link createFabricBrowserStore} for `fabric:state`.
 * Multiple instances used to silently clobber writes (Bridge JSON-PATCH vs hub UI prefs `PUT`).
 */
function store () {
  if (!_fabricStateSingleton) {
    _fabricStateSingleton = createFabricBrowserStore({
      storageKey: FABRIC_STATE_KEY,
      initialState: {}
    });
  }
  return _fabricStateSingleton;
}

function pathForLegacyKey (legacyKey) {
  return LEGACY_KEY_PATHS[String(legacyKey || '').trim()] || null;
}

function readStorageString (legacyKey) {
  if (!hasLocalStorage()) return '';
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) {
      const v = store().GET(path);
      if (v != null) return String(v);
    }
  } catch (e) {}
  try {
    const w = getFabricBrowserGlobal();
    if (!w) return '';
    return String(w.localStorage.getItem(legacyKey) || '');
  } catch (e) {
    return '';
  }
}

function writeStorageString (legacyKey, value) {
  if (!hasLocalStorage()) return false;
  const v = String(value == null ? '' : value);
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) store().PUT(path, v);
  } catch (e) {}
  try {
    const w = getFabricBrowserGlobal();
    if (!w) return false;
    w.localStorage.setItem(legacyKey, v);
    return true;
  } catch (e) {
    return false;
  }
}

function readStorageJSON (legacyKey, fallback) {
  if (!hasLocalStorage()) return fallback;
  const path = pathForLegacyKey(legacyKey);
  let fromPath;
  let hasPath = false;
  try {
    if (path) {
      const v = store().GET(path);
      if (typeof v !== 'undefined') {
        fromPath = v;
        hasPath = true;
      }
    }
  } catch (e) {}
  let fromLegacy;
  let hasLegacy = false;
  try {
    const w = getFabricBrowserGlobal();
    if (w) {
      const raw = w.localStorage.getItem(legacyKey);
      if (raw) {
        fromLegacy = JSON.parse(raw);
        hasLegacy = true;
      }
    }
  } catch (e) {
    fromLegacy = undefined;
  }
  if (hasPath) return fromPath;
  if (hasLegacy) return fromLegacy;
  return fallback;
}

function writeStorageJSON (legacyKey, value) {
  if (!hasLocalStorage()) return false;
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) store().PUT(path, value);
  } catch (e) {}
  try {
    const w = getFabricBrowserGlobal();
    if (!w) return false;
    w.localStorage.setItem(legacyKey, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function removeStorageKey (legacyKey) {
  if (!hasLocalStorage()) return false;
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) store().DELETE(path);
  } catch (e) {}
  try {
    const w = getFabricBrowserGlobal();
    if (!w) return false;
    w.localStorage.removeItem(legacyKey);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  FABRIC_STATE_KEY,
  store,
  resetFabricBrowserStateStore,
  getFabricBrowserGlobal,
  pathForLegacyKey,
  readStorageString,
  writeStorageString,
  readStorageJSON,
  writeStorageJSON,
  removeStorageKey
};

