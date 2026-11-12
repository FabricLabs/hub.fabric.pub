'use strict';

const { readStorageJSON } = require('./fabricBrowserState');
const { hasPassportSession } = require('./passportSession');
const { STORAGE_KEY, readStoredIdentity } = require('./hubAccountVault');

function hasPersistedFabricIdentity () {
  if (typeof window === 'undefined') return false;
  try {
    return !!readStoredIdentity(readStorageJSON(STORAGE_KEY, null)).identity;
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
 * Signing-protected flows still require `xprv` in memory.
 *
 * @param {{ localIdentity?: object|null, propsAuth?: object|null }} args
 * @returns {boolean}
 */
function computePublicHubVisitor ({ localIdentity, propsAuth }) {
  if (hasUnlockedHubSigningIdentity({ localIdentity, propsAuth })) return false;
  if (
    localIdentity &&
    localIdentity.id
  ) {
    return false;
  }
  // Before HubInterface hydrates `localIdentity`, a locked/watch-only record on
  // disk must not be treated as an anonymous public visitor.
  if (hasPersistedFabricIdentity()) return false;
  if (hasPassportSession()) return false;
  return true;
}

module.exports = {
  computePublicHubVisitor,
  hasPersistedFabricIdentity,
  hasUnlockedHubSigningIdentity
};
