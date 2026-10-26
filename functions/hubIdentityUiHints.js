'use strict';

const t = require('../locales/en');
const { readStoredIdentity } = require('./hubAccountVault');

const id = t.common.identity;

/**
 * Browser identity classification for copy (matches TopPanel: password-locked vs watch-only).
 * @param {object|null|undefined} authLike Hub `auth` / identity: xprv, private, id, passwordProtected
 * @returns {'unlocked'|'password_locked'|'watch_only'|'none'}
 */
function classifyHubBrowserIdentity (authLike) {
  if (!authLike || typeof authLike !== 'object') return 'none';
  const hasPrivate = !!(authLike.xprv || authLike.private);
  if (hasPrivate) return 'unlocked';
  if (!authLike.id) return 'none';
  if (authLike.passwordProtected) return 'password_locked';
  return 'watch_only';
}

/**
 * Appended to chat/peer unlock lines (Bridge toasts, fabric:chatWarning).
 * @param {object|null|undefined} authLike
 * @returns {string}
 */
function fabricIdentityUnlockSuffixPlain (authLike) {
  const c = classifyHubBrowserIdentity(authLike);
  if (c === 'password_locked') return ` ${id.howToUnlock}`;
  if (c === 'watch_only') return ` ${id.howToImport}`;
  return ` ${id.howToLogIn}`;
}

function disabledReason (authLike, reasons) {
  const c = classifyHubBrowserIdentity(authLike);
  const reason = c === 'password_locked' ? reasons.locked : (c === 'watch_only' ? reasons.watchOnly : reasons.none);
  return `${reason}${fabricIdentityUnlockSuffixPlain(authLike)}`;
}

function fabricIdentityChatDisabledReasonPlain (authLike) {
  return disabledReason(authLike, { locked: id.chatLocked, watchOnly: id.chatWatchOnly, none: id.chatNone });
}

function fabricIdentityPeerDisabledReasonPlain (authLike) {
  return disabledReason(authLike, { locked: id.peerLocked, watchOnly: id.peerWatchOnly, none: id.peerNone });
}

/**
 * Short operator hint when signing / xprv is required (documents, payments, sidechain).
 * @param {object|null|undefined} authLike
 * @returns {string}
 */
function fabricIdentityNeedFullKeyPlain (authLike) {
  const c = classifyHubBrowserIdentity(authLike);
  if (c === 'password_locked') return id.needUnlock;
  if (c === 'watch_only') return id.needFullKey;
  return id.needIdentity;
}

/**
 * Features page / storage-driven label when not using full React props.
 * @param {object|null} stored Raw `fabric.identity.local` record (vault or Passport record)
 * @returns {string}
 */
function featuresPageIdentityButtonLabelFromStorage (stored) {
  let identity = null;
  try {
    identity = readStoredIdentity(stored).identity;
  } catch (_) {}
  if (!identity) return id.login;
  if (identity.passwordProtected) return id.locked;
  const pid = String(identity.id);
  return pid.length > 18 ? `${pid.slice(0, 8)}…${pid.slice(-8)}` : pid;
}

module.exports = {
  classifyHubBrowserIdentity,
  fabricIdentityUnlockSuffixPlain,
  fabricIdentityChatDisabledReasonPlain,
  fabricIdentityPeerDisabledReasonPlain,
  fabricIdentityNeedFullKeyPlain,
  featuresPageIdentityButtonLabelFromStorage
};
