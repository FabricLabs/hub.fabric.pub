'use strict';

const Actor = require('@fabric/core/types/actor');

const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');

/** @typedef {{ id: string, kind?: string, title: string, subtitle?: string, href?: string, copyText?: string, ts?: number, readAt?: (number|null), resolvedAt?: (number|null) }} UiNotification */

const STORAGE_KEY = 'fabric:uiNotifications';
/** Newest rows kept besides wallet transactions, which are never pruned. */
const MAX_HISTORY = 500;
const UPDATED_EVENT = 'fabric:uiNotificationsUpdated';

const WALLET_TRANSACTION_KINDS = new Set([
  'wallet_receive',
  'wallet_receive_mempool',
  'wallet_receive_confirmed',
  'l1_invoice',
  'payjoin_proposal'
]);

/**
 * @param {UiNotification|{ kind?: string }|null|undefined} n
 * @returns {boolean}
 */
function isWalletTransactionNotification (n) {
  return !!(n && WALLET_TRANSACTION_KINDS.has(String(n.kind || '')));
}

/**
 * @param {UiNotification|null|undefined} n
 * @returns {boolean}
 */
function isUnread (n) {
  return !!n && !n.readAt;
}

/**
 * @param {UiNotification[]} list
 * @returns {number}
 */
function countUnread (list) {
  return Array.isArray(list) ? list.filter(isUnread).length : 0;
}

/**
 * Newest first; every wallet transaction plus the newest {@link MAX_HISTORY} other rows.
 * @param {UiNotification[]} list
 * @returns {UiNotification[]}
 */
function retainHistory (list) {
  const sorted = list
    .filter((n) => n && n.id)
    .slice()
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  let others = 0;
  return sorted.filter((n) => {
    if (isWalletTransactionNotification(n)) return true;
    others += 1;
    return others <= MAX_HISTORY;
  });
}

/**
 * @returns {UiNotification[]}
 */
function readUiNotifications () {
  try {
    if (typeof window === 'undefined') return [];
    const p = readStorageJSON(STORAGE_KEY, []);
    return Array.isArray(p) ? p.filter((n) => n && n.id) : [];
  } catch (e) {
    return [];
  }
}

/**
 * @param {UiNotification[]} list
 */
function writeUiNotifications (list) {
  try {
    if (typeof window === 'undefined') return;
    writeStorageJSON(STORAGE_KEY, list);
  } catch (e) { /* quota */ }
}

function emitUpdated (list) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATED_EVENT, { detail: { notifications: list } }));
}

/**
 * Apply `fn` to the stored list, keep the history rules, save, and announce.
 * @param {(list: UiNotification[]) => UiNotification[]} fn
 * @returns {UiNotification[]}
 */
function updateUiNotifications (fn) {
  if (typeof window === 'undefined') return [];
  const next = retainHistory(fn(readUiNotifications()));
  writeUiNotifications(next);
  emitUpdated(next);
  return next;
}

/**
 * Add or replace a notification (same `id` updates in place and keeps its read state).
 * @param {Omit<UiNotification, 'ts'> & { ts?: number }} item
 */
function pushUiNotification (item) {
  if (typeof window === 'undefined') return;
  const id = String(item.id || '').trim() || `n-${new Actor({
    type: 'HubEphemeralId',
    purpose: 'uiNotification',
    nonce: Actor.randomBytes(8).toString('hex'),
    at: Date.now()
  }).id}`;
  updateUiNotifications((list) => {
    const prev = list.find((n) => n.id === id) || null;
    const entry = {
      id,
      kind: item.kind || 'info',
      title: String(item.title || 'Notice'),
      subtitle: item.subtitle != null ? String(item.subtitle) : undefined,
      href: item.href != null ? String(item.href) : undefined,
      copyText: item.copyText != null ? String(item.copyText) : undefined,
      ts: item.ts != null ? Number(item.ts) : Date.now(),
      readAt: prev && prev.readAt ? prev.readAt : null,
      resolvedAt: prev && prev.resolvedAt ? prev.resolvedAt : null
    };
    return [entry, ...list.filter((n) => n.id !== id)];
  });
}

/**
 * @param {string[]} ids
 */
function markUiNotificationsRead (ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean));
  if (!want.size) return;
  const now = Date.now();
  updateUiNotifications((list) => list.map((n) => (want.has(n.id) && !n.readAt ? { ...n, readAt: now } : n)));
}

function markAllUiNotificationsRead () {
  const now = Date.now();
  updateUiNotifications((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
}

/**
 * @param {string} id
 */
function markUiNotificationUnread (id) {
  const want = String(id || '').trim();
  if (!want) return;
  updateUiNotifications((list) => list.map((n) => (n.id === want ? { ...n, readAt: null } : n)));
}

/**
 * The thing a notification asked about is settled (e.g. a signing request was answered):
 * keep it in history, read and marked resolved.
 * @param {string} id
 */
function resolveUiNotification (id) {
  const want = String(id || '').trim();
  if (!want) return;
  const now = Date.now();
  updateUiNotifications((list) => list.map((n) => (n.id === want
    ? { ...n, readAt: n.readAt || now, resolvedAt: n.resolvedAt || now }
    : n)));
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
  MAX_HISTORY,
  WALLET_TRANSACTION_KINDS,
  isWalletTransactionNotification,
  isUnread,
  countUnread,
  retainHistory,
  readUiNotifications,
  pushUiNotification,
  markUiNotificationsRead,
  markAllUiNotificationsRead,
  markUiNotificationUnread,
  resolveUiNotification,
  copyToClipboard
};
