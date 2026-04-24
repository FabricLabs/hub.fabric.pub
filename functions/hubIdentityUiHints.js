'use strict';

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
  if (c === 'password_locked') {
    return ' Use Settings → Fabric identity or the top-bar Locked control to enter your encryption password.';
  }
  if (c === 'watch_only') {
    return ' Use Settings → Fabric identity or the top-bar identity menu to import a full key or use desktop signing (watch-only cannot sign).';
  }
  return ' Use Settings → Fabric identity or Log in in the top bar to create or restore a key.';
}

function fabricIdentityChatDisabledReasonPlain (authLike) {
  return `Unlock identity to send chat messages.${fabricIdentityUnlockSuffixPlain(authLike)}`;
}

function fabricIdentityPeerDisabledReasonPlain (authLike) {
  return `Unlock identity to send peer messages.${fabricIdentityUnlockSuffixPlain(authLike)}`;
}

/**
 * Short operator hint when signing / xprv is required (documents, payments, sidechain).
 * @param {object|null|undefined} authLike
 * @returns {string}
 */
function fabricIdentityNeedFullKeyPlain (authLike) {
  const c = classifyHubBrowserIdentity(authLike);
  if (c === 'password_locked') {
    return 'Unlock with your encryption password (Settings → Fabric identity or top-bar Locked).';
  }
  if (c === 'watch_only') {
    return 'Import a full key or use desktop signing (Settings → Fabric identity or top-bar identity menu — watch-only cannot sign).';
  }
  return 'Create or restore a Fabric identity (Settings → Fabric identity or Log in).';
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
  if (!local || typeof local !== 'object') return 'Log in';
  const locXprv = local.xprv && String(local.xprv).trim();
  const locXpub = local.xpub ? String(local.xpub) : '';
  if (locXprv && !local.passwordProtected && locXpub) {
    return `${locXpub.slice(0, 8)}…${locXpub.slice(-8)}`;
  }
  if (local.passwordProtected) return 'Locked';
  if (local.xpub || local.id) return 'Watch-only';
  return 'Log in';
}

module.exports = {
  classifyHubBrowserIdentity,
  fabricIdentityUnlockSuffixPlain,
  fabricIdentityChatDisabledReasonPlain,
  fabricIdentityPeerDisabledReasonPlain,
  fabricIdentityNeedFullKeyPlain,
  featuresPageIdentityButtonLabelFromStorage
};
