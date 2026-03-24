'use strict';

/**
 * Browser localStorage key for Hub delegation token + same-tab sync event
 * (IdentityManager writes; SecurityHome and others listen).
 */

const DELEGATION_STORAGE_KEY = 'fabric.delegation';
const DELEGATION_CHANGED_EVENT = 'fabric:delegationChanged';

function notifyDelegationStorageChanged () {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(DELEGATION_CHANGED_EVENT));
  } catch (_) {}
}

/** True after desktop browser login: Hub signs by delegation; browser holds xpub + token only. */
function hasExternalSigningDelegation () {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const raw = window.localStorage.getItem(DELEGATION_STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return !!(d && d.token && d.externalSigning);
  } catch (e) {
    return false;
  }
}

module.exports = {
  DELEGATION_STORAGE_KEY,
  DELEGATION_CHANGED_EVENT,
  notifyDelegationStorageChanged,
  hasExternalSigningDelegation
};
