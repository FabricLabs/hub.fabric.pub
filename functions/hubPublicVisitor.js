'use strict';

const { readStorageJSON } = require('./fabricBrowserState');

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
 * True until the user has an unlocked Fabric identity (signing key in memory).
 * Hides operator nav, More menu, and `pv()`-gated pages until create/unlock — not merely "has xpub on disk".
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function computePublicHubVisitor ({ localIdentity, propsAuth }) {
  return !hasUnlockedHubSigningIdentity({ localIdentity, propsAuth });
}

module.exports = {
  computePublicHubVisitor,
  hasPersistedFabricIdentity,
  hasUnlockedHubSigningIdentity
};
