'use strict';

/**
 * Browser-only feature visibility for the hub SPA (localStorage). **activities**, **features**,
 * and **bitcoinExplorer** are always treated as enabled (see `normalizeFlags`). **peers** defaults
 * true (Fabric peering is on) but the Peers nav and routes require the hub admin token.
 * **bitcoinInvoices** is always treated as enabled (see `normalizeFlags`). Bitcoin dashboard stays routable;
 * other sub-areas use bitcoinPayments, bitcoinResources, etc.
 */
const STORAGE_KEY = 'fabric.hub.uiFeatureFlags';
const CHANGED_EVENT = 'fabricHubUiFeatureFlagsChanged';
const SETTINGS_KEY = 'HUB_UI_FEATURE_FLAGS';

const BITCOIN_UI_FLAG_KEYS = [
  'bitcoinPayments',
  'bitcoinInvoices',
  'bitcoinResources',
  'bitcoinExplorer',
  'bitcoinLightning',
  'bitcoinCrowdfund'
];

const FLAG_KEYS = [
  'peers',
  'activities',
  'features',
  'sidechain',
  ...BITCOIN_UI_FLAG_KEYS
];

function defaultFlags () {
  return {
    peers: true,
    activities: true,
    features: true,
    sidechain: false,
    bitcoinPayments: false,
    bitcoinInvoices: true,
    bitcoinResources: false,
    bitcoinExplorer: true,
    bitcoinLightning: false,
    bitcoinCrowdfund: false
  };
}

function normalizeFlags (raw) {
  const d = defaultFlags();
  if (!raw || typeof raw !== 'object') return d;
  if (raw.bitcoin === true) {
    for (const k of BITCOIN_UI_FLAG_KEYS) d[k] = true;
  }
  for (const k of FLAG_KEYS) {
    if (raw[k] === true) d[k] = true;
  }
  d.activities = true;
  d.features = true;
  d.bitcoinExplorer = true;
  d.bitcoinInvoices = true;
  return d;
}

function loadHubUiFeatureFlags () {
  if (typeof window === 'undefined') return defaultFlags();
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    if (!s) return defaultFlags();
    return normalizeFlags(JSON.parse(s));
  } catch (e) {
    return defaultFlags();
  }
}

function saveHubUiFeatureFlags (flags) {
  if (typeof window === 'undefined') return;
  const next = normalizeFlags(flags);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: next }));
  } catch (e) { /* ignore */ }
}

function setHubUiFeatureFlag (key, value) {
  if (!FLAG_KEYS.includes(key)) return loadHubUiFeatureFlags();
  const f = loadHubUiFeatureFlags();
  f[key] = !!value;
  saveHubUiFeatureFlags(f);
  return f;
}

function setAllHubUiFeatureFlags (patch) {
  const f = loadHubUiFeatureFlags();
  const p = patch && typeof patch === 'object' ? patch : {};
  for (const k of FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, k)) f[k] = !!p[k];
  }
  saveHubUiFeatureFlags(f);
  return f;
}

function subscribeHubUiFeatureFlags (callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return function noop () {};
  }
  const handler = () => {
    try {
      callback(loadHubUiFeatureFlags());
    } catch (e) { /* ignore */ }
  };
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

/**
 * Load hub UI feature flags persisted in Hub settings (disk-backed on server).
 * Falls back to localStorage defaults when unavailable.
 * @returns {Promise<object>}
 */
async function fetchPersistedHubUiFeatureFlags () {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return loadHubUiFeatureFlags();
  }
  try {
    const res = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) return loadHubUiFeatureFlags();
    if (!res.ok) return loadHubUiFeatureFlags();
    const body = await res.json().catch(() => ({}));
    const value = body && body.value && typeof body.value === 'object' ? body.value : null;
    if (!value) return loadHubUiFeatureFlags();
    const next = normalizeFlags(value);
    saveHubUiFeatureFlags(next);
    return next;
  } catch (_) {
    return loadHubUiFeatureFlags();
  }
}

/**
 * Persist hub UI feature flags to Hub settings (disk-backed on server).
 * Requires admin token.
 * @param {object} flags
 * @param {string} adminToken
 * @returns {Promise<{ok:boolean, flags:object, persisted:boolean, message?:string}>}
 */
async function persistHubUiFeatureFlags (flags, adminToken) {
  const next = normalizeFlags(flags);
  saveHubUiFeatureFlags(next);
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { ok: false, flags: next, persisted: false, message: 'window/fetch unavailable' };
  }
  const token = String(adminToken || '').trim();
  if (!token) {
    return { ok: false, flags: next, persisted: false, message: 'admin token required' };
  }
  try {
    const res = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ value: next })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, flags: next, persisted: false, message: text || `${res.status}` };
    }
    return { ok: true, flags: next, persisted: true };
  } catch (e) {
    return { ok: false, flags: next, persisted: false, message: e && e.message ? e.message : String(e) };
  }
}

/** True if any Bitcoin sub-feature toggle is on (for optional grouped UI). */
function anyBitcoinSubFeatureEnabled (f) {
  if (!f || typeof f !== 'object') return false;
  return BITCOIN_UI_FLAG_KEYS.some((k) => f[k] === true);
}

module.exports = {
  FLAG_KEYS,
  BITCOIN_UI_FLAG_KEYS,
  loadHubUiFeatureFlags,
  saveHubUiFeatureFlags,
  setHubUiFeatureFlag,
  setAllHubUiFeatureFlags,
  subscribeHubUiFeatureFlags,
  fetchPersistedHubUiFeatureFlags,
  persistHubUiFeatureFlags,
  anyBitcoinSubFeatureEnabled,
  defaultHubUiFeatureFlags: defaultFlags,
  HUB_UI_FEATURE_FLAGS_SETTING_KEY: SETTINGS_KEY
};
