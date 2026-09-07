'use strict';

/**
 * @fileoverview Caps for Hub in-memory collections. Production Hub OOM (V8
 * mark-compact / heap-limit) retained every Filesystem publish body, every
 * STATE snapshot, and the unbounded Fabric message + Activity maps. Disk
 * files under `messages/` remain the durable log.
 */

const MAX_ACTIVITY_MESSAGES = 256;
const MAX_FABRIC_MESSAGE_LOG = 2048;
const MAX_BITCOIN_BLOCK_TIPS = 256;
const MAX_HUB_STATE_BYTES = 32 * 1024 * 1024;

/**
 * @param {*} row Activity or cached chat entry
 * @returns {number}
 */
function activityTime (row) {
  if (!row || typeof row !== 'object') return 0;
  const created = (row.object && row.object.created) || row.created || 0;
  const t = Date.parse(created);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Keep at most `max` entries, newest `timeOf` first.
 * Returns the same object when already within the cap; otherwise a trimmed copy.
 * @param {Object} map
 * @param {number} max
 * @param {Function} [timeOf]
 * @returns {Object} map
 */
function capMapKeepNewest (map, max, timeOf) {
  if (!map || typeof map !== 'object') return map;
  const limit = (typeof max === 'number' && Number.isFinite(max) && max >= 0) ? Math.floor(max) : 0;
  const stamp = typeof timeOf === 'function' ? timeOf : activityTime;
  const ranked = Object.entries(map);
  if (ranked.length <= limit) return map;
  ranked.sort((left, right) => stamp(right[1]) - stamp(left[1]));
  return Object.fromEntries(ranked.slice(0, limit));
}

/**
 * Keep at most `max` object rows, highest `seq` first.
 * Returns the same object when already within the cap; otherwise a trimmed copy.
 * @param {Object} map
 * @param {number} max
 * @returns {Object} map
 */
function capMapKeepHighestSeq (map, max) {
  if (!map || typeof map !== 'object') return map;
  const limit = (typeof max === 'number' && Number.isFinite(max) && max >= 0) ? Math.floor(max) : 0;
  const ranked = Object.entries(map).filter((pair) => pair[1] && typeof pair[1] === 'object');
  if (ranked.length <= limit) return map;
  ranked.sort((left, right) => Number(left[1].seq || 0) - Number(right[1].seq || 0));
  return Object.fromEntries(ranked.slice(-limit));
}

module.exports = {
  MAX_ACTIVITY_MESSAGES,
  MAX_FABRIC_MESSAGE_LOG,
  MAX_BITCOIN_BLOCK_TIPS,
  MAX_HUB_STATE_BYTES,
  activityTime,
  capMapKeepNewest,
  capMapKeepHighestSeq
};
