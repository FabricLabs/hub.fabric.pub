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
  'fabric.hub.identityWizardPending': '/hub/identityWizardPending',
  'fabric.hub.identityWizardDismissed': '/hub/identityWizardDismissed',
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
  'fabric.peers.primaryFabricAddress': '/peers/primaryFabricAddress',
  'fabric.identity.lockTimeoutMinutes': '/preferences/identityLockTimeoutMinutes'
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

/** True when nested `/identity/local` is useless but legacy `fabric.identity.local` may still hold truth. */
function fabricIdentityLocalNestedLooksEmpty (obj) {
  if (obj == null || typeof obj !== 'object') return true;
  return !(obj.id || obj.xpub || obj.xprvEnc);
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
  if (
    String(legacyKey) === 'fabric.identity.local' &&
    hasPath &&
    hasLegacy &&
    fabricIdentityLocalNestedLooksEmpty(fromPath) &&
    !fabricIdentityLocalNestedLooksEmpty(fromLegacy)
  ) {
    return fromLegacy;
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

/**
 * Remove `identity.local` from persisted `fabric:state` JSON when present (defensive).
 * The nested-store singleton can otherwise keep serving `/identity/local` after a partial delete.
 */
function scrubFabricStateIdentitySubtree (w) {
  if (!w || !w.localStorage) return;
  try {
    const raw = w.localStorage.getItem(FABRIC_STATE_KEY);
    if (!raw) return;
    const st = JSON.parse(raw);
    if (!st || typeof st !== 'object' || Array.isArray(st)) return;
    if (!Object.prototype.hasOwnProperty.call(st, 'identity')) return;
    const idNode = st.identity;
    if (!idNode || typeof idNode !== 'object' || Array.isArray(idNode)) return;
    if (Object.prototype.hasOwnProperty.call(idNode, 'local')) {
      delete idNode.local;
    }
    if (Object.keys(idNode).length === 0) {
      delete st.identity;
    }
    w.localStorage.setItem(FABRIC_STATE_KEY, JSON.stringify(st));
  } catch (e) {}
}

/**
 * Full browser Fabric identity wipe for Forget / Destroy: nested `fabric:state` path,
 * legacy `fabric.identity.local`, session unlock blob, dev-seed suppression marker.
 * Resets the `fabric:state` singleton so the next read sees disk truth.
 */
function clearFabricBrowserIdentityLocal () {
  if (!hasLocalStorage()) return false;
  const w = getFabricBrowserGlobal();
  if (!w || !w.localStorage) return false;
  try {
    const path = pathForLegacyKey('fabric.identity.local');
    try {
      if (path) store().DELETE(path);
    } catch (e) {}
    try {
      w.localStorage.removeItem('fabric.identity.local');
    } catch (e) {}
    scrubFabricStateIdentitySubtree(w);
    resetFabricBrowserStateStore();
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('fabric.identity.unlocked');
      }
    } catch (e) {}
    try {
      w.localStorage.removeItem('fabric.identity.devSeedSuppressedFor');
    } catch (e) {}
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
  removeStorageKey,
  clearFabricBrowserIdentityLocal
};

