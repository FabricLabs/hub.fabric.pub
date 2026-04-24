'use strict';

const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');

/**
 * Hub SPA alerts: configurable short messages under the top panel; dismiss sets a cookie
 * named {@link HubUiAlertDef#elementName} and optionally persists dismissal ids via
 * `GET|PUT /settings/HUB_UI_ALERT_DISMISSALS` (admin token on PUT), same pattern as feature flags.
 */

const LS_KEY = 'fabric.hub.alertDismissals';
const SETTINGS_KEY = 'HUB_UI_ALERT_DISMISSALS';
const CHANGED_EVENT = 'fabricHubUiAlertsDismissedChanged';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

function defaultElementName (id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s ? `fabric-hub-alert-${s}` : 'fabric-hub-alert';
}

/**
 * @param {unknown} raw
 * @returns {{ id: string, elementName: string, message: string, severity: string }[]}
 */
function normalizeHubUiAlerts (raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const baseName = String(item.elementName || defaultElementName(id)).trim();
    const elementName = baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || defaultElementName(id);
    const message = String(item.message || '').trim();
    if (!message || message.length > 400) continue;
    let severity = String(item.severity || 'info').toLowerCase();
    if (!['info', 'warning', 'error', 'success'].includes(severity)) severity = 'info';
    out.push({ id, elementName, message, severity });
  }
  return out;
}

function mergeAlertLists (serverList, windowList) {
  const a = normalizeHubUiAlerts(serverList);
  const b = normalizeHubUiAlerts(windowList);
  const seen = new Set();
  const out = [];
  for (const x of [...a, ...b]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function readDismissedIdsFromLocalStorage () {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = readStorageJSON(LS_KEY, null);
    if (!parsed || typeof parsed !== 'object') return [];
    const ids = parsed && Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : [];
    return ids.map((x) => String(x || '').trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function writeDismissedIdsToLocalStorage (ids) {
  if (typeof window === 'undefined') return;
  const unique = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))];
  writeStorageJSON(LS_KEY, { dismissedIds: unique });
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { dismissedIds: unique } }));
  } catch (e) { /* ignore */ }
}

function getCookieValue (name) {
  if (typeof document === 'undefined' || !document.cookie) return '';
  const key = String(name || '').trim();
  if (!key) return '';
  const parts = document.cookie.split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (decodeURIComponent(k) === key) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}

function setDismissCookie (elementName) {
  if (typeof document === 'undefined') return;
  const name = String(elementName || '').trim();
  if (!name) return;
  document.cookie = `${encodeURIComponent(name)}=1; path=/; max-age=${COOKIE_MAX_AGE_SEC}; samesite=lax`;
}

/**
 * @param {{ id: string, elementName: string }[]} alerts — full list (for cookie↔id mapping)
 * @param {string[]} serverDismissedIds
 * @returns {Set<string>}
 */
function computeDismissedIdSet (alerts, serverDismissedIds) {
  const dismissed = new Set();
  for (const id of (serverDismissedIds || []).map((x) => String(x || '').trim()).filter(Boolean)) {
    dismissed.add(id);
  }
  for (const id of readDismissedIdsFromLocalStorage()) dismissed.add(id);
  for (const a of alerts || []) {
    if (!a || !a.elementName || !a.id) continue;
    const v = getCookieValue(a.elementName);
    if (v === '1' || v === 'true' || v === 'yes') dismissed.add(a.id);
  }
  return dismissed;
}

function filterActiveAlerts (alerts, dismissedIds) {
  const set = dismissedIds instanceof Set ? dismissedIds : new Set(dismissedIds || []);
  return normalizeHubUiAlerts(alerts).filter((a) => !set.has(a.id));
}

/**
 * @returns {Promise<string[]>}
 */
async function fetchPersistedDismissedIds () {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return [];
  try {
    const res = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) return [];
    if (!res.ok) return [];
    const body = await res.json().catch(() => ({}));
    const value = body && body.value && typeof body.value === 'object' ? body.value : null;
    const ids = value && Array.isArray(value.dismissedIds) ? value.dismissedIds : [];
    return ids.map((x) => String(x || '').trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Merge new ids with server + localStorage, PUT when admin token present.
 * @param {string[]} newIds
 * @param {string} adminToken
 * @returns {Promise<{ ok: boolean, persisted: boolean, dismissedIds: string[], message?: string }>}
 */
async function persistDismissedAlertIds (newIds, adminToken) {
  const add = [...new Set((newIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const ls = readDismissedIdsFromLocalStorage();
  const unionLocal = [...new Set([...ls, ...add])];
  writeDismissedIdsToLocalStorage(unionLocal);

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { ok: false, persisted: false, dismissedIds: unionLocal, message: 'no fetch' };
  }
  const token = String(adminToken || '').trim();
  if (!token) {
    return { ok: true, persisted: false, dismissedIds: unionLocal };
  }
  let prev = [];
  try {
    const res = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      const value = body && body.value && typeof body.value === 'object' ? body.value : null;
      const ids = value && Array.isArray(value.dismissedIds) ? value.dismissedIds : [];
      prev = ids.map((x) => String(x || '').trim()).filter(Boolean);
    }
  } catch (_) { /* ignore */ }
  const merged = [...new Set([...prev, ...unionLocal])];
  try {
    const put = await fetch(`/settings/${encodeURIComponent(SETTINGS_KEY)}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ value: { dismissedIds: merged } })
    });
    if (!put.ok) {
      const text = await put.text().catch(() => '');
      return { ok: false, persisted: false, dismissedIds: merged, message: text || `${put.status}` };
    }
    return { ok: true, persisted: true, dismissedIds: merged };
  } catch (e) {
    return {
      ok: false,
      persisted: false,
      dismissedIds: merged,
      message: e && e.message ? e.message : String(e)
    };
  }
}

/**
 * @param {{ id: string, elementName: string }} alert
 * @param {{ adminToken?: string }} [opts]
 */
async function dismissHubUiAlert (alert, opts = {}) {
  if (!alert || !alert.id || !alert.elementName) return;
  setDismissCookie(alert.elementName);
  const cur = readDismissedIdsFromLocalStorage();
  const next = [...new Set([...cur, String(alert.id)])];
  writeDismissedIdsToLocalStorage(next);
  const admin = opts && opts.adminToken != null ? String(opts.adminToken).trim() : '';
  if (admin) {
    try {
      await persistDismissedAlertIds([alert.id], admin);
    } catch (_) { /* ignore */ }
  }
}

function subscribeHubUiAlertDismissals (callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return function noop () {};
  }
  const handler = () => {
    try {
      callback(readDismissedIdsFromLocalStorage());
    } catch (e) { /* ignore */ }
  };
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}

module.exports = {
  LS_KEY,
  SETTINGS_KEY,
  CHANGED_EVENT,
  COOKIE_MAX_AGE_SEC,
  normalizeHubUiAlerts,
  mergeAlertLists,
  readDismissedIdsFromLocalStorage,
  writeDismissedIdsToLocalStorage,
  getCookieValue,
  setDismissCookie,
  computeDismissedIdSet,
  filterActiveAlerts,
  fetchPersistedDismissedIds,
  persistDismissedAlertIds,
  dismissHubUiAlert,
  subscribeHubUiAlertDismissals,
  HUB_UI_ALERT_DISMISSALS_SETTING_KEY: SETTINGS_KEY
};
