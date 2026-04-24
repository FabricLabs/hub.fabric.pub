'use strict';

const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');

/**
 * Browser-only draft for how a federation should treat spends (human text).
 * Not enforced by the hub — used for operator notes / payment memos and UI hints.
 */
const STORAGE_KEY = 'fabric.hub.federationSpendingPrefs';
const CHANGED_EVENT = 'fabricFederationSpendingPrefsChanged';

function defaultPrefs () {
  return {
    spendingCriteriaDraft: '',
    /** When true, Federations / wallet UIs show the drafting textarea by default. */
    draftingUiOpen: false
  };
}

function loadFederationSpendingPrefs () {
  if (typeof window === 'undefined') return defaultPrefs();
  try {
    const p = readStorageJSON(STORAGE_KEY, null);
    if (!p || typeof p !== 'object') return defaultPrefs();
    return {
      ...defaultPrefs(),
      spendingCriteriaDraft: typeof p.spendingCriteriaDraft === 'string' ? p.spendingCriteriaDraft : '',
      draftingUiOpen: !!p.draftingUiOpen
    };
  } catch (_) {
    return defaultPrefs();
  }
}

function saveFederationSpendingPrefs (patch) {
  if (typeof window === 'undefined') return loadFederationSpendingPrefs();
  const cur = loadFederationSpendingPrefs();
  const next = {
    ...cur,
    ...(patch && typeof patch === 'object' ? patch : {})
  };
  try {
    writeStorageJSON(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: next }));
  } catch (_) { /* ignore */ }
  return next;
}

/**
 * @param {ReturnType<loadFederationSpendingPrefs>} prefs
 * @returns {string} Non-empty memo fragment for hub sendpayment memo field
 */
function federationMemoFragmentFromPrefs (prefs) {
  const d = prefs && typeof prefs.spendingCriteriaDraft === 'string'
    ? prefs.spendingCriteriaDraft.trim()
    : '';
  if (!d) return '';
  const max = 500;
  const body = d.length > max ? `${d.slice(0, max)}…` : d;
  return `[Fabric federation spending criteria] ${body}`;
}

/**
 * @param {string} userMemo
 * @param {ReturnType<loadFederationSpendingPrefs>} prefs
 * @param {boolean} attachFederationContext
 */
function mergePaymentMemoWithFederation (userMemo, prefs, attachFederationContext) {
  const base = String(userMemo || '').trim();
  const tag = attachFederationContext ? federationMemoFragmentFromPrefs(prefs) : '';
  if (!tag) return base;
  if (!base) return tag;
  return `${base} | ${tag}`;
}

function subscribeFederationSpendingPrefs (fn) {
  if (typeof window === 'undefined') return () => {};
  const h = () => fn(loadFederationSpendingPrefs());
  window.addEventListener(CHANGED_EVENT, h);
  return () => window.removeEventListener(CHANGED_EVENT, h);
}

module.exports = {
  loadFederationSpendingPrefs,
  saveFederationSpendingPrefs,
  federationMemoFragmentFromPrefs,
  mergePaymentMemoWithFederation,
  subscribeFederationSpendingPrefs,
  FEDERATION_SPENDING_PREFS_CHANGED: CHANGED_EVENT
};
