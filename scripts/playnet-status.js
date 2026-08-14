'use strict';

/**
 * Check playnet / Hub registry deployment: tracked contracts, sidechain, Beacon epoch.
 *
 * Usage:
 *   npm run playnet:status -- [--hub <url>] [--contract <id>]
 *
 * Env:
 *   FABRIC_HUB_RPC_URL          default http://127.0.0.1:8080
 *   FABRIC_PLAYNET_CONTRACT_ID  64-hex contract id (optional)
 *   FABRIC_PLAYNET_CONTRACT_MODULE  path to application contract module (optional)
 */

const {
  hubRpcBase,
  productionPlaynetTarget,
  hubRpc,
  hubGetJson,
  loadPlaynetContract
} = require('./lib/playnetOps');

function printHelp () {
  console.log(`Usage:
  npm run playnet:status -- [--hub <url>] [--production] [--contract <id>]

Prints ListTrackedApplicationContracts (including native fabric-beacon when
Beacon started), global sidechain STATE, contract sidechain STATE, and
GET /services/distributed/epoch (when available).

--production         Target https://hub.fabric.pub
Set FABRIC_PLAYNET_CONTRACT_ID or --contract for a specific tracked namespace.
Sibling star-citizen-live/contracts/gooncitizen.js is used when unset.
`);
}

function pick (obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

async function safe (label, fn) {
  try {
    return { ok: true, label, value: await fn() };
  } catch (e) {
    return { ok: false, label, error: e.message || String(e) };
  }
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let hubUrl = hubRpcBase();
  let contractId = '';
  let production = process.env.FABRIC_PLAYNET_PRODUCTION === '1' ||
    process.env.FABRIC_PLAYNET_PRODUCTION === 'true';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hub') hubUrl = String(argv[++i] || '').replace(/\/$/, '');
    else if (a === '--contract') contractId = String(argv[++i] || '').trim().toLowerCase();
    else if (a === '--production') production = true;
  }
  if (production && !process.env.FABRIC_HUB_RPC_URL && !process.env.FABRIC_HUB_URL &&
      hubUrl === hubRpcBase()) {
    hubUrl = productionPlaynetTarget().hubUrl;
  }

  const loaded = loadPlaynetContract({ contractId: contractId || undefined });
  if (!contractId) contractId = loaded.contractId || '';

  console.log('[playnet:status] hub', hubUrl);
  console.log('[playnet:status] contract', {
    id: contractId || null,
    source: loaded.source
  });

  const tracked = await safe('ListTrackedApplicationContracts', () =>
    hubRpc('ListTrackedApplicationContracts', {}, { baseUrl: hubUrl }));
  if (tracked.ok) {
    const list = tracked.value || {};
    const pending = list.pending || [];
    const accepted = list.accepted || [];
    const hitPending = contractId
      ? pending.find((e) => String(e.contractId || e.id) === contractId)
      : null;
    const hitAccepted = contractId
      ? accepted.find((e) => String(e.contractId || e.id) === contractId)
      : null;
    console.log('[playnet:status] tracked', {
      pending: pending.length,
      accepted: accepted.length,
      contract: contractId
        ? (hitAccepted
          ? { status: 'accepted', ...pick(hitAccepted, ['name', 'stateDigest', 'acceptedAt', 'bitcoinHeight', 'network']) }
          : hitPending
            ? { status: 'pending', ...pick(hitPending, ['name', 'publishedAt']) }
            : { status: 'missing' })
        : { status: 'unspecified' }
    });
  } else {
    console.log('[playnet:status] tracked ERROR', tracked.error);
  }

  const manifest = await safe('GET /services/distributed/manifest', () =>
    hubGetJson('/services/distributed/manifest', { baseUrl: hubUrl }));
  if (manifest.ok) {
    const m = manifest.value || {};
    console.log('[playnet:status] fabric-beacon registry', {
      beaconContractId: m.beaconContractId || (m.beacon && m.beacon.contractId) || null,
      trackedContracts: m.trackedContracts || m.contracts || null
    });
  } else {
    console.log('[playnet:status] manifest ERROR', manifest.error);
  }

  const side = await safe('GetSidechainState', () =>
    hubRpc('GetSidechainState', {}, { baseUrl: hubUrl }));
  if (side.ok) {
    const s = side.value || {};
    const content = s.content && typeof s.content === 'object' ? s.content : {};
    const services = content.services && typeof content.services === 'object'
      ? content.services
      : {};
    console.log('[playnet:status] sidechain/STATE', {
      clock: s.clock,
      stateDigest: s.stateDigest,
      hasServicesRsi: !!(services && services.rsi),
      namespaceKeys: Object.keys(content.namespaces || {}).slice(0, 12)
    });
  } else {
    console.log('[playnet:status] sidechain ERROR', side.error);
  }

  if (contractId) {
    const cside = await safe('GetContractSidechainState', () =>
      hubRpc('GetContractSidechainState', { contractId }, { baseUrl: hubUrl }));
    if (cside.ok) {
      const s = cside.value || {};
      console.log('[playnet:status] contract sidechain', {
        clock: s.clock,
        stateDigest: s.stateDigest,
        version: s.version
      });
    } else {
      console.log('[playnet:status] contract sidechain ERROR', cside.error);
    }
  }

  const epoch = await safe('GET /services/distributed/epoch', () =>
    hubGetJson('/services/distributed/epoch', { baseUrl: hubUrl }));
  if (epoch.ok) {
    const e = epoch.value || {};
    console.log('[playnet:status] epoch', {
      clock: e.clock != null ? e.clock : (e.beacon && e.beacon.clock),
      height: e.height != null ? e.height : (e.beacon && e.beacon.height),
      blockHash: e.blockHash || (e.beacon && e.beacon.blockHash),
      sidechain: e.sidechain || (e.beacon && e.beacon.sidechain) || null,
      contracts: e.contracts || (e.beacon && e.beacon.contracts) || null
    });
  } else {
    console.log('[playnet:status] epoch ERROR', epoch.error);
  }

  const journal = await safe('GetSidechainJournal', () =>
    hubRpc('GetSidechainJournal', { limit: 5 }, { baseUrl: hubUrl }));
  if (journal.ok) {
    const j = journal.value || {};
    console.log('[playnet:status] journal', {
      entries: j.count != null ? j.count : (Array.isArray(j.entries) ? j.entries.length : null),
      latest: Array.isArray(j.entries) && j.entries.length
        ? pick(j.entries[j.entries.length - 1], ['clock', 'stateDigest', 'at', 'timestamp'])
        : null
    });
  } else {
    console.log('[playnet:status] journal ERROR', journal.error);
  }

  console.log('[playnet:status] done');
}

main().catch((err) => {
  console.error('[playnet:status]', err && err.message ? err.message : err);
  process.exit(1);
});
