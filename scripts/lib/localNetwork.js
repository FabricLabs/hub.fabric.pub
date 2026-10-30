'use strict';

/**
 * @fileoverview Local multi-Hub networks: settings fragments, per-instance
 * keys, detached Hub processes, and health checks. Shared by
 * `scripts/deploy.js` (named instances: a Bitcoin seed plus stand-ins for
 * hub.fabric.pub and hub.goon.vc) and `scripts/playnet-regtest-mesh-launch.js`.
 *
 * Instances never inherit the operator identity: child processes start
 * without `FABRIC_XPRV` / `FABRIC_SEED` / `FABRIC_MNEMONIC`, and each fragment
 * carries its own `key.xprv` (Hub resolves xprv > seed > mnemonic, so a
 * fragment with only a mnemonic would still run as the operator).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const HUB_SCRIPT = path.join(REPO, 'scripts', 'playnet-hub-with-settings.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Env vars a child Hub must not inherit (identity, ports, federation policy). */
const STRIPPED_ENV = Object.freeze([
  'FABRIC_XPRV',
  'FABRIC_XPUB',
  'FABRIC_SEED',
  'FABRIC_MNEMONIC',
  'FABRIC_PASSWORD',
  'FABRIC_PASSPHRASE',
  'FABRIC_PORT',
  'FABRIC_HUB_PORT',
  'PORT',
  'FABRIC_HUB_INTERFACE',
  'INTERFACE',
  'FABRIC_HTTP_INTERFACE',
  'FABRIC_HUB_ADMIN_TOKEN',
  'FABRIC_HUB_PEERS_DB',
  'FABRIC_BITCOIN_NETWORK',
  'FABRIC_BITCOIN_RPC_PORT',
  'FABRIC_BITCOIN_P2P_ADDNODES',
  'FABRIC_BITCOIN_PLAYNET_PEER',
  'FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS',
  'FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD',
  'FABRIC_DISTRIBUTED_FEDERATION_SIGNATURE_SCHEME',
  'FABRIC_DEV_PUSH_BROWSER_IDENTITY'
]);

/**
 * Per-network layout. `base` offsets every port so networks can run side by
 * side and never touch the desktop Hub defaults (8080 / 7777 / 18443 / 18444 / 29500).
 */
const NETWORKS = Object.freeze({
  regtest: {
    base: 30000,
    seed: true,
    beaconIntervalMs: 10000,
    extraParams: ['-dnsseed=0', '-fallbackfee=0.00001', '-incrementalrelayfee=0']
  },
  signet: {
    base: 31000,
    seed: false,
    beaconIntervalMs: 0,
    // Public chains sync from the internet; pruned (MiB) so each instance stays small.
    prune: 550,
    extraParams: ['-fallbackfee=0.00001']
  },
  mainnet: {
    base: 32000,
    seed: false,
    beaconIntervalMs: 0,
    prune: 550,
    extraParams: []
  }
});

/**
 * Named instances, in start order. `seed` only exists on networks with
 * `seed: true`; stand-ins are left out when the real public Hubs take part.
 * `operator` is the local member (the role a desktop Hub plays). It has a
 * fixed `slot` because other tools take the ports just past the instances.
 */
const INSTANCES = Object.freeze([
  { name: 'seed', label: 'Seed (Bitcoin P2P, Beacon miner)', signer: false, seedOnly: true },
  { name: 'hub-fabric-pub', label: 'hub.fabric.pub (local stand-in)', signer: true, standIn: true },
  { name: 'hub-goon-vc', label: 'hub.goon.vc (local stand-in)', signer: true, standIn: true },
  { name: 'operator', label: 'Operator (local member)', signer: true, slot: 8 }
]);

/**
 * @param {string} network
 * @returns {object} network profile
 */
function networkProfile (network) {
  const p = NETWORKS[String(network || '').toLowerCase()];
  if (!p) throw new Error(`Unknown network "${network}" (expected ${Object.keys(NETWORKS).join(', ')})`);
  return Object.assign({ name: String(network).toLowerCase() }, p);
}

/**
 * Ports for instance `index` on a network base.
 * @param {number} base
 * @param {number} index
 * @returns {{ http: number, fabric: number, btcP2p: number, btcRpc: number, zmq: number }}
 */
function instancePorts (base, index) {
  const b = Number(base);
  const i = Number(index);
  return {
    http: b + 180 + i,
    fabric: b + 277 + i,
    btcP2p: b + 444 + i,
    btcRpc: b + 544 + i,
    zmq: b + 920 + i
  };
}

