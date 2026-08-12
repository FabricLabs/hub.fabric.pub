'use strict';

const { store, getFabricBrowserGlobal } = require('./fabricBrowserState');

/**
 * Browser-only feature visibility for the hub SPA (`fabric:state` → `ui.featureFlags`).
 * Defaults favor the **Document market** (Documents + Peers + Bitcoin invoices/explorer).
 * Persisted `{ value }` from `GET /settings/HUB_UI_FEATURE_FLAGS` overwrites locals.
 *
 * **`advancedMode`** is still used for UX that truly needs an explicit “power user” opt-in elsewhere.
 *
 * Explicit **`peers: false`** hides Peers nav; Bitcoin explorer remains routable; sub-areas use
 * bitcoinPayments, bitcoinResources, etc.
 */
/** Path under `fabric:state` JSON (see {@link ./fabricBrowserState.js}). */
const UI_FEATURE_FLAGS_STATE_PATH = '/ui/featureFlags';

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
  'promo',
  'advancedMode',
  'peers',
  'activities',
  'features',
  'sidechain',
  ...BITCOIN_UI_FLAG_KEYS
];

/** @deprecated No keys are forced on; kept as an empty list for older callers. */
const ALWAYS_ON_FLAG_KEYS = [];

/** Document-market profile: peers + invoices/explorer; unrelated surfaces off. */
function defaultFlags () {
  return {
    promo: false,
    advancedMode: false,
    peers: true,
    activities: false,
    features: false,
    sidechain: false,
    bitcoinPayments: false,
    bitcoinInvoices: true,
    bitcoinResources: false,
    bitcoinExplorer: true,
    bitcoinLightning: false,
    bitcoinCrowdfund: false
  };
}

/** Alias for Admin preset / callers that want an explicit name. */
function documentMarketUiFlags () {
  return defaultFlags();
}

function hasStoredUiFlagShape (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  /** `bitcoin: true` is a sentinel that enables all BTC sub-features. */
  if (Object.prototype.hasOwnProperty.call(raw, 'bitcoin')) return true;
  return FLAG_KEYS.some((k) => Object.prototype.hasOwnProperty.call(raw, k));
}

function normalizeFlags (raw) {
  const d = defaultFlags();
  if (!raw || typeof raw !== 'object') return d;
  // Empty `{}` is not intentional config; real storage can accidentally hold `{}` under fabric:state only.
  if (!hasStoredUiFlagShape(raw)) return d;
  if (raw.bitcoin === true) {
    for (const k of BITCOIN_UI_FLAG_KEYS) d[k] = true;
  }
  for (const k of FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      d[k] = !!raw[k];
    }
  }
  // Without Advanced Mode, keys omitted from `raw` keep bundled defaults (`defaultFlags`), not implicit off.
  if (!d.advancedMode) {
    const baseWhenUnset = defaultFlags();
    const KEYS_INHERIT_WHEN_ABSENT_FROM_RAW = [
      'peers',
      'activities',
      'features',
      'sidechain',
      'bitcoinResources',
      'bitcoinExplorer',
      'bitcoinLightning',
      'bitcoinCrowdfund'
    ];
    for (const k of KEYS_INHERIT_WHEN_ABSENT_FROM_RAW) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) {
        d[k] = !!baseWhenUnset[k];
      }
    }
  }
  return d;
}

function loadHubUiFeatureFlags () {
  if (!getFabricBrowserGlobal()) return defaultFlags();
  try {
    const v = store().GET(UI_FEATURE_FLAGS_STATE_PATH);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return defaultFlags();
    return normalizeFlags(v);
  } catch (e) {
    return defaultFlags();
  }
}

/**
 * Test / automation hook: keep in-memory `fabric:state` and localStorage aligned.
 * Installed once on first browser access (Hub SPA + Puppeteer helpers).
 */
function installHubUiFeatureFlagsWindowApi () {
  const w = getFabricBrowserGlobal();
  if (!w || w.__fabricHubUiFeatureFlags) return;
  w.__fabricHubUiFeatureFlags = {
    load: loadHubUiFeatureFlags,
    setAll: setAllHubUiFeatureFlags,
    set: setHubUiFeatureFlag,
    save: saveHubUiFeatureFlags,
    persist: persistHubUiFeatureFlags,
    defaultFlags
  };
}

function saveHubUiFeatureFlags (flags) {
  if (!getFabricBrowserGlobal()) return;
  const next = normalizeFlags(flags);
  try {
    const st = store();
    const ui = st.GET('/ui');
    const merged =
      ui && typeof ui === 'object' && !Array.isArray(ui)
        ? Object.assign({}, ui, { featureFlags: next })
        : { featureFlags: next };
    st.PUT('/ui', merged);
  } catch (e) { /* ignore */ }
  try {
    const w = getFabricBrowserGlobal();
    if (w) w.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: next }));
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
  const w = getFabricBrowserGlobal();
  if (!w || typeof callback !== 'function') {
    return function noop () {};
  }
  const handler = () => {
    try {
      callback(loadHubUiFeatureFlags());
    } catch (e) { /* ignore */ }
  };
  w.addEventListener(CHANGED_EVENT, handler);
  return () => w.removeEventListener(CHANGED_EVENT, handler);
}

/**
 * Load hub UI feature flags persisted in Hub settings (disk-backed on server).
 * Falls back to localStorage defaults when unavailable.
 * @returns {Promise<object>}
 */
async function fetchPersistedHubUiFeatureFlags () {
  if (!getFabricBrowserGlobal() || typeof fetch !== 'function') {
    return loadHubUiFeatureFlags();
  }
  installHubUiFeatureFlagsWindowApi();
  try {
    // Re-read localStorage first so Puppeteer / other-tab writes are not clobbered by a stale
    // in-memory fabric:state singleton (common browser-test race).
    try {
      if (typeof store().load === 'function') store().load();
    } catch (_) { /* ignore */ }

    const res = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) return loadHubUiFeatureFlags();
    if (!res.ok) return loadHubUiFeatureFlags();
    const body = await res.json().catch(() => ({}));
    let raw = body && Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : null;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (_) {
        raw = null;
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !hasStoredUiFlagShape(raw)) {
      return loadHubUiFeatureFlags();
    }
    // Normalize the persisted server payload directly. Omitted keys fall back to
    // bundled defaults inside normalizeFlags — do not re-merge stale localStorage
    // toggles that can pin disabled features on.
    const next = normalizeFlags(raw);
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
  if (!getFabricBrowserGlobal() || typeof fetch !== 'function') {
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
  ALWAYS_ON_FLAG_KEYS,
  BITCOIN_UI_FLAG_KEYS,
  loadHubUiFeatureFlags,
  saveHubUiFeatureFlags,
  setHubUiFeatureFlag,
  setAllHubUiFeatureFlags,
  subscribeHubUiFeatureFlags,
  fetchPersistedHubUiFeatureFlags,
  persistHubUiFeatureFlags,
  installHubUiFeatureFlagsWindowApi,
  anyBitcoinSubFeatureEnabled,
  defaultHubUiFeatureFlags: defaultFlags,
  documentMarketUiFlags,
  HUB_UI_FEATURE_FLAGS_SETTING_KEY: SETTINGS_KEY
};
