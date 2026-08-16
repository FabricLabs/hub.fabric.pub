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
 * Drop oldest keys until `map` has at most `max` entries (newest `timeOf` first).
 * Mutates `map`.
 * @param {Object} map
 * @param {number} max
 * @param {Function} [timeOf]
 * @returns {Object} map
 */
function capMapKeepNewest (map, max, timeOf) {
  if (!map || typeof map !== 'object') return map;
  const limit = (typeof max === 'number' && Number.isFinite(max) && max >= 0) ? Math.floor(max) : 0;
  const stamp = typeof timeOf === 'function' ? timeOf : activityTime;
  const keys = Object.keys(map);
  if (keys.length <= limit) return map;
  keys.sort((a, b) => stamp(map[b]) - stamp(map[a]));
  for (const key of keys.slice(limit)) delete map[key];
  return map;
}

/**
 * Drop lowest-`seq` entries until `map` has at most `max` objects.
 * Mutates `map`.
 * @param {Object} map
 * @param {number} max
 * @returns {Object} map
 */
function capMapKeepHighestSeq (map, max) {
  if (!map || typeof map !== 'object') return map;
  const limit = (typeof max === 'number' && Number.isFinite(max) && max >= 0) ? Math.floor(max) : 0;
  const entries = Object.values(map).filter((item) => item && typeof item === 'object');
  if (entries.length <= limit) return map;
  entries.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  const keep = new Set(entries.slice(-limit));
  for (const key of Object.keys(map)) {
    if (!keep.has(map[key])) delete map[key];
  }
  return map;
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