/**
 * Instances for a network (drops the seed where the network syncs publicly).
 * @param {string} network
 * @param {number} [base] port base (defaults to the network's)
 * @param {Object} [opts]
 * @param {boolean} [opts.remotes] the real public Hubs take part, so the stand-ins are left out
 * @returns {Array<object>} `{ name, label, signer, index, ports }`
 */
function instancesFor (network, base, opts = {}) {
  const profile = networkProfile(network);
  const portBase = base != null ? Number(base) : profile.base;
  // Ports follow the full list, so an instance keeps its ports with or without the stand-ins.
  return INSTANCES
    .filter((i) => profile.seed || !i.seedOnly)
    .map((i, index) => Object.assign({}, i, { index, ports: instancePorts(portBase, i.slot != null ? i.slot : index) }))
    .filter((i) => !(opts.remotes && i.standIn));
}

/**
 * Root directory for a network's instances.
 * @param {string} network
 * @param {string} [root]
 * @returns {string}
 */
function networkRoot (network, root) {
  let base = path.resolve(root || path.join(REPO, 'stores', 'local-network'));
  // Fabric Filesystem refuses symlinked paths, and macOS temp dirs live under /var → /private/var.
  try { base = fs.realpathSync(base); } catch (_) {}
  return path.join(base, String(network));
}

