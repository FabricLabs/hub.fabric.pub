'use strict';

/** @typedef {{ id: string, kind?: string, title: string, subtitle?: string, href?: string, copyText?: string, ts?: number }} UiNotification */

const STORAGE_KEY = 'fabric:uiNotifications';
const MAX_ITEMS = 40;
const UPDATED_EVENT = 'fabric:uiNotificationsUpdated';

/**
 * @returns {UiNotification[]}
 */
function readUiNotifications () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return [];
  }
}

/**
 * @param {UiNotification[]} list
 */
function writeUiNotifications (list) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch (e) { /* quota */ }
}

function emitUpdated (list) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { notifications: list } }));
}

/**
 * Add or replace a notification (same `id` updates in place).
 * @param {Omit<UiNotification, 'ts'> & { ts?: number }} item
 */
function pushUiNotification (item) {
  if (typeof window === 'undefined') return;
  const id = String(item.id || '').trim() || `n-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const entry = {
    id,
    kind: item.kind || 'info',
    title: String(item.title || 'Notice'),
    subtitle: item.subtitle != null ? String(item.subtitle) : undefined,
    href: item.href != null ? String(item.href) : undefined,
    copyText: item.copyText != null ? String(item.copyText) : undefined,
    ts: item.ts != null ? Number(item.ts) : Date.now()
  };
  const prev = readUiNotifications().filter((n) => n && n.id !== id);
  const next = [entry, ...prev].slice(0, MAX_ITEMS);
  writeUiNotifications(next);
  emitUpdated(next);
}

function clearUiNotifications () {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  emitUpdated([]);
}

/**
 * @param {string} id
 */
function removeUiNotification (id) {
  const want = String(id || '').trim();
  if (!want) return;
  const next = readUiNotifications().filter((n) => n && n.id !== want);
  writeUiNotifications(next);
  emitUpdated(next);
}

function copyToClipboard (text) {
  const t = String(text || '');
  if (!t) return Promise.resolve(false);
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).then(() => true).catch(() => fallbackCopy(t));
  }
  return Promise.resolve(fallbackCopy(t));
}

function fallbackCopy (t) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

module.exports = {
  STORAGE_KEY,
  UPDATED_EVENT,
  readUiNotifications,
  pushUiNotification,
  clearUiNotifications,
  removeUiNotification,
  copyToClipboard
};
