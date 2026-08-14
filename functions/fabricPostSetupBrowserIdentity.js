'use strict';

const { readStorageJSON } = require('./fabricBrowserState');

/**
 * Whether `fabric.identity.local` holds a browser-created Fabric identity for Hub UI purposes.
 * Desktop shell handoff (`linkedFromDesktop`) supplies id/xpub for mesh/sync but is not the same as
 * completing Generate / import in the post-setup wizard — exclude it so the wizard stays until then.
 *
 * @param {object|null|undefined} [parsedOpt] - Pre-read payload, or omit to read storage.
 * @returns {boolean}
 */
function hasCompletedPostSetupBrowserIdentity (parsedOpt) {
  const p = parsedOpt !== undefined ? parsedOpt : readStorageJSON('fabric.identity.local', null);
  if (!p || typeof p !== 'object') return false;
  if (!(p.id || p.xpub)) return false;
  if (p.linkedFromDesktop === true) return false;
  return true;
}

module.exports = {
  hasCompletedPostSetupBrowserIdentity
};
