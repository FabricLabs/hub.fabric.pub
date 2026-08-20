'use strict';

/**
 * Shared helpers for playnet / Hub registry operator scripts.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');

let loadFabricHomeEnv;
try {
  ({ loadFabricHomeEnv } = require('@fabric/core/functions/fabricHomeEnv'));
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
}
if (typeof loadFabricHomeEnv === 'function') loadFabricHomeEnv();

/**
 * Optional local operator identity (gitignored). Prefer FABRIC_XPRV in the environment.
 * @returns {{ mnemonic: string, xprv: string }|null}
 */
function loadLocalOperatorIdentityFile () {
  const candidates = [
    path.join(ROOT, 'local', 'fabric-operator-identity.json'),
    path.join(ROOT, 'local', 'cursor-agent-fabric-identity.json') // legacy on-disk name
  ];
  for (const identityPath of candidates) {
    try {
      const id = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      const phrase = String(id.mnemonic || '').trim();
      const xprv = String(id.xprv || '').trim();
      if (xprv.startsWith('xprv') || xprv.startsWith('tprv') || phrase) {
        return {
          mnemonic: phrase || '',
          xprv: (xprv.startsWith('xprv') || xprv.startsWith('tprv')) ? xprv : ''
        };
      }
    } catch (_) {}
  }
  return null;
}

function loadLocalOperatorMnemonic () {
  const id = loadLocalOperatorIdentityFile();
  return (id && id.mnemonic) || '';
}

/**
 * Even-length BIP32 seed hex (16–64 bytes), optional `0x` prefix.
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRawSeedHex (value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!/^(?:0x)?[0-9a-fA-F]+$/i.test(trimmed)) return false;
  const hex = trimmed.slice(0, 2).toLowerCase() === '0x' ? trimmed.slice(2) : trimmed;
  if (hex.length % 2 !== 0) return false;
  const bytes = hex.length / 2;
  return bytes >= 16 && bytes <= 64;
}

/**
 * Classify env identity when `@fabric/core/functions/fabricKeyMaterial` is missing.
 * Raw `FABRIC_SEED` hex stays `{ seed }` — never `{ mnemonic }`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ xprv: string }|{ seed: string }|{ mnemonic: string }|null}
 */
function fallbackPeerKeySettingsFromEnv (env = process.env) {
  const xprv = String((env && env.FABRIC_XPRV) || '').trim();
  if (xprv.startsWith('xprv') || xprv.startsWith('tprv')) return { xprv };

  const seedRaw = String((env && env.FABRIC_SEED) || '').trim();
  if (seedRaw.startsWith('xprv') || seedRaw.startsWith('tprv')) return { xprv: seedRaw };
  if (looksLikeRawSeedHex(seedRaw)) {
    const hex = seedRaw.slice(0, 2).toLowerCase() === '0x' ? seedRaw.slice(2) : seedRaw;
    return { seed: hex.toLowerCase() };
  }
  if (seedRaw && /\s/.test(seedRaw)) return { mnemonic: seedRaw };

  const mnemonic = String((env && env.FABRIC_MNEMONIC) || '').trim();
  if (mnemonic.startsWith('xprv') || mnemonic.startsWith('tprv')) return { xprv: mnemonic };
  if (looksLikeRawSeedHex(mnemonic)) {
    const hex = mnemonic.slice(0, 2).toLowerCase() === '0x' ? mnemonic.slice(2) : mnemonic;
    return { seed: hex.toLowerCase() };
  }
  if (mnemonic) return { mnemonic };
  return null;
}

/**
 * Operator Peer key for playnet scripts (suite-wide).
 *
 * Priority:
 *   1. `FABRIC_XPRV` — preferred for public docs and production
 *   2. `FABRIC_SEED` — raw BIP32 seed hex (or a legacy mnemonic / `xprv…` string)
 *   3. `FABRIC_MNEMONIC` — BIP39 phrase
 *   4. `~/.fabric/wallet.json` (`FABRIC_PASSWORD` unlocks a sealed wallet)
 *   5. Optional `local/fabric-operator-identity.json` (automation fallback only)
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowLocalIdentityFallback=true]
 * @param {boolean} [opts.allowWalletFallback]
 * @returns {{ xprv: string }|{ mnemonic: string }|{ seed: string }|null}
 */
