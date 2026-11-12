'use strict';

const { readStorageJSON } = require('./fabricBrowserState');
const { readStoredIdentity } = require('./hubAccountVault');

/**
 * Whether `fabric.identity.local` holds a browser-created Fabric identity for Hub UI purposes.
 * Signing in as the desktop Hub itself (`/sessions/self`, signer `hub`) is not the same as
 * completing Generate / import in the post-setup wizard — exclude it so the wizard stays until then.
 *
 * @param {object|null|undefined} [parsedOpt] - Pre-read payload, or omit to read storage.
 * @returns {boolean}
 */
function hasCompletedPostSetupBrowserIdentity (parsedOpt) {
  const p = parsedOpt !== undefined ? parsedOpt : readStorageJSON('fabric.identity.local', null);
  const { kind, identity } = readStoredIdentity(p);
  if (!identity) return false;
  if (kind === 'passport' && identity.signer === 'hub') return false;
  return true;
}

module.exports = {
  hasCompletedPostSetupBrowserIdentity
};