function writeJson (file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
  if (mode) fs.chmodSync(file, mode);
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Load or generate the instance's own key (`<dir>/key.json`, mode 0600).
 * @param {string} dir instance directory
 * @returns {{ xprv: string, pubkey: string, createdAt: string }}
 */
function ensureInstanceKey (dir) {
  const file = path.join(dir, 'key.json');
  const saved = readJson(file);
  const Key = require('@fabric/core/types/key');
  if (saved && saved.xprv) {
    const key = new Key({ xprv: saved.xprv });
    return { xprv: saved.xprv, pubkey: key.pubkey, createdAt: saved.createdAt || null };
  }
  const fresh = new Key();
  const record = { xprv: fresh.xprv, pubkey: fresh.pubkey, createdAt: new Date().toISOString() };
  writeJson(file, record, 0o600);
  return record;
}

/**
 * Settings fragment merged over `settings/local.js` by `playnet-hub-with-settings.js`.
 * @param {object} opts
 * @param {boolean} [opts.mine=true] run the seed's Beacon miner (off on a shared public chain)
 * @returns {object}
 */
function buildFragment (opts) {
  const { network, instance, dir, key, seedPort, fabricPeers, bitcoinPeers, mine = true } = opts;
  const profile = networkProfile(network);
  const ports = instance.ports;
  const isSeed = instance.name === 'seed';
  const extra = profile.extraParams.slice();
  if (isSeed) extra.push('-bind=127.0.0.1');
  // -connect, not -addnode: bitcoind also redials whoever it remembers in
  // peers.dat, which put a private chain onto the public playnet node.
  const connects = [];
  if (seedPort && !isSeed) connects.push(`127.0.0.1:${seedPort}`);
  for (const peer of bitcoinPeers || []) connects.push(peer);
  if (connects.length) {
    for (const peer of connects) extra.push(`-connect=${peer}`);
  } else if (profile.seed) {
    extra.push('-connect=0');
  }
  return {
    title: instance.label,
    alias: instance.name,
    port: ports.fabric,
    interface: '127.0.0.1',
    peers: fabricPeers || [],
    // Busy public Hubs can sit silent for 20 s or more mid-handshake (core's default idle timeout is 5 s).
    connectTimeout: 60000,
    path: dir,
    fs: { path: dir },
    // The default registry is the developer Hub's stores/hub/peers (public seeds).
    peersDb: path.join(dir, 'peers'),
    key: { xprv: key.xprv, xpub: null, seed: null, mnemonic: null },
    bitcoin: {
      enable: true,
      network: profile.name,
      managed: true,
      listen: isSeed,
      port: ports.btcP2p,
      rpcport: ports.btcRpc,
      zmqPort: ports.zmq,
      datadir: path.join(dir, 'bitcoin-datadir'),
      p2pAddNodes: [],
      skipPlaynetPeer: true,
      bitcoinExtraParams: extra
    },
    beacon: isSeed && mine && profile.beaconIntervalMs > 0
      ? { enable: true, interval: profile.beaconIntervalMs, regtestOnly: true }
      : { enable: false },
    lightning: { managed: false, stub: true },
    // Keep peers' inventories for ListDocumentOffers.
    documents: { market: { accumulatePeerInventories: true } },
    http: { hostname: '127.0.0.1', interface: '127.0.0.1', listen: true, port: ports.http },
    debug: false
  };
}

/**
 * Child env: inherit PATH etc., drop operator identity and port overrides.
 * @param {string} network
 * @returns {object}
 */
function childEnv (network) {
  const env = Object.assign({}, process.env);
  for (const name of STRIPPED_ENV) delete env[name];
  env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
  env.FABRIC_BITCOIN_NETWORK = String(network);
  env.NODE_ENV = env.NODE_ENV === 'test' ? 'test' : 'production';
  return env;
}

function httpJson (port, method, pathname, body = null, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: Object.assign({ Accept: 'application/json', 'Content-Type': 'application/json' }, headers)
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${pathname}`)));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitHttp (port, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpJson(port, 'GET', '/settings', null, {}, 3000);
      if (r.status === 200 || r.status === 403) return;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error(`HTTP 127.0.0.1:${port} did not respond in time`);
}

async function waitBitcoinOnline (port, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpJson(port, 'GET', '/services/bitcoin', null, {}, 5000);
      if (r.status === 200 && r.body && r.body.available) return r.body;
    } catch (_) {}
    await sleep(750);
  }
  throw new Error(`Bitcoin not online on HTTP port ${port}`);
}

/**
 * First-run `POST /settings`; writes the one-time admin token to `tokenFile`.
 * @returns {Promise<string|null>} token when newly issued
 */
async function bootstrapAdmin (port, nodeName, tokenFile, opts = {}) {
  // Setup knobs override the fragment's bitcoin settings, so state them: the
  // default preset would turn off listening and add -blocksonly (no tx relay).
  const r = await httpJson(port, 'POST', '/settings', {
    NODE_NAME: nodeName,
    LIGHTNING_MANAGED: false,
    bitcoinManaged: true,
    BITCOIN_NETWORK: opts.network || 'regtest',
    BITCOIN_LISTEN: opts.listen === true,
    BITCOIN_TXRELAY: true,
    // txindex can't run on a pruned node.
    BITCOIN_PRUNE: opts.prune || 0,
    BITCOIN_TXINDEX: !opts.prune
  });
  if (r.status === 200) {
    const token = r.body && (r.body.token || (r.body.result && r.body.result.token));
    if (token) {
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, String(token).trim() + '\n', { mode: 0o600 });
      return String(token).trim();
    }
    return null;
  }
  if (r.status === 403) return null;
  throw new Error(`POST /settings on ${port} failed: ${r.status} ${r.raw}`);
}

function pidAlive (pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function readPid (dir) {
  try {
    const n = Number(fs.readFileSync(path.join(dir, 'hub.pid'), 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

/**
 * Start one Hub detached (survives this process); logs to `<dir>/hub.log`.
 * @returns {number} pid
 */
function startDetached (dir, fragmentFile, env) {
  const existing = readPid(dir);
  if (existing && pidAlive(existing)) return existing;
  const log = fs.openSync(path.join(dir, 'hub.log'), 'a');
  const child = spawn(process.execPath, [HUB_SCRIPT, fragmentFile], {
    cwd: REPO,
    env,
    detached: true,
    stdio: ['ignore', log, log]
  });
  child.unref();
  fs.closeSync(log);
  fs.writeFileSync(path.join(dir, 'hub.pid'), String(child.pid) + '\n');
  return child.pid;
}

/**
 * SIGTERM, wait, then SIGKILL. Removes the pid file only once the process is gone,
 * so a stop that could not signal it (EPERM, a sandbox) leaves it findable.
 * @returns {Promise<boolean>} true when a process was stopped
 */
async function stopDetached (dir, timeoutMs = 45000) {
  const pidFile = path.join(dir, 'hub.pid');
  const pid = readPid(dir);
  if (!pid || !pidAlive(pid)) {
    try { fs.unlinkSync(pidFile); } catch (_) {}
    return false;
  }
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  const t0 = Date.now();
  while (pidAlive(pid) && Date.now() - t0 < timeoutMs) await sleep(500);
  if (pidAlive(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    await sleep(1000);
  }
  if (pidAlive(pid)) throw new Error(`pid ${pid} (${dir}) is still running; stop it by hand`);
  try { fs.unlinkSync(pidFile); } catch (_) {}
  return true;
}

module.exports = {
  REPO,
  HUB_SCRIPT,
  NETWORKS,
  INSTANCES,
  STRIPPED_ENV,
  sleep,
  networkProfile,
  instancePorts,
  instancesFor,
  networkRoot,
  writeJson,
  readJson,
  ensureInstanceKey,
  buildFragment,
  childEnv,
  httpJson,
  waitHttp,
  waitBitcoinOnline,
  bootstrapAdmin,
  pidAlive,
  readPid,
  startDetached,
  stopDetached
};
