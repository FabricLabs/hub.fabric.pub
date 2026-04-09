'use strict';

const { createFabricBrowserStore } = require('./fabricBrowserStore');

const FABRIC_STATE_KEY = 'fabric:state';

const LEGACY_KEY_PATHS = {
  'fabric.identity.local': '/identity/local',
  'fabric.hub.adminToken': '/hub/adminToken',
  'fabric.hub.adminTokenExpiresAt': '/hub/adminTokenExpiresAt',
  'fabric.hub.address': '/hub/address',
  'fabric.delegation': '/delegation',
  'fabric.hub.federationSpendingPrefs': '/preferences/federationSpending',
  'fabric.hub.alertDismissals': '/ui/alertDismissals',
  'fabric.hub.uiFeatureFlags': '/ui/featureFlags',
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
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (e) {
    return false;
  }
}

function store () {
  return createFabricBrowserStore({ storageKey: FABRIC_STATE_KEY, initialState: {} });
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
    return String(window.localStorage.getItem(legacyKey) || '');
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
    window.localStorage.setItem(legacyKey, v);
    return true;
  } catch (e) {
    return false;
  }
}

function readStorageJSON (legacyKey, fallback) {
  if (!hasLocalStorage()) return fallback;
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) {
      const v = store().GET(path);
      if (typeof v !== 'undefined') return v;
    }
  } catch (e) {}
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeStorageJSON (legacyKey, value) {
  if (!hasLocalStorage()) return false;
  const path = pathForLegacyKey(legacyKey);
  try {
    if (path) store().PUT(path, value);
  } catch (e) {}
  try {
    window.localStorage.setItem(legacyKey, JSON.stringify(value));
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
    window.localStorage.removeItem(legacyKey);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  FABRIC_STATE_KEY,
  pathForLegacyKey,
  readStorageString,
  writeStorageString,
  readStorageJSON,
  writeStorageJSON,
  removeStorageKey
};

