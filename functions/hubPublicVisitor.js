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
 * True when `localIdentity` or `propsAuth` carries signing material in memory (xprv or legacy private).
 * Locked or watch-only shells still need unlock/import before signing even when this is false.
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function hasUnlockedHubSigningIdentity ({ localIdentity, propsAuth }) {
  const fromLocal = !!(localIdentity && (localIdentity.xprv || localIdentity.private));
  const fromProps = !!(propsAuth && (propsAuth.xprv || propsAuth.private));
  return fromLocal || fromProps;
}

/**
 * True only for anonymous browsers with **no** enrolled Hub shell identity.
 *
 * Once `HubInterface` has hydrated `localIdentity` from disk (password-locked, watch-only xpub, or
 * desktop-linked profile), we return **false** so the normal shell renders — TopPanel shows
 * Unlock / watch-only / signed-in — instead of replacing routes with {@link PublicVisitorGate}.
 *
 * Signing-protected flows still require `xprv` in memory or delegation elsewhere.
 *
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function computePublicHubVisitor ({ localIdentity, propsAuth }) {
  if (hasUnlockedHubSigningIdentity({ localIdentity, propsAuth })) return false;
  if (
    localIdentity &&
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
