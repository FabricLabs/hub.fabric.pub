'use strict';

const {
  readStorageString,
  writeStorageString
} = require('./fabricBrowserState');

/**
 * Hub setup admin token in the browser (localStorage). Used for regtest Hub-wallet sends.
 * @param {string|null|undefined} adminTokenProp - From HubInterface state when available
 * @returns {string}
 */
function readHubAdminTokenFromBrowser (adminTokenProp) {
  const fromProp = adminTokenProp != null && String(adminTokenProp).trim()
    ? String(adminTokenProp).trim()
    : '';
  if (fromProp) return fromProp;
  try {
    if (typeof window !== 'undefined') {
      return readStorageString('fabric.hub.adminToken').trim();
    }
  } catch (e) {}
  return '';
}

/**
 * Persist token and notify shell (HubInterface) to refresh state.
 * @param {string} token
 * @returns {boolean}
 */
function saveHubAdminTokenToBrowser (token) {
  const t = String(token || '').trim();
  if (!t) return false;
  try {
    if (typeof window !== 'undefined') {
      writeStorageString('fabric.hub.adminToken', t);
      window.dispatchEvent(new CustomEvent('fabricHubAdminTokenSaved', { detail: { ok: true } }));
      return true;
    }
  } catch (e) {}
  return false;
}

module.exports = {
  readHubAdminTokenFromBrowser,
  saveHubAdminTokenToBrowser
};