function loadPeerKeySettings (opts = {}) {
  const allowLocal = opts.allowLocalIdentityFallback !== false;
  const allowWallet = opts.allowWalletFallback != null
    ? opts.allowWalletFallback
    : true;

  try {
    const { keySettingsFromEnv } = require('@fabric/core/functions/fabricKeyMaterial');
    const fromEnv = keySettingsFromEnv(process.env);
    if (fromEnv) return fromEnv;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
    const fallback = fallbackPeerKeySettingsFromEnv(process.env);
    if (fallback) return fallback;
  }

  if (allowWallet) {
    try {
      const { loadIdentityFromWalletFile } = require('@fabric/core/functions/fabricWalletIdentity');
      const wallet = loadIdentityFromWalletFile({ password: process.env.FABRIC_PASSWORD });
      if (wallet && wallet.xprv) return { xprv: wallet.xprv };
    } catch (_) { /* older core pin or locked wallet */ }
  }

  if (!allowLocal) return null;
  const local = loadLocalOperatorIdentityFile();
  if (!local) return null;
  if (local.xprv) return { xprv: local.xprv };
  if (local.mnemonic) return { mnemonic: local.mnemonic };
  return null;
}

/**
 * Resolve a BIP39 mnemonic when one is configured in the environment (or local fallback).
 * Prefer {@link loadPeerKeySettings} — operators should set `FABRIC_XPRV` when possible.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowLocalIdentityFallback=true]
 * @returns {string}
 */
function loadMnemonic (opts = {}) {
  const key = loadPeerKeySettings(opts);
  if (!key) return '';
  if (key.mnemonic) return key.mnemonic;
  return '';
}

function loadAdminToken () {
  const fromEnv = String(process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  // Fresh playnet:mesh writes one-time tokens under stores/playnet-mesh-runtime/.
  const meshTokenPath = path.join(ROOT, 'stores', 'playnet-mesh-runtime', 'admin-token-a.txt');
  try {
    const fromMesh = String(fs.readFileSync(meshTokenPath, 'utf8') || '').trim();
    if (fromMesh) return fromMesh;
  } catch (_) {}
  return '';
}

function hubRpcBase () {
  return String(process.env.FABRIC_HUB_RPC_URL || process.env.FABRIC_HUB_URL || 'http://127.0.0.1:8080')
    .trim()
    .replace(/\/$/, '');
}

/** Public playnet Hub HTTP + Fabric peers (hub.fabric.pub + relay.goon.vc). */
const PRODUCTION_HUB_HTTP = 'https://hub.fabric.pub';
const PRODUCTION_PLAYNET_PEERS = 'hub.fabric.pub:7777,relay.goon.vc:7777';

/**
 * Targets for `--production` / `FABRIC_PLAYNET_PRODUCTION=1`.
 * Env still wins when already set.
 * @returns {{ hubUrl: string, peers: string[] }}
 */
function productionPlaynetTarget () {
  const hubUrl = String(
    process.env.FABRIC_HUB_RPC_URL || process.env.FABRIC_HUB_URL || PRODUCTION_HUB_HTTP
  ).trim().replace(/\/$/, '');
  const peers = String(process.env.FABRIC_PLAYNET_PEERS || process.env.FABRIC_FLUSH_PEERS ||
    PRODUCTION_PLAYNET_PEERS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { hubUrl, peers };
}

function playnetPeers (extraArgv = []) {
  if (Array.isArray(extraArgv) && extraArgv.length) {
    return extraArgv.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(process.env.FABRIC_PLAYNET_PEERS || process.env.FABRIC_FLUSH_PEERS ||
    'relay.goon.vc:7777,hub.fabric.pub:7777')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bitcoinDatadir () {
  return process.env.FABRIC_BITCOIN_DATADIR
    ? path.resolve(process.cwd(), process.env.FABRIC_BITCOIN_DATADIR)
    : path.join(ROOT, 'stores', 'bitcoin-regtest');
}

function bitcoinRpcPort () {
  return String(process.env.FABRIC_BITCOIN_RPC_PORT || 18443);
}

function bitcoinCliPrefix () {
  const args = ['-regtest', `-datadir=${bitcoinDatadir()}`, `-rpcport=${bitcoinRpcPort()}`];
  if (process.env.FABRIC_BITCOIN_RPC_USER) {
    args.push(`-rpcuser=${process.env.FABRIC_BITCOIN_RPC_USER}`);
  }
  if (process.env.FABRIC_BITCOIN_RPC_PASSWORD) {
    args.push(`-rpcpassword=${process.env.FABRIC_BITCOIN_RPC_PASSWORD}`);
  }
  return args;
}

function runBitcoinCli (extraArgs, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = [...bitcoinCliPrefix(), ...extraArgs];
    const child = spawn('bitcoin-cli', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `bitcoin-cli exited ${code}`));
        return;
      }
      const trimmed = out.trim();
      if (!json) {
        resolve(trimmed);
        return;
      }
      try {
        resolve(trimmed ? JSON.parse(trimmed) : null);
      } catch (e) {
        reject(new Error(`bitcoin-cli JSON parse failed: ${e.message}\n${trimmed.slice(0, 400)}`));
      }
    });
    child.on('error', reject);
  });
}

