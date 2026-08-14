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
 * On record/accept, definitions are normalized into an ARC view
 * (`arc` / optional `spend`) via `@fabric/core` `normalizeArcGenesis` +
 * `resolveSpend` when available (RC deploy path for hub.fabric.pub).
 *
 * Persistence: Fabric Filesystem document `application-contracts/STATE`.
 */

const crypto = require('crypto');

const STORE_PATH = 'application-contracts/STATE';
const SCHEMA_VERSION = 1;

let _contractSpend = null;
function contractSpend () {
  if (_contractSpend !== null) return _contractSpend;
  try {
    _contractSpend = require('@fabric/core/functions/contractSpend');
  } catch (_) {
    _contractSpend = false;
  }
  return _contractSpend;
}

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
 * Attach ARC-normalized fields without mutating the published definition bytes.
 * @param {object} definition
 * @param {object} [opts]
 * @returns {{ arc: object|null, spendAddress: string|null, bitcoinAnchor: object|null }}
 */
function enrichArcFields (definition, opts = {}) {
  const cs = contractSpend();
  if (!cs || typeof cs.normalizeArcGenesis !== 'function') {
    return { arc: null, spendAddress: null, bitcoinAnchor: null };
  }
  const arc = cs.normalizeArcGenesis(definition || {});
  let bitcoinAnchor = arc.bitcoinAnchor;
  if (opts.bitcoinBlockHash) {
    bitcoinAnchor = {
      blockHash: String(opts.bitcoinBlockHash).trim().toLowerCase(),
      height: opts.bitcoinHeight != null ? Number(opts.bitcoinHeight) : (bitcoinAnchor && bitcoinAnchor.height)
    };
  }
  if (bitcoinAnchor) arc.bitcoinAnchor = bitcoinAnchor;

  let spendAddress = null;
  try {
    if (arc.members.signers.length || (arc.spendPolicy.validators && arc.spendPolicy.validators.length)) {
      const tip = {
        contractId: opts.contractId || null,
        content: {
          signers: (arc.members.signers || []).map((p) => String(p).replace(/^0[23]/i, '')),
          members: (arc.members.signers || []).map((p) => String(p).replace(/^0[23]/i, '')),
          threshold: arc.members.threshold
        },
        stateDigest: opts.stateDigest || definitionDigestOf(definition),
        bitcoinBlockHash: bitcoinAnchor && bitcoinAnchor.blockHash,
        bitcoinHeight: bitcoinAnchor && bitcoinAnchor.height,
        bitcoinAnchor
      };
      const spend = cs.resolveSpend({
        genesis: arc,
        tip,
        contractId: opts.contractId,
        overrides: opts.network ? { network: opts.network } : undefined
      });
      spendAddress = spend.spendAddress || spend.address || null;
      if (spend.bitcoinAnchor) bitcoinAnchor = spend.bitcoinAnchor;
    }
  } catch (_) {
    spendAddress = null;
  }
  return { arc, spendAddress, bitcoinAnchor };
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
 * Reject object-prototype keys used as map indices.
 * @param {*} id
 * @returns {string}
 */
function assertSafeContractId (id) {
  const s = String(id || '').trim();
  if (!s) throw new Error('contractId required');
  if (s === '__proto__' || s === 'constructor' || s === 'prototype') {
    throw Object.assign(new Error('invalid contractId'), { code: 'INVALID_ID' });
  }
  return s;
}

/**
 * Record an inbound CONTRACT_PUBLISH (pending until operator accepts).
 * @returns {{ created: boolean, entry: object }}
 */
function recordPublish (state, {
  contractId,
  definition,
  signer = null,
  origin = null,
  bitcoinBlockHash = null,
  bitcoinHeight = null,
  network = null
} = {}) {
  const id = assertSafeContractId(contractId);
  if (Object.prototype.hasOwnProperty.call(state.accepted, id) && state.accepted[id]) {
    return { created: false, entry: state.accepted[id], status: 'accepted' };
  }
  const existingPending = Object.prototype.hasOwnProperty.call(state.pending, id)
    ? state.pending[id]
    : null;
  if (existingPending) {
    const nextSigner = signer ? String(signer) : null;
    const nextOrigin = origin ? String(origin) : null;
    const sameSigner = (existingPending.signer || null) === nextSigner;
    const sameOrigin = (existingPending.origin || null) === nextOrigin;
    const nextDef = definition && typeof definition === 'object' ? definition : {};
    const nextDigest = definitionDigestOf(nextDef);
    if (!sameSigner || !sameOrigin || existingPending.definitionDigest !== nextDigest) {
      throw Object.assign(
        new Error('pending contractId already claimed by a different publish'),
        { code: 'CONFLICT' }
      );
    }
    return { created: false, entry: existingPending, status: 'pending' };
  }
  const def = definition && typeof definition === 'object' ? definition : {};
  const enriched = enrichArcFields(def, {
    contractId: id,
    bitcoinBlockHash,
    bitcoinHeight,
    network: network || undefined
  });
  const entry = {
    contractId: id,
    name: def.name || (enriched.arc && enriched.arc.name) || null,
    version: def.version != null ? def.version : (enriched.arc && enriched.arc.version),
    definition: def,
    definitionDigest: definitionDigestOf(def),
    stateDigest: definitionDigestOf(def),
    signer: signer ? String(signer) : null,
    origin: origin ? String(origin) : null,
    receivedAt: new Date().toISOString(),
    status: 'pending',
    arc: enriched.arc,
    spendAddress: enriched.spendAddress,
    bitcoinAnchor: enriched.bitcoinAnchor
  };
  state.pending[id] = entry;
  state.clock = (Number(state.clock) || 0) + 1;
  return { created: true, entry, status: 'pending' };
}

/**
 * Accept a pending publish into the Beacon-tracked set.
 * @param {object} state
 * @param {string} contractId
 * @param {{ acceptedBy?: string, bitcoinBlockHash?: string, bitcoinHeight?: number, network?: string }} [opts]
 */
function acceptContract (state, contractId, {
  acceptedBy = null,
  bitcoinBlockHash = null,
  bitcoinHeight = null,
  network = null
} = {}) {
  const id = assertSafeContractId(contractId);
  const pending = Object.prototype.hasOwnProperty.call(state.pending, id) ? state.pending[id] : null;
  const existing = Object.prototype.hasOwnProperty.call(state.accepted, id) ? state.accepted[id] : null;
  const base = pending || existing;
  if (!base) throw Object.assign(new Error('unknown contract publish'), { code: 'NOT_FOUND' });
  delete state.pending[id];

  const enriched = enrichArcFields(base.definition || {}, {
    contractId: id,
    stateDigest: base.stateDigest || base.definitionDigest,
    bitcoinBlockHash: bitcoinBlockHash
      || (base.bitcoinAnchor && base.bitcoinAnchor.blockHash)
      || null,
    bitcoinHeight: bitcoinHeight != null
      ? bitcoinHeight
      : (base.bitcoinAnchor && base.bitcoinAnchor.height),
    network: network || undefined
  });

  const entry = Object.assign({}, base, {
    status: 'accepted',
    acceptedAt: new Date().toISOString(),
    acceptedBy: acceptedBy ? String(acceptedBy) : null,
    stateDigest: base.stateDigest || base.definitionDigest || null,
    arc: enriched.arc || base.arc || null,
    spendAddress: enriched.spendAddress || base.spendAddress || null,
    bitcoinAnchor: enriched.bitcoinAnchor || base.bitcoinAnchor || null
  });
  state.accepted[id] = entry;
  state.clock = (Number(state.clock) || 0) + 1;
  state.stateRoot = computeStateRoot(state);
  return entry;
}

function rejectContract (state, contractId, { rejectedBy = null } = {}) {
  const id = assertSafeContractId(contractId);
  const hasPending = Object.prototype.hasOwnProperty.call(state.pending, id) && state.pending[id];
  const hasAccepted = Object.prototype.hasOwnProperty.call(state.accepted, id) && state.accepted[id];
  if (!hasPending && !hasAccepted) {
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
 * (e.g. after an RSI service snapshot at `/services/rsi` changes).
 */
function updateContractStateDigest (state, contractId, stateDigest) {
  const id = assertSafeContractId(contractId);
  const entry = Object.prototype.hasOwnProperty.call(state.accepted, id) ? state.accepted[id] : null;
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
      status: 'pending',
      spendAddress: e.spendAddress || null,
      bitcoinAnchor: e.bitcoinAnchor || null,
      bitcoinBlockHash: (e.bitcoinAnchor && e.bitcoinAnchor.blockHash) || null,
      spendPolicy: (e.arc && e.arc.spendPolicy) || null,
      primitives: (e.arc && e.arc.primitives) || null
    })),
    accepted: accepted.map((e) => ({
      contractId: e.contractId,
      name: e.name,
      version: e.version,
      definitionDigest: e.definitionDigest,
      stateDigest: e.stateDigest,
      acceptedAt: e.acceptedAt,
      status: 'accepted',
      spendAddress: e.spendAddress || null,
      bitcoinAnchor: e.bitcoinAnchor || null,
      bitcoinBlockHash: (e.bitcoinAnchor && e.bitcoinAnchor.blockHash) || null,
      spendPolicy: (e.arc && e.arc.spendPolicy) || null,
      primitives: (e.arc && e.arc.primitives) || null
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

/**
 * Recompute ARC overlays (`spendAddress`, tip `bitcoinAnchor`) for accepted
 * contracts after a Bitcoin network bind/promotion. Does not bump clock or
 * `stateRoot` (Actor ids and sealed digests stay stable).
 *
 * @param {object} state
 * @param {{ bitcoinBlockHash?: string|null, bitcoinHeight?: number|null, network?: string|null }} [opts]
 * @returns {{ changed: number, contractIds: string[] }}
 */
function reEnrichAccepted (state, opts = {}) {
  const changedIds = [];
  const accepted = (state && state.accepted) || {};
  for (const id of Object.keys(accepted)) {
    const entry = accepted[id];
    if (!entry) continue;
    const enriched = enrichArcFields(entry.definition || {}, {
      contractId: id,
      stateDigest: entry.stateDigest || entry.definitionDigest,
      bitcoinBlockHash: opts.bitcoinBlockHash
        || (entry.bitcoinAnchor && entry.bitcoinAnchor.blockHash)
        || null,
      bitcoinHeight: opts.bitcoinHeight != null
        ? opts.bitcoinHeight
        : (entry.bitcoinAnchor && entry.bitcoinAnchor.height),
      network: opts.network || undefined
    });
    const prevSpend = entry.spendAddress || null;
    const prevAnchor = entry.bitcoinAnchor && entry.bitcoinAnchor.blockHash
      ? String(entry.bitcoinAnchor.blockHash)
      : null;
    const nextAnchor = enriched.bitcoinAnchor && enriched.bitcoinAnchor.blockHash
      ? String(enriched.bitcoinAnchor.blockHash)
      : null;
    entry.arc = enriched.arc || entry.arc || null;
    entry.spendAddress = enriched.spendAddress || null;
    entry.bitcoinAnchor = enriched.bitcoinAnchor || entry.bitcoinAnchor || null;
    if (prevSpend !== entry.spendAddress || prevAnchor !== nextAnchor) {
      changedIds.push(id);
    }
  }
  return { changed: changedIds.length, contractIds: changedIds };
}

module.exports = {
  STORE_PATH,
  SCHEMA_VERSION,
  emptyState,
  emptyRoot,
  computeStateRoot,
  definitionDigestOf,
  enrichArcFields,
  loadState,
  persistState,
  recordPublish,
  acceptContract,
  rejectContract,
  updateContractStateDigest,
  reEnrichAccepted,
  summarize,
  beaconSnapshot,
  canonicalStringify
};
