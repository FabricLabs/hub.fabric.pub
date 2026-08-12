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
 * Operator Peer key for playnet scripts (suite-wide).
 *
 * Priority:
 *   1. `FABRIC_XPRV` — preferred for public docs and production
 *   2. `FABRIC_SEED` / `FABRIC_MNEMONIC` — BIP39 phrase, or an `xprv…` string
 *   3. Optional `local/fabric-operator-identity.json` (automation fallback only)
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowLocalIdentityFallback=true]
 * @returns {{ xprv: string }|{ mnemonic: string }|null}
 */
function loadPeerKeySettings (opts = {}) {
  const allowLocal = opts.allowLocalIdentityFallback !== false;
  const fromXprv = String(process.env.FABRIC_XPRV || '').trim();
  if (fromXprv.startsWith('xprv') || fromXprv.startsWith('tprv')) {
    return { xprv: fromXprv };
  }
  const seed = String(process.env.FABRIC_SEED || process.env.FABRIC_MNEMONIC || '').trim();
  if (seed.startsWith('xprv') || seed.startsWith('tprv')) {
    return { xprv: seed };
  }
  if (seed) return { mnemonic: seed };
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

module.exports = {
  ROOT,
  loadMnemonic,
  loadPeerKeySettings,
  loadLocalOperatorIdentityFile,
  loadLocalOperatorMnemonic,
  loadAdminToken,
  hubRpcBase,
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
  planPlaynetOperatorSweep
};
