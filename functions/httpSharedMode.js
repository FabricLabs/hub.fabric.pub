'use strict';

/**
 * Whether persisted HTTP_SHARED_MODE means "bind 0.0.0.0" (LAN-wide).
 * Kept in sync with Hub runtime rebind logic.
 * @param {*} raw
 * @returns {boolean}
 */
function isHttpSharedModeEnabled (raw) {
  if (raw === undefined || raw === null) return false;
  if (raw === true || raw === 1) return true;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

module.exports = { isHttpSharedModeEnabled };
