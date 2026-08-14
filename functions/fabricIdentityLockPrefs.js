'use strict';

const { readStorageJSON, writeStorageJSON } = require('./fabricBrowserState');

const STORAGE_KEY = 'fabric.identity.lockTimeoutMinutes';
/** Hub default when unset — matches prior IdentityManager hard-coded 30m. */
const DEFAULT_LOCK_TIMEOUT_MINUTES = 30;
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60;

/**
 * @returns {number} Minutes until auto-lock (0 = disabled).
 */
function readFabricIdentityLockTimeoutMinutes () {
  try {
    const v = readStorageJSON(STORAGE_KEY, null);
    if (v === null || typeof v === 'undefined') return DEFAULT_LOCK_TIMEOUT_MINUTES;
    if (v === '' || v === false) return DEFAULT_LOCK_TIMEOUT_MINUTES;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return DEFAULT_LOCK_TIMEOUT_MINUTES;
    if (n === 0) return 0;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
  } catch (e) {
    return DEFAULT_LOCK_TIMEOUT_MINUTES;
  }
}

/**
 * @param {number} minutes - 0 disables auto-lock; otherwise clamped to [1, 1440].
 * @returns {boolean}
 */
function writeFabricIdentityLockTimeoutMinutes (minutes) {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n)) return false;
  if (n === 0) return writeStorageJSON(STORAGE_KEY, 0);
  const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
  return writeStorageJSON(STORAGE_KEY, clamped);
}

function lockTimeoutMinutesToMs (minutes) {
  if (!minutes || minutes <= 0) return 0;
  return minutes * 60 * 1000;
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  MIN_LOCK_TIMEOUT_MINUTES: MIN_MINUTES,
  MAX_LOCK_TIMEOUT_MINUTES: MAX_MINUTES,
  readFabricIdentityLockTimeoutMinutes,
  writeFabricIdentityLockTimeoutMinutes,
  lockTimeoutMinutesToMs
};
