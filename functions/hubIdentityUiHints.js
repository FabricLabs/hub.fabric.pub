'use strict';

const t = require('../locales/en');

const id = t.common.identity;

/**
 * Browser identity classification for copy (matches TopPanel: password-locked vs watch-only).
 * @param {object|null|undefined} authLike Hub `auth` / identity: xprv, private, xpub, id, passwordProtected
 * @returns {'unlocked'|'password_locked'|'watch_only'|'none'}
 */
function classifyHubBrowserIdentity (authLike) {
  if (!authLike || typeof authLike !== 'object') return 'none';
  const hasPrivate = !!(authLike.xprv || authLike.private);
  if (hasPrivate) return 'unlocked';
  const hasPublic = !!(authLike.xpub || authLike.id);
  if (!hasPublic) return 'none';
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
 * Features page / storage-driven label when not using full React props (localStorage shape).
 * @param {{ xprv?: string, xpub?: string, id?: string, passwordProtected?: boolean }|null} local
 * @param {{ xprv?: string, xpub?: string }|null} sessionUnlocked
 * @returns {string}
 */
function featuresPageIdentityButtonLabelFromStorage (local, sessionUnlocked) {
  const sessXprv = sessionUnlocked && sessionUnlocked.xprv && String(sessionUnlocked.xprv).trim();
  const sessXpub = sessionUnlocked && sessionUnlocked.xpub ? String(sessionUnlocked.xpub) : '';
  if (sessXprv && sessXpub) {
    return `${sessXpub.slice(0, 8)}…${sessXpub.slice(-8)}`;
  }
  if (!local || typeof local !== 'object') return id.login;
  const locXprv = local.xprv && String(local.xprv).trim();
  const locXpub = local.xpub ? String(local.xpub) : '';
  if (locXprv && !local.passwordProtected && locXpub) {
    return `${locXpub.slice(0, 8)}…${locXpub.slice(-8)}`;
  }
  if (local.passwordProtected) return id.locked;
  if (local.xpub || local.id) return id.watchOnly;
  return id.login;
}

module.exports = {
  classifyHubBrowserIdentity,
  fabricIdentityUnlockSuffixPlain,
  fabricIdentityChatDisabledReasonPlain,
  fabricIdentityPeerDisabledReasonPlain,
  fabricIdentityNeedFullKeyPlain,
  featuresPageIdentityButtonLabelFromStorage
};
