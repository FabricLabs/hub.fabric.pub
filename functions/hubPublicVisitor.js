'use strict';

const { readStorageJSON } = require('./fabricBrowserState');
const { hasExternalSigningDelegation } = require('./fabricDelegationLocal');

function hasPersistedFabricIdentity () {
  if (typeof window === 'undefined') return false;
  try {
    const p = readStorageJSON('fabric.identity.local', null);
    return !!(p && (p.id || p.xpub));
  } catch (e) {
    return false;
  }
}

/**
 * True when `localIdentity` or `propsAuth` carries an unlocked signing material (xprv or legacy private).
 * Password-locked or watch-only profiles (xpub only) are not "logged in" for operator UI.
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function hasUnlockedHubSigningIdentity ({ localIdentity, propsAuth }) {
  const fromLocal = !!(localIdentity && (localIdentity.xprv || localIdentity.private));
  const fromProps = !!(propsAuth && (propsAuth.xprv || propsAuth.private));
  return fromLocal || fromProps;
}

/**
 * True until the user has an unlocked Fabric identity (signing key in memory), or another enrolled path.
 * Hides operator nav, More menu, and `pv()`-gated pages until create/unlock — not merely "has xpub on disk".
 *
 * Exceptions (not treated as anonymous visitors): password-protected (or legacy plaintext-unlock) identity
 * on disk; Fabric Hub desktop login (`linkedFromDesktop` watch profile); or an active external-signing
 * delegation token after desktop login.
 * Generic watch-only xpub-only profiles stay visitors until they unlock/import signing keys.
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function computePublicHubVisitor ({ localIdentity, propsAuth }) {
  if (hasUnlockedHubSigningIdentity({ localIdentity, propsAuth })) return false;
  const lockedEnrollment = !!(
    localIdentity &&
    (localIdentity.passwordProtected || localIdentity.plaintextUnlockAvailable)
  );
  if (lockedEnrollment) return false;
  if (
    localIdentity &&
    localIdentity.linkedFromDesktop &&
    localIdentity.xpub &&
    (localIdentity.id || localIdentity.xpub)
  ) {
    return false;
  }
  if (hasExternalSigningDelegation()) return false;
  return true;
}

module.exports = {
  computePublicHubVisitor,
  hasPersistedFabricIdentity,
  hasUnlockedHubSigningIdentity
};
