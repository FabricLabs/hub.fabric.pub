'use strict';

/**
 * Tracked application contracts — CONTRACT_PUBLISH offers accepted by the Hub
 * operator into the local Beacon Federation view.
 *
 * The Beacon epoch seals `contracts.stateRoot` (digest of accepted contract ids
 * + their latest state digests). That is the federation-facing “state root of
 * published contracts”, distinct from ad-hoc sidechain app payloads until an
 * operator accepts the namespace.
 *
 * Persistence: Fabric Filesystem document `application-contracts/STATE`.
 */

const crypto = require('crypto');

const STORE_PATH = 'application-contracts/STATE';
const SCHEMA_VERSION = 1;

function sha256hex (s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

function emptyState () {
  return {
    version: SCHEMA_VERSION,
    clock: 0,
    pending: {},
    accepted: {},
    stateRoot: emptyRoot(),
    updatedAt: null
  };
}

function emptyRoot () {
  return sha256hex(canonicalStringify({ version: SCHEMA_VERSION, contracts: [] }));
}

/**
 * @param {object} state
 * @returns {string}
 */
function computeStateRoot (state) {
  const accepted = (state && state.accepted) || {};
  const rows = Object.keys(accepted).sort().map((id) => {
    const c = accepted[id] || {};
    return {
      contractId: id,
      definitionDigest: c.definitionDigest || null,
      stateDigest: c.stateDigest || c.definitionDigest || null,
      name: c.name || null,
      version: c.version != null ? c.version : null
    };
  });
  return sha256hex(canonicalStringify({ version: SCHEMA_VERSION, contracts: rows }));
}

function definitionDigestOf (definition) {
  if (!definition || typeof definition !== 'object') return null;
  return sha256hex(canonicalStringify(definition));
}

/**
 * @param {object|null} fs Fabric Filesystem-like { readFile, writeFile, publish? }
 * @returns {object}
 */
function loadState (fs) {
  if (!fs || typeof fs.readFile !== 'function') return emptyState();
  try {
    const raw = fs.readFile(STORE_PATH);
    if (raw == null) return emptyState();
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const state = Object.assign(emptyState(), parsed);
    state.pending = (parsed.pending && typeof parsed.pending === 'object') ? parsed.pending : {};
    state.accepted = (parsed.accepted && typeof parsed.accepted === 'object') ? parsed.accepted : {};
    state.stateRoot = computeStateRoot(state);
    return state;
  } catch (_) {
    return emptyState();
  }
}

/**
 * @param {object} fs
 * @param {object} state
 */
async function persistState (fs, state) {
  if (!fs) return false;
  const next = Object.assign({}, state, {
    stateRoot: computeStateRoot(state),
    updatedAt: new Date().toISOString()
  });
  const payload = JSON.stringify(next);
  if (typeof fs.publish === 'function') {
    await fs.publish(STORE_PATH, next);
  } else if (typeof fs.writeFile === 'function') {
    fs.writeFile(STORE_PATH, payload);
  }
  state.stateRoot = next.stateRoot;
  state.updatedAt = next.updatedAt;
  return true;
}

/**
 * Record an inbound CONTRACT_PUBLISH (pending until operator accepts).
 * @returns {{ created: boolean, entry: object }}
 */
function recordPublish (state, { contractId, definition, signer = null, origin = null } = {}) {
  const id = String(contractId || '').trim();
  if (!id) throw new Error('contractId required');
  if (state.accepted[id]) {
    return { created: false, entry: state.accepted[id], status: 'accepted' };
  }
  const def = definition && typeof definition === 'object' ? definition : {};
  const entry = {
    contractId: id,
    name: def.name || null,
    version: def.version != null ? def.version : null,
    definition: def,
    definitionDigest: definitionDigestOf(def),
    stateDigest: definitionDigestOf(def),
    signer: signer ? String(signer) : null,
    origin: origin ? String(origin) : null,
    receivedAt: new Date().toISOString(),
    status: 'pending'
  };
  const existed = !!state.pending[id];
  state.pending[id] = entry;
  state.clock = (Number(state.clock) || 0) + 1;
  return { created: !existed, entry, status: 'pending' };
}

/**
 * Accept a pending publish into the Beacon-tracked set.
 */
function acceptContract (state, contractId, { acceptedBy = null } = {}) {
  const id = String(contractId || '').trim();
  const pending = state.pending[id];
  const existing = state.accepted[id];
  const base = pending || existing;
  if (!base) throw Object.assign(new Error('unknown contract publish'), { code: 'NOT_FOUND' });
  delete state.pending[id];
  const entry = Object.assign({}, base, {
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    acceptedBy: acceptedBy ? String(acceptedBy) : null,
    stateDigest: base.stateDigest || base.definitionDigest || null
  });
  state.accepted[id] = entry;
  state.clock = (Number(state.clock) || 0) + 1;
  state.stateRoot = computeStateRoot(state);
  return entry;
}

function rejectContract (state, contractId, { rejectedBy = null } = {}) {
  const id = String(contractId || '').trim();
  if (!state.pending[id] && !state.accepted[id]) {
    throw Object.assign(new Error('unknown contract publish'), { code: 'NOT_FOUND' });
  }
  delete state.pending[id];
  delete state.accepted[id];
  state.clock = (Number(state.clock) || 0) + 1;
  state.stateRoot = computeStateRoot(state);
  return {
    contractId: id,
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedBy: rejectedBy ? String(rejectedBy) : null
  };
}

/**
 * Update the latest state digest for an accepted application contract
 * (e.g. after GoonCitizen sidechain `/gooncitizen` snapshot changes).
 */
function updateContractStateDigest (state, contractId, stateDigest) {
  const id = String(contractId || '').trim();
  const entry = state.accepted[id];
  if (!entry) return null;
  const dig = stateDigest != null ? String(stateDigest) : null;
  if (entry.stateDigest === dig) return entry;
  entry.stateDigest = dig;
  entry.stateUpdatedAt = new Date().toISOString();
  state.clock = (Number(state.clock) || 0) + 1;
  state.stateRoot = computeStateRoot(state);
  return entry;
}

function summarize (state) {
  const pending = Object.values(state.pending || {});
  const accepted = Object.values(state.accepted || {});
  return {
    type: 'TrackedApplicationContracts',
    version: state.version,
    clock: Number(state.clock) || 0,
    stateRoot: state.stateRoot || computeStateRoot(state),
    pendingCount: pending.length,
    acceptedCount: accepted.length,
    pending: pending.map((e) => ({
      contractId: e.contractId,
      name: e.name,
      version: e.version,
      definitionDigest: e.definitionDigest,
      signer: e.signer,
      receivedAt: e.receivedAt,
      status: 'pending'
    })),
    accepted: accepted.map((e) => ({
      contractId: e.contractId,
      name: e.name,
      version: e.version,
      definitionDigest: e.definitionDigest,
      stateDigest: e.stateDigest,
      acceptedAt: e.acceptedAt,
      status: 'accepted'
    })),
    updatedAt: state.updatedAt || null
  };
}

/** Snapshot for Beacon epoch payloads. */
function beaconSnapshot (state) {
  const root = (state && state.stateRoot) || computeStateRoot(state || emptyState());
  return {
    clock: Number(state && state.clock) || 0,
    stateDigest: root,
    kind: 'TrackedApplicationContracts',
    acceptedCount: Object.keys((state && state.accepted) || {}).length
  };
}

module.exports = {
  STORE_PATH,
  SCHEMA_VERSION,
  emptyState,
  emptyRoot,
  computeStateRoot,
  definitionDigestOf,
  loadState,
  persistState,
  recordPublish,
  acceptContract,
  rejectContract,
  updateContractStateDigest,
  summarize,
  beaconSnapshot,
  canonicalStringify
};
