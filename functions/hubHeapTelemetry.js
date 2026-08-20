'use strict';

/**
 * @fileoverview Periodic Hub heap / retainer telemetry for operator logs.
 * Log-only: does not truncate durable `messages/`, documents, or STATE, so
 * full replay stays intact. Agents parse single-line `[HUB:HEAP] {json}`.
 */

const v8 = require('v8');
const hubHeapBounds = require('./hubHeapBounds');

const LOG_PREFIX = '[HUB:HEAP]';
/** Default cadence matches Beacon regtest interval (10 minutes). */
const DEFAULT_INTERVAL_MS = 600000;
const MIN_INTERVAL_MS = 60000;

/**
 * @param {*} map
 * @returns {number}
 */
function mapSize (map) {
  if (!map || typeof map !== 'object') return 0;
  return Object.keys(map).length;
}

/**
 * @param {object} [settings]
 * @param {object} [env]
 * @returns {boolean}
 */
function isHeapTelemetryEnabled (settings, env) {
  const e = env || process.env;
  if (e.FABRIC_HUB_HEAP_TELEMETRY === '0' || e.FABRIC_HUB_HEAP_TELEMETRY === 'false') return false;
  const cfg = settings && settings.heapTelemetry;
  if (cfg && cfg.enable === false) return false;
  return true;
}

/**
 * Prefer settings / env; otherwise Beacon interval when positive; else 10 min.
 * Floor at 60s so we never spam like the 2s work-queue timer.
 * @param {object} [settings]
 * @param {object} [env]
 * @returns {number}
 */
function resolveHeapTelemetryIntervalMs (settings, env) {
  const e = env || process.env;
  const rawEnv = e.FABRIC_HUB_HEAP_TELEMETRY_MS;
  if (rawEnv != null && String(rawEnv).trim() !== '') {
    const n = Number(rawEnv);
    if (Number.isFinite(n) && n > 0) return Math.max(MIN_INTERVAL_MS, Math.floor(n));
  }
  const cfg = settings && settings.heapTelemetry;
  if (cfg && cfg.intervalMs != null) {
    const n = Number(cfg.intervalMs);
    if (Number.isFinite(n) && n > 0) return Math.max(MIN_INTERVAL_MS, Math.floor(n));
  }
  const beaconMs = settings && settings.beacon && Number(settings.beacon.interval);
  if (Number.isFinite(beaconMs) && beaconMs > 0) {
    return Math.max(MIN_INTERVAL_MS, Math.floor(beaconMs));
  }
  return DEFAULT_INTERVAL_MS;
}

/**
 * Cheap retainer-oriented counts from a live Hub (or stub). No disk I/O.
 * Does not JSON.stringify STATE — callers should pass last commit byte length.
 * @param {object} hub
 * @param {object} [opts]
 * @param {number} [opts.stateContentBytes] Last commit `STATE` UTF-8 length
 * @returns {object}
 */
