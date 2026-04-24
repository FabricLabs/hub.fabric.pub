'use strict';

/**
 * Node-local federation data on the Fabric {@link Filesystem}:
 * - `federations/REGISTRY` — catalog (seeded from settings + OP_RETURN `fabfed` discoveries on L1)
 * - `federations/POLICY_SNAPSHOT` — mirror of operator validator policy for recovery / tooling
 *
 * Operator signing policy remains env → `setup` store → settings; the snapshot is written on every
 * change and can re-hydrate `setup` when the JSON setting is absent (e.g. fresh stores dir).
 */

const REGISTRY_PATH = 'federations/REGISTRY';
const POLICY_SNAPSHOT_PATH = 'federations/POLICY_SNAPSHOT';

/** ASCII `fabfed` inside OP_RETURN push data (hex, lowercase). */
const DISCOVER_MAGIC_HEX = Buffer.from('fabfed', 'utf8').toString('hex');

function _safeJson (x) {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch (_) {
    return {};
  }
}

function createEmptyRegistry () {
  return {
    version: 1,
    entries: [],
    lastScannedHeight: null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * @param {*} fs
 * @returns {{ version: number, entries: object[], lastScannedHeight: number|null, updatedAt: string }}
 */
function loadRegistry (fs) {
  if (!fs || typeof fs.readFile !== 'function') return createEmptyRegistry();
  try {
    const raw = fs.readFile(REGISTRY_PATH);
    if (!raw) return createEmptyRegistry();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return createEmptyRegistry();
    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter((e) => e && typeof e === 'object') : [];
    return {
      version: Number(parsed.version) || 1,
      entries,
      lastScannedHeight: parsed.lastScannedHeight != null && Number.isFinite(Number(parsed.lastScannedHeight))
        ? Number(parsed.lastScannedHeight)
        : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    };
  } catch (_) {
    return createEmptyRegistry();
  }
}

/**
 * @param {*} fs
 * @returns {{ validators: string[], threshold: number, source?: string, updatedAt?: string }|null}
 */
function loadPolicySnapshot (fs) {
  if (!fs || typeof fs.readFile !== 'function') return null;
  try {
    const raw = fs.readFile(POLICY_SNAPSHOT_PATH);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const validators = Array.isArray(parsed.validators)
      ? parsed.validators.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    const threshold = Math.max(1, Number(parsed.threshold) || 1);
    return {
      validators,
      threshold,
      source: typeof parsed.source === 'string' ? parsed.source : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined
    };
  } catch (_) {
    return null;
  }
}

/**
 * @param {*} fs
 * @param {{ validators: string[], threshold: number, source?: string }} policy
 */
async function persistPolicySnapshot (fs, policy) {
  if (!fs || typeof fs.publish !== 'function') return;
  const validators = Array.isArray(policy.validators)
    ? policy.validators.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  let threshold = Math.max(1, Number(policy.threshold) || 1);
  if (validators.length && threshold > validators.length) threshold = validators.length;
  const doc = {
    version: 1,
    validators: validators.slice(),
    threshold,
    source: policy.source != null ? String(policy.source) : undefined,
    updatedAt: new Date().toISOString()
  };
  await fs.publish(POLICY_SNAPSHOT_PATH, doc);
}

/**
 * @param {*} fs
 * @param {object} doc
 */
async function persistRegistry (fs, doc) {
  if (!fs || typeof fs.publish !== 'function') return;
  const out = {
    version: Number(doc.version) || 1,
    entries: Array.isArray(doc.entries) ? _safeJson(doc.entries) : [],
    lastScannedHeight: doc.lastScannedHeight != null && Number.isFinite(Number(doc.lastScannedHeight))
      ? Number(doc.lastScannedHeight)
      : null,
    updatedAt: new Date().toISOString()
  };
  await fs.publish(REGISTRY_PATH, out);
}

/**
 * Merge static `settings.federations` entries (id/name/kind) into the registry if missing.
 * @param {*} fs
 * @param {object[]} configFederations
 */
async function seedRegistryFromSettings (fs, configFederations) {
  const reg = loadRegistry(fs);
  const existingIds = new Set(reg.entries.map((e) => e && e.id != null ? String(e.id) : '').filter(Boolean));
  const list = Array.isArray(configFederations) ? configFederations : [];
  let added = false;
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const id = f.id != null ? String(f.id).trim() : '';
    if (!id || existingIds.has(id)) continue;
    reg.entries.push({
      id,
      name: f.name != null ? String(f.name) : id,
      kind: f.kind != null ? String(f.kind) : 'reference',
      source: 'settings',
      seededAt: new Date().toISOString()
    });
    existingIds.add(id);
    added = true;
  }
  if (added) await persistRegistry(fs, reg);
}

/**
 * Parse `fabfed` + UTF-8 JSON from a Bitcoin Core `scriptPubKey` nulldata output.
 * Expected JSON: `{ "fabricFederation": { "id", "name?", "kind?" } }`
 * @param {object} spk - vout.scriptPubKey
 * @returns {object|null}
 */
function parseFabricFederationOpReturn (spk) {
  if (!spk || typeof spk !== 'object') return null;
  if (spk.type !== 'nulldata') return null;
  const asm = typeof spk.asm === 'string' ? spk.asm.trim() : '';
  let buf = null;
  if (asm.startsWith('OP_RETURN ')) {
    const dataHex = asm.slice('OP_RETURN '.length).replace(/\s+/g, '');
    if (/^[0-9a-fA-F]+$/.test(dataHex) && dataHex.length % 2 === 0) {
      try {
        buf = Buffer.from(dataHex, 'hex');
      } catch (_) {
        buf = null;
      }
    }
  }
  if (!buf && typeof spk.hex === 'string') {
    const hex = spk.hex.toLowerCase().replace(/^0x/, '');
    const idx = hex.indexOf(DISCOVER_MAGIC_HEX);
    if (idx >= 0 && (idx % 2 === 0)) {
      try {
        buf = Buffer.from(hex.slice(idx), 'hex');
      } catch (_) {
        buf = null;
      }
    }
  }
  if (!buf || buf.length < 6) return null;
  const magic = Buffer.from('fabfed', 'utf8');
  if (!buf.subarray(0, magic.length).equals(magic)) return null;
  let jsonStr = buf.subarray(magic.length).toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!jsonStr) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const inner = obj && typeof obj.fabricFederation === 'object' ? obj.fabricFederation : null;
    if (!inner || inner.id == null) return null;
    return {
      id: String(inner.id).trim(),
      name: inner.name != null ? String(inner.name).trim() : String(inner.id).trim(),
      kind: inner.kind != null ? String(inner.kind).trim() : 'on-chain',
      meta: inner.meta && typeof inner.meta === 'object' ? _safeJson(inner.meta) : undefined
    };
  } catch (_) {
    return null;
  }
}

