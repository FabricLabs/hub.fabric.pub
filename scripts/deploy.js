#!/usr/bin/env node
'use strict';

/**
 * Reproducible Hub deploys. `--local` runs every instance on this machine:
 *
 *   npm run deploy -- --network regtest --local            # start (default)
 *   npm run deploy -- --network regtest --local status
 *   npm run deploy -- --network regtest --local stop
 *   npm run deploy -- --network regtest --local reset [--keys]
 *   npm run deploy -- --network regtest --local --playnet restart
 *
 * Instances (see `scripts/lib/localNetwork.js`): `seed` (Bitcoin P2P listen +
 * Beacon miner, regtest only), `hub-fabric-pub`, and `hub-goon-vc`, each with
 * its own generated key under `stores/local-network/<network>/<instance>/`.
 * On regtest the managed bitcoinds form a private network (`-addnode` to the
 * seed).
 *
 * `--playnet` (or `--remote host[:fabricPort]`, repeatable) also has every
 * instance dial the public Hubs (hub.fabric.pub, hub.goon.vc) over Fabric, and
 * `start` / `status` compare them with this tree: bundle, key, chain. The seed's
 * bitcoind also addnodes each remote (port 18444 on regtest); the most-work
 * chain wins, so a longer public chain replaces this network's chain.
 * Running instances keep their old peers until `restart`.
 *
 * `start` writes `stores/local-network/<network>/network-profile.json` (HTTP
 * URLs, Bitcoin addnode, Fabric peers, attestation pubkeys, admin-token
 * paths, and the remotes). A desktop Hub joins with Settings → Network →
 * Import network profile.
 *
 * Mainnet refuses unless `FABRIC_FEDERATION_MAINNET=1`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { execFile } = require('child_process');
const net = require('./lib/localNetwork');

/** Public Hubs `--playnet` peers with. */
const PLAYNET_HUBS = Object.freeze(['hub.fabric.pub', 'hub.goon.vc']);

/** Bitcoin P2P port of a remote Hub's bitcoind (no mainnet: never addnode a public Hub there). */
const BITCOIN_P2P_PORTS = Object.freeze({ regtest: 18444, signet: 38333, testnet: 18333 });

/**
 * @param {string} spec `host`, `host:fabricPort`, or `https://host`
 * @returns {{ name: string, host: string, http: string, fabric: string }}
 */
function parseRemote (spec) {
  const s = String(spec || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const m = s.match(/^([A-Za-z0-9.-]+)(?::(\d+))?$/);
  if (!m) throw new Error(`bad remote "${spec}" (expected host[:fabricPort])`);
  return { name: m[1], host: m[1], http: `https://${m[1]}`, fabric: `${m[1]}:${m[2] || 7777}` };
}

function parseArgs (argv) {
  const out = { command: 'start', network: 'regtest', local: false, keys: false, root: null, json: false, playnet: false, remotes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--network' || a === '-n') out.network = argv[++i];
    else if (a.startsWith('--network=')) out.network = a.slice('--network='.length);
    else if (a === '--local') out.local = true;
    else if (a === '--playnet') out.playnet = true;
    else if (a === '--remote') out.remotes = (out.remotes || []).concat(String(argv[++i] || '').split(',').filter(Boolean));
    else if (a === '--keys') out.keys = true;
    else if (a === '--json') out.json = true;
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--base') out.base = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.command = 'help';
    else if (!a.startsWith('-')) out.command = a;
  }
  return out;
}

function usage () {
  console.log([
    'Usage: npm run deploy -- --network <regtest|signet|mainnet> --local [start|status|stop|restart|reset] [--playnet] [--remote <host[:port]>] [--keys] [--json] [--root <dir>] [--base <port>]',
    '',
    '  start    start every instance, bootstrap admin tokens, check health, write network-profile.json',
    '  status   print instance health and the network profile',
    '  stop     stop every instance (SIGTERM, then SIGKILL after 45 s)',
    '  restart  stop, then start (keeps chains, stores, keys, admin tokens)',
    '  reset    stop, then delete chains and Hub stores (keeps keys unless --keys)',
    '',
    `  --playnet  also peer with ${PLAYNET_HUBS.join(', ')} (Fabric, and Bitcoin P2P off mainnet) and compare them with this tree`,
    '  --remote   peer with this public Hub instead (repeatable; HTTPS for its API, port 7777 unless given)'
  ].join('\n'));
}

function bitcoinCli (network, instance, dir, args) {
  const netFlag = network === 'mainnet' ? [] : [`-${network}`];
  const argv = netFlag.concat([
    `-datadir=${path.join(dir, 'bitcoin-datadir')}`,
    `-rpcport=${instance.ports.btcRpc}`
  ], args);
  return new Promise((resolve, reject) => {
    execFile('bitcoin-cli', argv, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      const s = String(stdout).trim();
      try { resolve(JSON.parse(s)); } catch (_) { resolve(s); }
    });
  });
}