function hubRpc (method, params, opts = {}) {
  const base = String(opts.baseUrl || hubRpcBase()).replace(/\/$/, '');
  const url = new URL(`${base}/services/rpc`);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: opts.id != null ? opts.id : 1,
    method,
    params: Array.isArray(params) ? params : (params != null ? [params] : [])
  });
  const lib = url.protocol === 'https:' ? https : http;
  const timeoutMs = Number(opts.timeoutMs || process.env.FABRIC_HUB_RPC_TIMEOUT_MS || 30000);

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            return;
          }
          resolve(parsed.result !== undefined ? parsed.result : parsed);
        } catch (e) {
          reject(new Error(`RPC parse failed (${res.statusCode}): ${data.slice(0, 400)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`RPC timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function hubGetJson (pathname, opts = {}) {
  const base = String(opts.baseUrl || hubRpcBase()).replace(/\/$/, '');
  const url = new URL(`${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  const lib = url.protocol === 'https:' ? https : http;
  const timeoutMs = Number(opts.timeoutMs || 30000);

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`GET ${pathname} parse failed (${res.statusCode}): ${data.slice(0, 400)}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`GET timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function loadPlaynetContract (opts = {}) {
  const modulePath = opts.contractModule || process.env.FABRIC_PLAYNET_CONTRACT_MODULE;
  if (modulePath) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(path.resolve(String(modulePath)));
      const idFn = mod.contractId || mod.playnetContractId;
      const defFn = mod.contractDefinition || mod.playnetContractDefinition;
      if (typeof idFn === 'function' && typeof defFn === 'function') {
        return {
          source: String(modulePath),
          contractId: idFn(),
          definition: defFn()
        };
      }
      if (mod.contractId && mod.definition) {
        return {
          source: String(modulePath),
          contractId: String(mod.contractId).toLowerCase(),
          definition: mod.definition
        };
      }
    } catch (_) {}
  }

  const fromEnv = String(
    opts.contractId || process.env.FABRIC_PLAYNET_CONTRACT_ID || ''
  ).trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(fromEnv)) {
    return { source: 'env', contractId: fromEnv, definition: opts.definition || null };
  }

  const siblingGc = path.join(ROOT, '..', 'star-citizen-live', 'contracts', 'gooncitizen.js');
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const gc = require(siblingGc);
    if (typeof gc.gooncitizenContractId === 'function') {
      return {
        source: siblingGc,
        contractId: gc.gooncitizenContractId(),
        definition: typeof gc.gooncitizenContractDefinition === 'function'
          ? gc.gooncitizenContractDefinition()
          : null
      };
    }
  } catch (_) {}

  return { source: 'unset', contractId: null, definition: null };
}

async function waitForPeerConnections (peer, { timeoutMs = 20000, min = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = Object.keys(peer.connections || {}).length;
    if (n >= min) return Object.keys(peer.connections || {});
    await new Promise((r) => setTimeout(r, 250));
  }
  return Object.keys(peer.connections || {});
}

/**
 * Invalidate local tip blocks until best hash equals snapshot.
 * @param {string} snapshotBlockHash
 * @param {object} [opts]
 * @param {number} [opts.maxSteps]
 * @param {Function} [opts.runCli] injectable bitcoin-cli runner (tests)
 * @returns {Promise<{ ok: boolean, steps: number, tip: string }>}
 */
async function localFlushToSnapshot (snapshotBlockHash, { maxSteps = 100000, runCli } = {}) {
  const snap = String(snapshotBlockHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(snap)) {
    throw new Error('snapshotBlockHash must be 64 hex');
  }
  const cli = typeof runCli === 'function' ? runCli : runBitcoinCli;
  let tip = String(await cli(['getbestblockhash'])).trim().toLowerCase();
  if (tip === snap) {
    return { ok: true, steps: 0, tip };
  }
  let steps = 0;
  while (tip !== snap && steps < maxSteps) {
    await cli(['invalidateblock', tip]);
    tip = String(await cli(['getbestblockhash'])).trim().toLowerCase();
    steps += 1;
  }
  if (tip !== snap) {
    throw new Error(`local flush did not reach snapshot after ${steps} steps (tip=${tip})`);
  }
  return { ok: true, steps, tip };
}

/**
 * Ordered one-shot playnet operator plan (wipe → fund → deploy accept).
 * Application repos publish CONTRACT_PUBLISH; Hub only AcceptTracked.
 * @param {object} [opts]
 * @returns {{ steps: string[], wipe: object, fund: object, deploy: object }}
 */
function planPlaynetOperatorSweep (opts = {}) {
  const snap = opts.snapshotBlockHash
    ? String(opts.snapshotBlockHash).trim().toLowerCase()
    : null;
  if (snap && !/^[0-9a-f]{64}$/.test(snap)) {
    throw new Error('snapshotBlockHash must be 64 hex');
  }

  const loaded = loadPlaynetContract(opts);
  return {
    steps: ['wipe', 'fund', 'deploy'],
    wipe: {
      snapshotBlockHash: snap,
      localInvalidate: opts.localInvalidate !== false,
      flushPeers: opts.flushPeers !== false,
      network: String(opts.network || process.env.FABRIC_FLUSH_NETWORK || 'regtest'),
      label: String(opts.label || process.env.FABRIC_FLUSH_LABEL || 'playnet-ops-sweep')
    },
    fund: {
      mode: opts.fundMode || 'hub-faucet',
      hub: hubRpcBase(),
      amountSats: Math.max(1, Number(opts.faucetAmountSats) || 10000),
      address: opts.receiveAddress || null
    },
    deploy: {
      contractId: loaded.contractId,
      definition: loaded.definition,
      source: loaded.source,
      accept: opts.accept === true,
      hub: String(opts.hub || hubRpcBase()).replace(/\/$/, ''),
      acceptMethod: 'AcceptTrackedApplicationContract',
      note: 'Publish from the application repo; Hub AcceptTracked only.'
    }
  };
}

/**
 * Plan for this Hub process to act as the live playnet registry (local takeover).
 * Accept authority stays on loopback; Fabric peer omits public hub.fabric.pub.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function planLocalHubAsPlaynetRegistry (opts = {}) {
  const hubUrl = String(
    opts.hub || opts.hubUrl || process.env.FABRIC_LOCAL_HUB_RPC_URL || 'http://127.0.0.1:8080'
  ).trim().replace(/\/$/, '');
  let loopback = false;
  try {
    const u = new URL(hubUrl);
    const host = String(u.hostname || '').toLowerCase();
    loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch (_) {
    loopback = false;
  }
  const productionHttp = /(?:^|[./])hub\.fabric\.pub(?::|\/|$)/i.test(hubUrl);
  const localPeer = String(opts.localPeer || process.env.FABRIC_LOCAL_HUB_PEER || '127.0.0.1:7777').trim();
  const peers = [localPeer];
  if (opts.includeRelay !== false) peers.push('relay.goon.vc:7777');

  return {
    role: 'local-registry',
    hubUrl,
    peers,
    omitProductionHubPeer: true,
    networkAlwaysExists: true,
    management: {
      shortTerm: 'local-lead',
      longTerm: 'hub.fabric.pub'
    },
    acceptMethod: 'AcceptTrackedApplicationContract',
    readinessRpc: [
      'GetNetworkStatus',
      'ListTrackedApplicationContracts',
      'GetSidechainState'
    ],
    readinessHttp: [
      '/services/peering',
      '/services/distributed/manifest',
      '/services/distributed/epoch'
    ],
    expectNativeBeacon: 'fabric-beacon',
    safe: loopback && !productionHttp,
    blockers: [
      !loopback ? 'registry Hub HTTP must be loopback' : null,
      productionHttp ? 'refusing production hub.fabric.pub as local registry' : null
    ].filter(Boolean)
  };
}

/**
 * Short-term local playnet lead; long-term management on hub.fabric.pub.
 * @param {object} [opts]
 * @param {'local-lead'|'hub.fabric.pub'} [opts.horizon]
 * @returns {object}
 */
function planPlaynetLeadCapture (opts = {}) {
  const horizon = opts.horizon === 'hub.fabric.pub' ? 'hub.fabric.pub' : 'local-lead';
  const local = planLocalHubAsPlaynetRegistry(opts);
  const shortTerm = {
    horizon: 'local-lead',
    registryHttp: local.hubUrl,
    registryPeer: (local.peers && local.peers[0]) || '127.0.0.1:7777',
    plan: local
  };
  const longTerm = {
    horizon: 'hub.fabric.pub',
    registryHttp: PRODUCTION_HUB_HTTP,
    registryPeer: 'hub.fabric.pub:7777',
    deployFlags: ['--production', '--accept'],
    steps: [
      'align-operator-FABRIC_XPRV-with-hub-_rootKey',
      'AcceptTracked-on-hub.fabric.pub',
      'publish-management-from-hub.fabric.pub',
      'retire-local-lead-authority'
    ]
  };
  return {
    role: 'playnet-lead-capture',
    networkAlwaysExists: true,
    horizon,
    active: horizon === 'hub.fabric.pub' ? longTerm : shortTerm,
    shortTerm,
    longTerm,
    safe: horizon === 'local-lead' ? !!local.safe : true
  };
}

module.exports = {
  ROOT,
  loadMnemonic,
  loadPeerKeySettings,
  fallbackPeerKeySettingsFromEnv,
  loadLocalOperatorIdentityFile,
  loadLocalOperatorMnemonic,
  loadAdminToken,
  hubRpcBase,
  productionPlaynetTarget,
  PRODUCTION_HUB_HTTP,
  PRODUCTION_PLAYNET_PEERS,
  playnetPeers,
  bitcoinDatadir,
  bitcoinRpcPort,
  bitcoinCliPrefix,
  runBitcoinCli,
  hubRpc,
  hubGetJson,
  loadPlaynetContract,
  waitForPeerConnections,
  localFlushToSnapshot,
  planPlaynetOperatorSweep,
  planLocalHubAsPlaynetRegistry,
  planPlaynetLeadCapture
};
