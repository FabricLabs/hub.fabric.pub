#!/usr/bin/env node
'use strict';

/**
 * Reproducible Hub deploys. `--local` runs every instance on this machine:
 *
 *   npm run deploy -- --network regtest --local            # start (default)
 *   npm run deploy -- --network regtest --local status
 *   npm run deploy -- --network regtest --local stop
 *   npm run deploy -- --network regtest --local reset [--keys]
 *
 * Instances (see `scripts/lib/localNetwork.js`): `seed` (Bitcoin P2P listen +
 * Beacon miner, regtest only), `hub-fabric-pub`, and `hub-goon-vc`, each with
 * its own generated key under `stores/local-network/<network>/<instance>/`.
 * On regtest the managed bitcoinds form a private network (`-addnode` to the
 * seed); nothing dials the public playnet.
 *
 * `start` writes `stores/local-network/<network>/network-profile.json` (HTTP
 * URLs, Bitcoin addnode, Fabric peers, attestation pubkeys, admin-token
 * paths). A desktop Hub joins with Settings → Network → Import network profile.
 *
 * Mainnet refuses unless `FABRIC_FEDERATION_MAINNET=1`.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const net = require('./lib/localNetwork');

function parseArgs (argv) {
  const out = { command: 'start', network: 'regtest', local: false, keys: false, root: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--network' || a === '-n') out.network = argv[++i];
    else if (a.startsWith('--network=')) out.network = a.slice('--network='.length);
    else if (a === '--local') out.local = true;
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
    'Usage: npm run deploy -- --network <regtest|signet|mainnet> --local [start|status|stop|reset] [--keys] [--json] [--root <dir>] [--base <port>]',
    '',
    '  start   start every instance, bootstrap admin tokens, check health, write network-profile.json',
    '  status  print instance health and the network profile',
    '  stop    stop every instance (SIGTERM, then SIGKILL after 45 s)',
    '  reset   stop, then delete chains and Hub stores (keeps keys unless --keys)'
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
  return { profile, root, instances, profileFile: path.join(root, 'network-profile.json') };
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
  } catch (_) {}
  try {
    const rpc = await net.httpJson(instance.ports.http, 'POST', '/services/rpc', {
      jsonrpc: '2.0', id: 1, method: 'GetNetworkStatus', params: []
    }, {}, 5000);
    const result = rpc.body && rpc.body.result;
    const peers = result && (result.peers || (result.network && result.network.peers));
    const list = Array.isArray(peers) ? peers : Object.values(peers || {});
    h.fabricPeers = list.filter((p) => p && p.status === 'connected').length;
  } catch (_) {}
  return h;
}

async function writeProfile (ctx, health) {
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
 * Health gates: every instance up, distinct verified keys, one chain height.
 * @returns {string[]} problems (empty = healthy)
 */
function healthProblems (ctx, health) {
  const problems = [];
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
  for (const instance of ctx.instances) {
    fs.mkdirSync(instance.dir, { recursive: true });
    const key = net.ensureInstanceKey(instance.dir);
    const fabricPeers = ctx.instances
      .filter((o) => o.name !== instance.name)
      .map((o) => `127.0.0.1:${o.ports.fabric}`);
    const fragment = net.buildFragment({
      network: ctx.profile.name,
      instance,
      dir: instance.dir,
      key,
      seedPort: seed ? seed.ports.btcP2p : null,
      fabricPeers
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
  let problems = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    health = await Promise.all(ctx.instances.map((i) => instanceHealth(ctx, i)));
    problems = healthProblems(ctx, health);
    if (!problems.length) break;
    await net.sleep(2000);
  }
  await writeProfile(ctx, health);
  printHealth(ctx, health);
  if (problems.length) {
    throw new Error(`health checks failed:\n  - ${problems.join('\n  - ')}`);
  }
  console.log('[deploy] all health checks passed');
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
  const health = await Promise.all(ctx.instances.map((i) => instanceHealth(ctx, i)));
  if (health.some((h) => h.running)) await writeProfile(ctx, health);
  if (opts.json) {
    console.log(JSON.stringify({ network: ctx.profile.name, instances: health, problems: healthProblems(ctx, health) }, null, 2));
    return;
  }
  printHealth(ctx, health);
  const problems = healthProblems(ctx, health);
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

module.exports = { parseArgs, context, healthProblems, bitcoinCli, start, stop, reset };