function context (opts) {
  const profile = net.networkProfile(opts.network);
  if (opts.base != null) profile.base = Number(opts.base);
  const root = net.networkRoot(profile.name, opts.root);
  const instances = net.instancesFor(profile.name, profile.base).map((i) => Object.assign(i, {
    dir: path.join(root, i.name),
    tokenFile: path.join(root, i.name, 'admin-token.txt'),
    fragmentFile: path.join(root, i.name, 'fragment.json')
  }));
  const remotes = (opts.remotes || (opts.playnet ? PLAYNET_HUBS : [])).map(parseRemote);
  return { profile, root, instances, remotes, profileFile: path.join(root, 'network-profile.json') };
}

async function fetchJson (url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: Object.assign({ Accept: 'application/json' }, opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 30000)
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  return { status: res.status, body };
}

/**
 * Which build an origin serves: sha256 of its SPA bundle.
 * @param {string} origin
 * @returns {Promise<{ sha256: string|null, bytes: number|null, lastModified: string|null, error?: string }>}
 */
async function bundleFingerprint (origin) {
  try {
    const res = await fetch(`${origin}/bundles/browser.min.js`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return { sha256: null, bytes: null, lastModified: null, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      lastModified: res.headers.get('last-modified')
    };
  } catch (err) {
    return { sha256: null, bytes: null, lastModified: null, error: err.message };
  }
}

function gitCommit () {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: net.REPO, timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

/**
 * A public Hub as seen over HTTPS: identity, chain, and its own Fabric connection count.
 * @param {{ name: string, host: string, http: string, fabric: string }} remote
 */
async function remoteHealth (remote) {
  const h = Object.assign({}, remote, {
    addresses: [],
    reachable: false,
    pubkey: null,
    attestationVerified: null,
    fabricPeerId: null,
    p2pConnections: null,
    network: null,
    height: null,
    bestHash: null,
    block1: null,
    error: null
  });
  try {
    h.addresses = (await dns.lookup(remote.host, { all: true })).map((a) => a.address);
  } catch (err) {
    h.error = `DNS: ${err.message}`;
    return h;
  }
  try {
    const att = await fetchJson(`${remote.http}/services/peering/attestation`);
    const body = att.body || {};
    const issuer = body.issuer || (body.attestation && body.attestation.issuer) || {};
    const claim = body.claim || (body.attestation && body.attestation.claim) || {};
    h.reachable = att.status === 200;
    h.pubkey = issuer.publicKeyHex || null;
    h.fabricPeerId = claim.fabricPeerId || null;
    h.p2pConnections = claim.p2p && claim.p2p.connections != null ? claim.p2p.connections : null;
    try {
      const PeeringService = require('../services/peering');
      h.attestationVerified = PeeringService.verifyHubAttestation(body).ok;
    } catch (_) {}
  } catch (err) {
    h.error = err.message;
    return h;
  }
  try {
    const btc = (await fetchJson(`${remote.http}/services/bitcoin`)).body || {};
    h.network = btc.network || null;
    h.height = btc.height != null ? btc.height : (btc.blockchain && btc.blockchain.blocks);
    h.bestHash = btc.bestHash || (btc.blockchain && btc.blockchain.bestblockhash) || null;
    const b1 = await fetchJson(`${remote.http}/services/bitcoin`, {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'getblockhash', params: [1] }
    });
    h.block1 = (b1.body && typeof b1.body.result === 'string') ? b1.body.result : null;
  } catch (_) {}
  return h;
}

/** Fabric peer address → bare host (drops `pubkey@`, port, and IPv4-mapped prefix). */
function peerHost (address) {
  return String(address || '')
    .replace(/^[^@]+@/, '')
    .replace(/^\[?::ffff:/i, '')
    .replace(/\]?:\d+$/, '');
}

/** `ip:port` keys a remote's Fabric address resolves to. */
function listenerKeys (remote) {
  const port = remote.fabric.split(':').pop();
  return (remote.addresses || []).map((a) => `${a}:${port}`);
}

/**
 * Remotes grouped by the listener they reach; names sharing an address are one Peer.
 * @returns {Array<Array<object>>}
 */
function sharedListeners (remotes) {
  const groups = [];
  for (const r of remotes) {
    const keys = listenerKeys(r);
    const group = groups.find((g) => g.some((o) => listenerKeys(o).some((k) => keys.includes(k))));
    if (group) group.push(r);
    else groups.push([r]);
  }
  return groups;
}

/**
 * Whether the instance holds a Fabric session to the listener behind `remote`
 * (under its name, its address, or another name for the same address).
 */
function connectedTo (instanceHealthRow, remote, remotes = [remote], field = 'fabricPeerAddresses') {
  const group = sharedListeners(remotes.includes(remote) ? remotes : remotes.concat(remote))
    .find((g) => g.includes(remote)) || [remote];
  const hosts = new Set();
  for (const r of group) {
    hosts.add(r.host);
    for (const a of r.addresses || []) hosts.add(a);
  }
  return (instanceHealthRow[field] || []).some((a) => hosts.has(peerHost(a)));
}

async function instanceHealth (ctx, instance) {
  const h = {
    name: instance.name,
    label: instance.label,
    signer: instance.signer,
    pid: net.readPid(instance.dir),
    running: false,
    http: `http://127.0.0.1:${instance.ports.http}`,
    fabric: `127.0.0.1:${instance.ports.fabric}`,
    bitcoinP2p: `127.0.0.1:${instance.ports.btcP2p}`,
    pubkey: null,
    attestationVerified: null,
    height: null,
    bitcoinPeers: null,
    fabricPeers: null,
    fabricPeerAddresses: [],
    fabricDialing: [],
    block1: null,
    adminTokenFile: fs.existsSync(instance.tokenFile) ? instance.tokenFile : null
  };
  h.running = net.pidAlive(h.pid);
  if (!h.running) return h;
  try {
    const att = await net.httpJson(instance.ports.http, 'GET', '/services/peering/attestation', null, {}, 5000);
    const body = att.body || {};
    const issuer = body.issuer || (body.attestation && body.attestation.issuer) || {};
    h.pubkey = issuer.publicKeyHex || null;
    try {
      const PeeringService = require('../services/peering');
      h.attestationVerified = PeeringService.verifyHubAttestation(body).ok;
    } catch (_) {}
  } catch (_) {}
  try {
    h.height = await bitcoinCli(ctx.profile.name, instance, instance.dir, ['getblockcount']);
    h.bitcoinPeers = await bitcoinCli(ctx.profile.name, instance, instance.dir, ['getconnectioncount']);
    if (Number(h.height) >= 1) h.block1 = await bitcoinCli(ctx.profile.name, instance, instance.dir, ['getblockhash', '1']);
  } catch (_) {}
  try {
    const rpc = await net.httpJson(instance.ports.http, 'POST', '/services/rpc', {
      jsonrpc: '2.0', id: 1, method: 'GetNetworkStatus', params: []
    }, {}, 5000);
    const result = rpc.body && rpc.body.result;
    const peers = result && (result.peers || (result.network && result.network.peers));
    const list = Array.isArray(peers) ? peers : Object.values(peers || {});
    const connected = list.filter((p) => p && p.status === 'connected');
    h.fabricPeers = connected.length;
    // A socket reads "connected" before its handshake; only bytes back make a session.
    const answered = (p) => Number(p.bytesIn) > 0;
    h.fabricPeerAddresses = connected.filter(answered).map((p) => String(p.address || p.id || ''));
    h.fabricDialing = connected.filter((p) => !answered(p)).map((p) => String(p.address || p.id || ''));
  } catch (_) {}
  return h;
}

async function writeProfile (ctx, health, remotes = []) {
  const seed = ctx.instances.find((i) => i.name === 'seed');
  const profile = {
    type: 'FabricLocalNetworkProfile',
    version: 1,
    network: ctx.profile.name,
    generatedAt: new Date().toISOString(),
    bitcoin: {
      network: ctx.profile.name,
      addnode: seed ? [`127.0.0.1:${seed.ports.btcP2p}`] : []
    },
    fabric: {
      peers: ctx.instances.map((i) => `127.0.0.1:${i.ports.fabric}`)
        .concat(remotes.length ? sharedListeners(remotes).map((g) => g[0].fabric) : ctx.remotes.map((r) => r.fabric))
    },
    instances: health.map((h) => ({
      name: h.name,
      label: h.label,
      signer: h.signer,
      http: h.http,
      fabric: h.fabric,
      bitcoinP2p: h.bitcoinP2p,
      pubkey: h.pubkey,
      adminTokenFile: h.adminTokenFile
    })),
    remotes: remotes.map((r) => ({
      name: r.name,
      http: r.http,
      fabric: r.fabric,
      pubkey: r.pubkey,
      bitcoin: { network: r.network, height: r.height, block1: r.block1 }
    }))
  };
  net.writeJson(ctx.profileFile, profile);
  return profile;
}

function printHealth (ctx, health) {
  console.log(`\n======== ${ctx.profile.name.toUpperCase()} LOCAL NETWORK ========`);
  for (const h of health) {
    console.log(`${h.name.padEnd(15)} ${h.running ? 'up  ' : 'down'} ${h.http}  fabric ${h.fabric}  btc ${h.bitcoinP2p}`);
    if (h.running) {
      console.log(`${''.padEnd(15)} height ${h.height == null ? '?' : h.height}  btc peers ${h.bitcoinPeers == null ? '?' : h.bitcoinPeers}` +
        `  fabric peers ${h.fabricPeers == null ? '?' : h.fabricPeers}  key ${h.pubkey || '?'}${h.attestationVerified === false ? ' (attestation NOT verified)' : ''}`);
    }
    if (h.adminTokenFile) console.log(`${''.padEnd(15)} admin token ${h.adminTokenFile}`);
  }
  console.log(`Profile: ${ctx.profileFile}`);
  console.log('==========================================\n');
}

/**
 * Builds, keys, and chains of this tree's instances next to the public Hubs.
 * @returns {Promise<object>} the comparison (also printed)
 */
async function playnetComparison (ctx, health, remotes) {
  const local = health.find((h) => h.running && h.signer) || health.find((h) => h.running);
  const short = (s, n = 16) => (s ? String(s).slice(0, n) : '?');
  const rows = [];
  if (local) {
    let core = null;
    try { core = require('@fabric/core/package.json').version; } catch (_) {}
    rows.push({
      name: `local (${local.name})`,
      origin: local.http,
      bundle: await bundleFingerprint(local.http),
      commit: await gitCommit(),
      core,
      pubkey: local.pubkey,
      network: ctx.profile.name,
      height: local.height,
      block1: local.block1,
      connected: health.filter((h) => h.running).map((h) => h.name)
    });
  }
  for (const r of remotes) {
    rows.push({
      name: r.name,
      origin: r.http,
      bundle: r.reachable ? await bundleFingerprint(r.http) : { sha256: null, error: r.error },
      pubkey: r.pubkey,
      fabricPeerId: r.fabricPeerId,
      p2pConnections: r.p2pConnections,
      network: r.network,
      height: r.height,
      block1: r.block1,
      fabric: `${r.fabric} (${r.addresses.join(', ') || '?'})`,
      connected: health.filter((h) => connectedTo(h, r, remotes)).map((h) => h.name)
    });
  }
  const notes = [];
  const byAddress = new Map();
  for (const r of remotes) {
    const port = r.fabric.split(':').pop();
    for (const a of r.addresses) {
      const k = `${a}:${port}`;
      byAddress.set(k, (byAddress.get(k) || []).concat(r.name));
    }
  }
  for (const [address, names] of byAddress) {
    if (names.length > 1) notes.push(`${names.join(' and ')} share ${address}: one Fabric listener answers every name there`);
  }
  const keyed = new Map();
  for (const r of remotes) if (r.pubkey) keyed.set(r.pubkey, (keyed.get(r.pubkey) || []).concat(r.name));
  for (const [key, names] of keyed) {
    if (names.length > 1) notes.push(`${names.join(' and ')} sign with the same Hub key ${short(key)}…`);
  }
  const builds = new Map();
  for (const row of rows) if (row.bundle && row.bundle.sha256) builds.set(row.bundle.sha256, (builds.get(row.bundle.sha256) || []).concat(row.name));
  notes.push(`${builds.size} distinct build${builds.size === 1 ? '' : 's'}: ` +
    [...builds].map(([sha, names]) => `${short(sha, 12)} (${names.join(', ')})`).join('; '));
  const chains = new Map();
  for (const row of rows) if (row.block1) chains.set(row.block1, (chains.get(row.block1) || []).concat(row.name));
  notes.push(chains.size > 1
    ? `${chains.size} separate ${ctx.profile.name} chains (block 1 differs): ` +
      [...chains].map(([b, names]) => `${short(b, 12)} (${names.join(', ')})`).join('; ')
    : `one ${ctx.profile.name} chain across ${[...chains.values()].flat().join(', ')}`);
  return { rows, notes };
}

async function printPlaynet (ctx, health, remotes) {
  const cmp = await playnetComparison(ctx, health, remotes);
  const short = (s, n = 16) => (s ? String(s).slice(0, n) : '?');
  console.log('======== PLAYNET ========');
  for (const row of cmp.rows) {
    const b = row.bundle || {};
    console.log(`${row.name}  ${row.origin}${row.fabric ? `  fabric ${row.fabric}` : ''}`);
    console.log(`  build   ${b.sha256 ? `${short(b.sha256)} ${b.bytes} bytes${b.lastModified ? `, ${b.lastModified}` : ''}` : `? ${b.error || ''}`}` +
      `${row.commit ? `  git ${row.commit}` : ''}${row.core ? `  @fabric/core ${row.core}` : ''}`);
    console.log(`  key     ${row.pubkey || '?'}${row.p2pConnections != null ? `  fabric connections ${row.p2pConnections}` : ''}`);
    console.log(`  chain   ${row.network || '?'} height ${row.height == null ? '?' : row.height}  block 1 ${short(row.block1)}`);
    if (row.fabric) console.log(`  dialed by ${row.connected.length ? row.connected.join(', ') : 'nobody yet'}`);
  }
  for (const note of cmp.notes) console.log(`- ${note}`);
  console.log('==========================================\n');
  return cmp;
}

/**
 * Health gates: every instance up, distinct verified keys, one chain height.
 * @returns {string[]} problems (empty = healthy)
 */
function healthProblems (ctx, health, remotes = []) {
  const problems = [];
  for (const r of remotes) {
    if (!r.reachable) problems.push(`${r.name} is unreachable${r.error ? `: ${r.error}` : ''}`);
    else if (r.attestationVerified === false) problems.push(`${r.name} attestation signature does not verify`);
    for (const h of health) {
      if (h.running && r.reachable && !connectedTo(h, r, remotes)) problems.push(`${h.name} has no Fabric connection to ${r.name} (${r.fabric})`);
    }
  }
  for (const h of health) {
    if (!h.running) problems.push(`${h.name} is not running`);
    else if (!h.pubkey) problems.push(`${h.name} has no peering attestation`);
    else if (h.attestationVerified === false) problems.push(`${h.name} attestation signature does not verify`);
    if (h.running && health.length > 1 && h.fabricPeers === 0) problems.push(`${h.name} has no Fabric peer connection`);
  }
  const keys = health.map((h) => h.pubkey).filter(Boolean);
  if (new Set(keys).size !== keys.length) problems.push('instances share an identity key');
  if (ctx.profile.seed) {
    const heights = health.map((h) => h.height).filter((x) => x != null);
    if (heights.length !== health.length) problems.push('some bitcoinds did not answer getblockcount');
    else if (new Set(heights).size > 1) problems.push(`chain heights differ: ${heights.join(', ')}`);
  }
  return problems;
}

async function start (ctx) {
  if (ctx.profile.name === 'mainnet' && process.env.FABRIC_FEDERATION_MAINNET !== '1') {
    throw new Error('mainnet deploy refused: set FABRIC_FEDERATION_MAINNET=1 to confirm');
  }
  const env = net.childEnv(ctx.profile.name);
  const seed = ctx.instances.find((i) => i.name === 'seed');
  const resolved = await Promise.all(ctx.remotes.map(async (r) => {
    let addresses = [];
    try { addresses = (await dns.lookup(r.host, { all: true })).map((a) => a.address); } catch (_) {}
    return Object.assign({}, r, { addresses });
  }));
  const remoteDials = sharedListeners(resolved).map((g) => g[0].fabric);
  // Most work wins: joining a longer public chain reorgs this network onto it.
  const btcPort = BITCOIN_P2P_PORTS[ctx.profile.name];
  const remoteBitcoin = btcPort ? sharedListeners(resolved).map((g) => `${g[0].host}:${btcPort}`) : [];
  for (const instance of ctx.instances) {
    fs.mkdirSync(instance.dir, { recursive: true });
    const key = net.ensureInstanceKey(instance.dir);
    // Only the seed dials remotes at boot; `redialRemotes` brings the others in one handshake at a time.
    const fabricPeers = ctx.instances
      .filter((o) => o.name !== instance.name)
      .map((o) => `127.0.0.1:${o.ports.fabric}`)
      .concat(instance.name === 'seed' ? remoteDials : []);
    const fragment = net.buildFragment({
      network: ctx.profile.name,
      instance,
      dir: instance.dir,
      key,
      seedPort: seed ? seed.ports.btcP2p : null,
      fabricPeers,
      // The others sync from the seed.
      bitcoinPeers: instance.name === 'seed' ? remoteBitcoin : []
    });
    net.writeJson(instance.fragmentFile, fragment, 0o600);
  }

  for (const instance of ctx.instances) {
    const pid = net.startDetached(instance.dir, instance.fragmentFile, env);
    console.log(`[deploy] ${instance.name}: pid ${pid}, log ${path.join(instance.dir, 'hub.log')}`);
    await net.waitHttp(instance.ports.http, 180000);
    // First-time setup gates managed bitcoind, so the admin token comes first.
    const token = await net.bootstrapAdmin(instance.ports.http, instance.label, instance.tokenFile, {
      network: ctx.profile.name,
      listen: instance.name === 'seed'
    });
    if (token) console.log(`[deploy] ${instance.name}: admin token → ${instance.tokenFile}`);
    await net.waitBitcoinOnline(instance.ports.http, 240000);
  }

  if (seed) await matureSeed(ctx, seed);

  let health = [];
  let remotes = [];
  let problems = [];
  const t0 = Date.now();
  const waitMs = ctx.remotes.length ? 300000 : 120000;
  while (Date.now() - t0 < waitMs) {
    [health, remotes] = await Promise.all([
      Promise.all(ctx.instances.map((i) => instanceHealth(ctx, i))),
      Promise.all(ctx.remotes.map(remoteHealth))
    ]);
    problems = healthProblems(ctx, health, remotes);
    if (!problems.length) break;
    await redialRemotes(ctx, health, remotes);
    await net.sleep(3000);
  }
  await writeProfile(ctx, health, remotes);
  printHealth(ctx, health);
  if (ctx.remotes.length) await printPlaynet(ctx, health, remotes);
  if (problems.length) {
    throw new Error(`health checks failed:\n  - ${problems.join('\n  - ')}`);
  }
  console.log('[deploy] all health checks passed');
}

const lastRedial = new Map();
const dialingSince = new Map();

/**
 * Hub does not redial a configured peer whose first dial failed, so ask again
 * (`AddPeer`): one handshake in flight per listener (concurrent handshakes stall
 * a busy public Hub), each instance at most every 90 s. A dial unanswered for
 * 60 s stops holding the slot.
 */
async function redialRemotes (ctx, health, remotes) {
  for (const group of sharedListeners(remotes)) {
    const target = group[0];
    const keyOf = (h) => `${h.name} ${listenerKeys(target).join(',') || target.fabric}`;
    const inFlight = health.some((h) => {
      if (!connectedTo(h, target, remotes, 'fabricDialing')) {
        dialingSince.delete(keyOf(h));
        return false;
      }
      if (!dialingSince.has(keyOf(h))) dialingSince.set(keyOf(h), Date.now());
      return Date.now() - dialingSince.get(keyOf(h)) < 60000;
    });
    if (inFlight) continue;
    for (const h of health) {
      if (!h.running || connectedTo(h, target, remotes)) continue;
      const key = keyOf(h);
      if (Date.now() - (lastRedial.get(key) || 0) < 90000) continue;
      lastRedial.set(key, Date.now());
      const instance = ctx.instances.find((i) => i.name === h.name);
      try {
        await net.httpJson(instance.ports.http, 'POST', '/services/rpc', {
          jsonrpc: '2.0', id: 1, method: 'AddPeer', params: [target.fabric]
        }, {}, 5000);
      } catch (_) {}
      return;
    }
  }
}

/** Regtest: mine to the seed until coinbase is spendable so the Beacon has fees. */
async function matureSeed (ctx, seed) {
  try {
    const height = await bitcoinCli(ctx.profile.name, seed, seed.dir, ['getblockcount']);
    if (Number(height) >= 101) return;
    const wallets = await bitcoinCli(ctx.profile.name, seed, seed.dir, ['listwallets']);
    const walletArgs = Array.isArray(wallets) && wallets.length ? [`-rpcwallet=${wallets[0]}`] : [];
    const address = await bitcoinCli(ctx.profile.name, seed, seed.dir, walletArgs.concat(['getnewaddress']));
    await bitcoinCli(ctx.profile.name, seed, seed.dir, ['generatetoaddress', String(101 - Number(height)), address]);
    console.log(`[deploy] seed: mined to height 101 (${address})`);
  } catch (err) {
    console.warn('[deploy] seed: could not pre-mine:', err.message);
  }
}

async function stop (ctx) {
  for (const instance of ctx.instances.slice().reverse()) {
    const stopped = await net.stopDetached(instance.dir);
    console.log(`[deploy] ${instance.name}: ${stopped ? 'stopped' : 'not running'}`);
  }
}

async function reset (ctx, opts) {
  await stop(ctx);
  for (const instance of ctx.instances) {
    if (!fs.existsSync(instance.dir)) continue;
    for (const entry of fs.readdirSync(instance.dir)) {
      if (!opts.keys && entry === 'key.json') continue;
      fs.rmSync(path.join(instance.dir, entry), { recursive: true, force: true });
    }
    console.log(`[deploy] ${instance.name}: reset${opts.keys ? ' (keys removed)' : ''}`);
  }
  try { fs.unlinkSync(ctx.profileFile); } catch (_) {}
}

async function status (ctx, opts) {
  const [health, remotes] = await Promise.all([
    Promise.all(ctx.instances.map((i) => instanceHealth(ctx, i))),
    Promise.all(ctx.remotes.map(remoteHealth))
  ]);
  if (health.some((h) => h.running)) await writeProfile(ctx, health, remotes);
  const problems = healthProblems(ctx, health, remotes);
  if (opts.json) {
    const playnet = ctx.remotes.length ? await playnetComparison(ctx, health, remotes) : null;
    console.log(JSON.stringify({ network: ctx.profile.name, instances: health, remotes, playnet, problems }, null, 2));
    return;
  }
  printHealth(ctx, health);
  if (ctx.remotes.length) await printPlaynet(ctx, health, remotes);
  if (problems.length) console.log(`Problems:\n  - ${problems.join('\n  - ')}`);
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'help') return usage();
  if (!opts.local) {
    usage();
    throw new Error('only --local deploys are implemented; remote hosts reuse the same instance layout later');
  }
  const ctx = context(opts);
  switch (opts.command) {
    case 'start': return start(ctx);
    case 'status': return status(ctx, opts);
    case 'stop': return stop(ctx);
    case 'restart':
      await stop(ctx);
      return start(ctx);
    case 'reset': return reset(ctx, opts);
    default:
      usage();
      throw new Error(`unknown command: ${opts.command}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[deploy]', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { PLAYNET_HUBS, parseArgs, parseRemote, peerHost, sharedListeners, connectedTo, context, healthProblems, bitcoinCli, start, stop, reset };