/**
 * Scan a `getblock` verbosity-2 block for federation announcements.
 * @param {object} block
 * @param {number} height
 * @returns {object[]}
 */
function extractFederationAnnouncementsFromBlock (block, height) {
  const out = [];
  const txs = block && Array.isArray(block.tx) ? block.tx : [];
  for (const tx of txs) {
    const txid = tx && tx.txid ? String(tx.txid) : '';
    if (!txid) continue;
    const vouts = Array.isArray(tx.vout) ? tx.vout : [];
    for (const vout of vouts) {
      const spk = vout && vout.scriptPubKey ? vout.scriptPubKey : null;
      const parsed = parseFabricFederationOpReturn(spk);
      if (!parsed) continue;
      out.push({
        ...parsed,
        txid,
        height: Number.isFinite(Number(height)) ? Number(height) : null
      });
    }
  }
  return out;
}

/**
 * @param {*} fs
 * @param {object[]} announcements from {@link extractFederationAnnouncementsFromBlock}
 * @param {number|null} height block height
 */
async function mergeAnnouncementsIntoRegistry (fs, announcements, height) {
  if (!announcements || announcements.length === 0) {
    const reg = loadRegistry(fs);
    if (height != null && Number.isFinite(Number(height))) {
      reg.lastScannedHeight = Math.max(Number(reg.lastScannedHeight) || 0, Number(height));
      await persistRegistry(fs, reg);
    }
    return reg;
  }
  const reg = loadRegistry(fs);
  const byId = new Map();
  for (const e of reg.entries) {
    if (e && e.id) byId.set(String(e.id), e);
  }
  for (const a of announcements) {
    const id = a.id ? String(a.id) : '';
    if (!id) continue;
    const prev = byId.get(id);
    const row = {
      id,
      name: a.name || id,
      kind: a.kind || 'on-chain',
      source: 'chain',
      txid: a.txid || null,
      height: a.height != null ? Number(a.height) : null,
      firstSeenAt: new Date().toISOString(),
      ...(prev && prev.source === 'settings' ? { seededAt: prev.seededAt } : {})
    };
    byId.set(id, row);
  }
  reg.entries = [...byId.values()];
  if (height != null && Number.isFinite(Number(height))) {
    reg.lastScannedHeight = Math.max(Number(reg.lastScannedHeight) || 0, Number(height));
  }
  await persistRegistry(fs, reg);
  return reg;
}

module.exports = {
  REGISTRY_PATH,
  POLICY_SNAPSHOT_PATH,
  DISCOVER_MAGIC_HEX,
  loadRegistry,
  loadPolicySnapshot,
  persistPolicySnapshot,
  persistRegistry,
  seedRegistryFromSettings,
  parseFabricFederationOpReturn,
  extractFederationAnnouncementsFromBlock,
  mergeAnnouncementsIntoRegistry
};
