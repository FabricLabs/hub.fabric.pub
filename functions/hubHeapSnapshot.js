'use strict';

/**
 * @fileoverview On-demand and threshold V8 heap snapshots for leak hunting.
 * A snapshot pauses the process while it is written and briefly needs about
 * as much memory again as the heap; open the `.heapsnapshot` in Chrome
 * DevTools (Memory tab) and compare two of them.
 */

const fs = require('fs');
const path = require('path');
const v8 = require('v8');

const LOG_PREFIX = '[HUB:HEAP]';
const DEFAULT_SIGNAL = 'SIGUSR2';
const DEFAULT_MAX_SNAPSHOTS = 3;

/**
 * @param {object} [settings] Hub settings (`heapSnapshot`)
 * @param {object} [env]
 * @returns {{ signal: string|null, thresholdBytes: number, max: number }}
 */
function resolveHeapSnapshotSettings (settings, env) {
  const e = env || process.env;
  const cfg = (settings && settings.heapSnapshot) || {};
  const rawSignal = e.FABRIC_HUB_HEAP_SNAPSHOT_SIGNAL != null ? e.FABRIC_HUB_HEAP_SNAPSHOT_SIGNAL : cfg.signal;
  const signal = rawSignal === '0' || rawSignal === false || rawSignal === 'false'
    ? null
    : String(rawSignal || DEFAULT_SIGNAL);
  const mb = Number(e.FABRIC_HUB_HEAP_SNAPSHOT_MB != null ? e.FABRIC_HUB_HEAP_SNAPSHOT_MB : cfg.thresholdMb);
  const max = Number(e.FABRIC_HUB_HEAP_SNAPSHOT_MAX != null ? e.FABRIC_HUB_HEAP_SNAPSHOT_MAX : cfg.max);
  return {
    signal,
    thresholdBytes: Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 0,
    max: Number.isFinite(max) && max >= 0 ? Math.floor(max) : DEFAULT_MAX_SNAPSHOTS
  };
}

/**
 * Write one snapshot under `dir`.
 * @param {string} dir
 * @param {string} reason Short label in the file name (`signal`, `threshold`)
 * @returns {string|null} file path, or null on failure
 */
function writeHeapSnapshot (dir, reason) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `hub-${process.pid}-${stamp}-${reason}.heapsnapshot`);
    const started = Date.now();
    v8.writeHeapSnapshot(file);
    console.log(LOG_PREFIX, `snapshot (${reason}) written in ${Date.now() - started} ms: ${file}`);
    return file;
  } catch (err) {
    console.warn(LOG_PREFIX, 'snapshot failed:', err && err.message ? err.message : err);
    return null;
  }
}

/**
 * Tracks the heap threshold: each snapshot doubles the next threshold, up to `max` snapshots.
 * @param {{ thresholdBytes: number, max: number }} cfg
 * @returns {{ check: Function, taken: Function }}
 */
function createHeapThreshold (cfg) {
  let next = cfg.thresholdBytes;
  let taken = 0;
  return {
    /**
     * @param {number} heapUsed
     * @returns {boolean} true when a snapshot is due now
     */
    check (heapUsed) {
      if (!(next > 0) || taken >= cfg.max || !(heapUsed >= next)) return false;
      taken++;
      while (next <= heapUsed) next *= 2;
      return true;
    },
    taken () {
      return taken;
    }
  };
}

module.exports = {
  DEFAULT_SIGNAL,
  DEFAULT_MAX_SNAPSHOTS,
  resolveHeapSnapshotSettings,
  writeHeapSnapshot,
  createHeapThreshold
};