function collectHubHeapTelemetry (hub, opts = {}) {
  const mem = process.memoryUsage();
  let heapStats = null;
  try {
    heapStats = v8.getHeapStatistics();
  } catch (_) {
    heapStats = null;
  }

  const content = (hub && hub._state && hub._state.content) || {};
  const collections = content.collections || {};
  const chain = content.chain || {};
  const fsState = hub && hub.fs && hub.fs._state;
  const agent = hub && hub.agent;
  const http = hub && hub.http;

  const peerConnections = agent && agent.connections && typeof agent.connections === 'object'
    ? Object.keys(agent.connections).length
    : 0;
  const webrtcPeers = http && http.webrtcPeers && typeof http.webrtcPeers.size === 'number'
    ? http.webrtcPeers.size
    : (Array.isArray(http && http.webrtcPeerList) ? http.webrtcPeerList.length : 0);

  const bitcoinTips = hub && hub._bitcoinBlockTips && typeof hub._bitcoinBlockTips.size === 'number'
    ? hub._bitcoinBlockTips.size
    : 0;

  const sidechain = hub && hub._sidechainState;
  const sidechainClock = sidechain && Number.isFinite(Number(sidechain.clock))
    ? Number(sidechain.clock)
    : null;

  const stateContentBytes = opts.stateContentBytes != null
    ? Number(opts.stateContentBytes)
    : (hub && hub._lastStateWriteBytes != null ? Number(hub._lastStateWriteBytes) : null);

  return {
    at: new Date().toISOString(),
    pid: process.pid,
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rss: Number(mem.rss || 0),
      heapUsed: Number(mem.heapUsed || 0),
      heapTotal: Number(mem.heapTotal || 0),
      external: Number(mem.external || 0),
      arrayBuffers: Number(mem.arrayBuffers || 0)
    },
    heap: heapStats ? {
      totalHeapSize: Number(heapStats.total_heap_size || 0),
      usedHeapSize: Number(heapStats.used_heap_size || 0),
      heapSizeLimit: Number(heapStats.heap_size_limit || 0),
      totalAvailableSize: Number(heapStats.total_available_size || 0),
      mallocedMemory: Number(heapStats.malloced_memory || 0),
      peakMallocedMemory: Number(heapStats.peak_malloced_memory || 0),
      numberOfNativeContexts: Number(heapStats.number_of_native_contexts || 0)
    } : null,
    retainers: {
      activityMessages: mapSize(hub && hub._state && hub._state.messages),
      fabricMessages: mapSize(collections.messages),
      documentsIndex: mapSize(hub && hub._state && hub._state.documents),
      documentsPublished: mapSize(collections.documents),
      documentOffers: mapSize(collections.documentoffers),
      chainHistory: mapSize(collections.chain),
      contracts: mapSize(collections.contracts),
      chainMessageIds: Array.isArray(chain.messages) ? chain.messages.length : 0,
      filesystemBodyCache: mapSize(fsState && fsState.documents),
      filesystemActors: mapSize(fsState && fsState.actors),
      bitcoinBlockTips: bitcoinTips,
      peerConnections,
      webrtcPeers,
      workQueue: Array.isArray(hub && hub._workQueue) ? hub._workQueue.length : 0,
      inventoryHtlc: hub && hub._inventoryHtlcById && typeof hub._inventoryHtlcById.size === 'number'
        ? hub._inventoryHtlcById.size
        : 0,
      sidechainClock,
      stateContentBytes: Number.isFinite(stateContentBytes) ? stateContentBytes : null
    },
    caps: {
      activityMessages: hubHeapBounds.MAX_ACTIVITY_MESSAGES,
      fabricMessages: hubHeapBounds.MAX_FABRIC_MESSAGE_LOG,
      bitcoinBlockTips: hubHeapBounds.MAX_BITCOIN_BLOCK_TIPS,
      stateRestoreBytes: hubHeapBounds.MAX_HUB_STATE_BYTES
    },
    replay: {
      durableMessageLogOnDisk: true,
      telemetryMutatesState: false,
      note: 'Log-only snapshot; messages/ STATE documents remain for full replay'
    }
  };
}

/**
 * @param {object} snapshot
 * @returns {string}
 */
function formatHubHeapTelemetryLine (snapshot) {
  return `${LOG_PREFIX} ${JSON.stringify(snapshot)}`;
}

/**
 * Build + log one line. Safe to call from timers.
 * @param {object} hub
 * @param {object} [opts]
 * @returns {object|null} snapshot or null on failure
 */
function logHubHeapTelemetry (hub, opts) {
  try {
    const snap = collectHubHeapTelemetry(hub, opts);
    console.log(formatHubHeapTelemetryLine(snap));
    return snap;
  } catch (err) {
    console.warn(
      LOG_PREFIX,
      'report failed:',
      err && err.message ? err.message : err
    );
    return null;
  }
}

module.exports = {
  LOG_PREFIX,
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  isHeapTelemetryEnabled,
  resolveHeapTelemetryIntervalMs,
  collectHubHeapTelemetry,
  formatHubHeapTelemetryLine,
  logHubHeapTelemetry,
  mapSize
};
