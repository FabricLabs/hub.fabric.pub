'use strict';

/**
 * Sidechain logical state: JSON document + monotonic clock, updated by RFC6902-style patches.
 * Federation (or admin fallback) authorizes each transition; {@link contracts/beacon} embeds
 * `{ clock, stateDigest }` into each BEACON_EPOCH payload as the sidechain "head" at that L1 step.
 */

const crypto = require('crypto');
const { applyPatch, validate } = require('fast-json-patch');
const DistributedExecution = require('./fabricDistributedExecution');

const SIDECHAIN_STATE_PATH = 'sidechain/STATE';
/** Full `{ version, clock, content }` keyed by **beacon epoch** `payload.clock` for L1 reorg rewind. */
const SIDECHAIN_SNAPSHOTS_PATH = 'sidechain/SNAPSHOTS';
const SIDECHAIN_PATCH_KIND = 'SidechainStatePatch';

function stablePatchBody (basisClock, basisDigest, patches) {
  return DistributedExecution.stableStringify({
    version: 1,
    kind: SIDECHAIN_PATCH_KIND,
    basisClock: Number(basisClock),
    basisDigest: String(basisDigest || ''),
    patches: DistributedExecution.jsonSafe(patches)
  });
}

/**
 * UTF-8 string federation members sign (same bytes for all validators).
 * @param {{ basisClock: number, basisDigest: string, patches: object[] }} proposal
 */
function signingStringForSidechainStatePatch (proposal) {
  return stablePatchBody(proposal.basisClock, proposal.basisDigest, proposal.patches);
}

function patchCommitmentDigestHex (proposal) {
  const s = signingStringForSidechainStatePatch(proposal);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

function createInitialState () {
  return { version: 1, clock: 0, content: {} };
}

/**
 * Digest of the full sidechain state (public commitment).
 * @param {{ version?: number, clock: number, content: object }} state
 */
function stateDigest (state) {
  const s = DistributedExecution.stableStringify({
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: DistributedExecution.jsonSafe(state.content || {})
  });
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

function loadState (fs) {
  if (!fs || typeof fs.readFile !== 'function') return createInitialState();
  try {
    const raw = fs.readFile(SIDECHAIN_STATE_PATH);
    if (!raw) return createInitialState();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return createInitialState();
    const clock = Number(parsed.clock) || 0;
    const content = parsed.content && typeof parsed.content === 'object' ? parsed.content : {};
    return { version: Number(parsed.version) || 1, clock, content };
  } catch (_) {
    return createInitialState();
  }
}

async function persistState (fs, state) {
  if (!fs || typeof fs.publish !== 'function') return;
  const doc = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: DistributedExecution.jsonSafe(state.content || {})
  };
  await fs.publish(SIDECHAIN_STATE_PATH, doc);
}

function _cloneState (state) {
  return {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: JSON.parse(JSON.stringify(state.content && typeof state.content === 'object' ? state.content : {}))
  };
}

function loadSnapshotsDoc (fs) {
  if (!fs || typeof fs.readFile !== 'function') return { version: 1, byClock: {} };
  try {
    const raw = fs.readFile(SIDECHAIN_SNAPSHOTS_PATH);
    if (!raw) return { version: 1, byClock: {} };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return { version: 1, byClock: {} };
    const byClock = parsed.byClock && typeof parsed.byClock === 'object' ? parsed.byClock : {};
    return { version: 1, byClock };
  } catch (_) {
    return { version: 1, byClock: {} };
  }
}

/**
 * @param {*} fs Filesystem with readFile
 * @param {number} beaconClock `BEACON_EPOCH` payload.clock
 */
function loadSnapshotForBeaconClock (fs, beaconClock) {
  const doc = loadSnapshotsDoc(fs);
  const key = String(beaconClock);
  const s = doc.byClock[key];
  if (!s || typeof s !== 'object') return null;
  return {
    version: Number(s.version) || 1,
    clock: Number(s.clock) || 0,
    content: s.content && typeof s.content === 'object' ? JSON.parse(JSON.stringify(s.content)) : {}
  };
}

/**
 * Persist a full sidechain state copy for this beacon epoch (sync disk write via Fabric Filesystem).
 * @param {*} fs Filesystem with writeFile
 */
function saveSnapshotForBeaconClockSync (fs, beaconClock, state) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  const key = String(beaconClock);
  if (!key || key === 'undefined') return false;
  const doc = loadSnapshotsDoc(fs);
  doc.byClock[key] = DistributedExecution.jsonSafe(_cloneState(state));
  const body = JSON.stringify(doc, null, 2);
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, body);
}

/**
 * Remove snapshot entries for pruned beacon epochs (after Bitcoin reorg).
 * @param {number[]} removedBeaconClocks
 */
function pruneSnapshotsForRemovedBeaconClocksSync (fs, removedBeaconClocks) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  if (!Array.isArray(removedBeaconClocks) || !removedBeaconClocks.length) return true;
  const doc = loadSnapshotsDoc(fs);
  for (const c of removedBeaconClocks) {
    const k = String(c);
    if (doc.byClock[k]) delete doc.byClock[k];
  }
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, JSON.stringify(doc, null, 2));
}

/**
 * Drop all snapshots with beacon clock strictly greater than `tipBeaconClock` (chain truncated to tip).
 * @param {number} tipBeaconClock
 */
function pruneSnapshotsAfterBeaconClockSync (fs, tipBeaconClock) {
  if (!fs || typeof fs.writeFile !== 'function') return false;
  const doc = loadSnapshotsDoc(fs);
  const tip = Number(tipBeaconClock);
  if (!Number.isFinite(tip)) return true;
  for (const k of Object.keys(doc.byClock)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > tip) delete doc.byClock[k];
  }
  return fs.writeFile(SIDECHAIN_SNAPSHOTS_PATH, JSON.stringify(doc, null, 2));
}

/**
 * @param {object[]} patches RFC6902 operations on `state.content`
 * @returns {{ ok: boolean, state?: object, error?: string, newDigest?: string }}
 */
function applyPatchesToState (state, patches) {
  if (!Array.isArray(patches) || !patches.length) {
    return { ok: false, error: 'patches must be a non-empty array' };
  }
  const verr = validate(patches);
  if (verr) {
    return { ok: false, error: verr.message || String(verr) };
  }
  const basisDigest = stateDigest(state);
  const next = {
    version: state.version != null ? Number(state.version) : 1,
    clock: Number(state.clock) || 0,
    content: JSON.parse(JSON.stringify(state.content || {}))
  };
  try {
    applyPatch(next.content, patches, true, true);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  next.clock = next.clock + 1;
  return { ok: true, state: next, newDigest: stateDigest(next), basisDigest };
}

module.exports = {
  SIDECHAIN_STATE_PATH,
  SIDECHAIN_SNAPSHOTS_PATH,
  SIDECHAIN_PATCH_KIND,
  signingStringForSidechainStatePatch,
  patchCommitmentDigestHex,
  createInitialState,
  stateDigest,
  loadState,
  persistState,
  applyPatchesToState,
  loadSnapshotForBeaconClock,
  saveSnapshotForBeaconClockSync,
  pruneSnapshotsForRemovedBeaconClocksSync,
  pruneSnapshotsAfterBeaconClockSync
};
