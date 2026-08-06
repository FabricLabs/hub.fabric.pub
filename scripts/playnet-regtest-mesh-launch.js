'use strict';

/**
 * Spawn three Hub processes: one Bitcoin regtest **seed** (P2P listen) and two followers
 * (`-addnode` to the seed). Fabric TCP peers are wired A↔B and A↔C. First-time HTTP
 * bootstrap (`POST /settings`) runs for each node so the UI is usable without manual onboarding.
 *
 * Prerequisites: `bitcoind` on PATH, repo built (`npm run build:browser` recommended for UI).
 *
 *   npm run playnet:mesh
 *   FABRIC_PLAYNET_MESH_BASE=28200 npm run playnet:mesh -- --open
 *
 * **Desktop:** this script does not start Electron. Point a normal browser (or `npm run desktop`
 * after stopping its bundled hub) at the printed HTTP URLs — or use `--open` to launch the
 * default browser on macOS/Linux.
 *
 * **North star:** behaviour and ports mirror `tests/playnet.beacon.federation.integration.js`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { promisify } = require('util');

const sleep = promisify(setTimeout);

const REPO = path.join(__dirname, '..');
const RUNTIME = path.join(REPO, 'stores', 'playnet-mesh-runtime');
const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

function httpJson (hostname, port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      port,
      path: pathname,
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let j = {};
        try {
          j = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        resolve({ status: res.statusCode, body: j, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitHttp (port, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpJson('127.0.0.1', port, 'GET', '/settings', null);
      if (r.status === 200 || r.status === 403) return;
    } catch (_) {}
    await sleep(400);
  }
  throw new Error(`HTTP 127.0.0.1:${port} did not respond in time`);
}

async function waitBitcoinOnline (port, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpJson('127.0.0.1', port, 'GET', '/services/bitcoin', null);
      if (r.status === 200 && r.body && r.body.available) return;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error(`Bitcoin not online on HTTP port ${port}`);
}

function meshPortsFromBase (base) {
  const b = Number(base);
  if (!Number.isFinite(b) || b < 1024 || b > 65000) {
    throw new Error(`Invalid FABRIC_PLAYNET_MESH_BASE / base: ${base}`);
  }
  return {
    httpA: b + 180,
    httpB: b + 181,
    httpC: b + 182,
    fabricA: b + 277,
    fabricB: b + 278,
    fabricC: b + 279,
    btcP2pA: b + 444,
    btcP2pB: b + 445,
    btcP2pC: b + 446,
    btcRpcA: b + 544,
    btcRpcB: b + 545,
    btcRpcC: b + 546,
    zmqA: b + 920,
    zmqB: b + 921,
    zmqC: b + 922
  };
}

function buildFragments (ports, roots) {
  const extra = ['-maxtxfee=10', '-incrementalrelayfee=0'];
  const a = {
    port: ports.fabricA,
    peers: [],
    fs: { path: roots.a },
    key: { mnemonic: MNEMONIC_A },
    bitcoin: {
      enable: true,
      network: 'regtest',
      managed: true,
      listen: true,
      port: ports.btcP2pA,
      rpcport: ports.btcRpcA,
      zmqPort: ports.zmqA,
      datadir: path.join(roots.a, 'bitcoin-datadir'),
      p2pAddNodes: [],
      bitcoinExtraParams: ['-dnsseed=0'].concat(extra)
    },
    beacon: { enable: true, interval: 4000, regtestOnly: true },
    lightning: { managed: false, stub: true },
    http: { hostname: '127.0.0.1', listen: true, port: ports.httpA },
    debug: false
  };
  const b = {
    port: ports.fabricB,
    peers: [],
    fs: { path: roots.b },
    key: { mnemonic: MNEMONIC_B },
    bitcoin: {
      enable: true,
      network: 'regtest',
      managed: true,
      listen: false,
      port: ports.btcP2pB,
      rpcport: ports.btcRpcB,
      zmqPort: ports.zmqB,
      datadir: path.join(roots.b, 'bitcoin-datadir'),
      p2pAddNodes: [],
      bitcoinExtraParams: ['-dnsseed=0', `-addnode=127.0.0.1:${ports.btcP2pA}`].concat(extra)
    },
    beacon: { enable: false },
    lightning: { managed: false, stub: true },
    http: { hostname: '127.0.0.1', listen: true, port: ports.httpB },
    debug: false
  };
  const c = {
    port: ports.fabricC,
    peers: [],
    fs: { path: roots.c },
    key: { mnemonic: MNEMONIC_C },
    bitcoin: {
      enable: true,
      network: 'regtest',
      managed: true,
      listen: false,
      port: ports.btcP2pC,
      rpcport: ports.btcRpcC,
      zmqPort: ports.zmqC,
      datadir: path.join(roots.c, 'bitcoin-datadir'),
      p2pAddNodes: [],
      bitcoinExtraParams: ['-dnsseed=0', `-addnode=127.0.0.1:${ports.btcP2pA}`].concat(extra)
    },
    beacon: { enable: false },
    lightning: { managed: false, stub: true },
    http: { hostname: '127.0.0.1', listen: true, port: ports.httpC },
    debug: false
  };
  return { a, b, c };
}

async function main () {
  const argv = process.argv.slice(2);
  const wantOpen = argv.includes('--open');
  process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';

  const base = process.env.FABRIC_PLAYNET_MESH_BASE || '28200';
  const ports = meshPortsFromBase(base);

  fs.mkdirSync(RUNTIME, { recursive: true });
  const roots = {
    a: path.join(RUNTIME, 'hub-a'),
    b: path.join(RUNTIME, 'hub-b'),
    c: path.join(RUNTIME, 'hub-c')
  };
  for (const d of Object.values(roots)) {
    fs.mkdirSync(d, { recursive: true });
  }

  const fr = buildFragments(ports, roots);
  const fa = path.join(RUNTIME, 'fragment-a.json');
  const fb = path.join(RUNTIME, 'fragment-b.json');
  const fc = path.join(RUNTIME, 'fragment-c.json');
  fs.writeFileSync(fa, JSON.stringify(fr.a, null, 2));
  fs.writeFileSync(fb, JSON.stringify(fr.b, null, 2));
  fs.writeFileSync(fc, JSON.stringify(fr.c, null, 2));

  const node = process.execPath;
  const script = path.join(REPO, 'scripts', 'playnet-hub-with-settings.js');
  const env = { ...process.env, FABRIC_BITCOIN_SKIP_PLAYNET_PEER: '1' };

  const children = [];
  process.on('SIGINT', () => {
    console.log('\n[playnet-mesh] SIGINT — stopping child hubs…');
    for (const c of children) {
      try {
        c.kill('SIGTERM');
      } catch (_) {}
    }
    process.exit(0);
  });

  function launch (label, jsonPath) {
    const child = spawn(node, [script, jsonPath], {
      cwd: REPO,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const prefix = (s, stream) => {
      const lines = String(s).split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        process[stream].write(`[mesh:${label}] ${line}\n`);
      }
    };
    child.stdout.on('data', (d) => prefix(d, 'stdout'));
    child.stderr.on('data', (d) => prefix(d, 'stderr'));
    child.on('exit', (code, sig) => {
      console.log(`[playnet-mesh] child ${label} exited ${code} ${sig || ''}`);
    });
    children.push(child);
    return child;
  }

  console.log('[playnet-mesh] Starting hub A (Bitcoin seed, P2P listen)…');
  launch('a', fa);
  await waitHttp(ports.httpA);
  await waitBitcoinOnline(ports.httpA);

  console.log('[playnet-mesh] Starting hub B (Bitcoin + addnode seed)…');
  launch('b', fb);
  await waitHttp(ports.httpB);
  await waitBitcoinOnline(ports.httpB);

  console.log('[playnet-mesh] Starting hub C (Bitcoin + addnode seed)…');
  launch('c', fc);
  await waitHttp(ports.httpC);
  await waitBitcoinOnline(ports.httpC);

  const boot = async (port, name, bitcoinManaged) => {
    const r = await httpJson('127.0.0.1', port, 'POST', '/settings', {
      NODE_NAME: name,
      LIGHTNING_MANAGED: false,
      bitcoinManaged: !!bitcoinManaged
    });
    if (r.status === 200) return r.body;
    if (r.status === 403) {
      console.log(`[playnet-mesh] Hub on :${port} already configured; skip POST /settings.`);
      return null;
    }
    throw new Error(`POST /settings on ${port} failed: ${r.status} ${r.raw}`);
  };

  await boot(ports.httpA, 'PlaynetMeshA', true);
  await boot(ports.httpB, 'PlaynetMeshB', true);
  await boot(ports.httpC, 'PlaynetMeshC', true);

  const urlA = `http://127.0.0.1:${ports.httpA}/`;
  const urlB = `http://127.0.0.1:${ports.httpB}/`;
  const urlC = `http://127.0.0.1:${ports.httpC}/`;

  console.log('');
  console.log('======== PLAYNET REGTEST MESH (local) ========');
  console.log('Hub A (seed):', urlA, '| Fabric P2P', ports.fabricA, '| Bitcoin P2P', ports.btcP2pA);
  console.log('Hub B:       ', urlB, '| addnode → 127.0.0.1:' + ports.btcP2pA);
  console.log('Hub C:       ', urlC, '| addnode → 127.0.0.1:' + ports.btcP2pA);
  console.log('In the UI open Bitcoin / Peers on each hub to verify chain height and P2P peers.');
  console.log('Add Fabric peers: B connects to 127.0.0.1:' + ports.fabricA + ' etc. (see integration test).');
  console.log('Stop: Ctrl+C in this terminal (sends SIGINT to children).');
  console.log('==============================================');
  console.log('');

  if (wantOpen) {
    const { execFile } = require('child_process');
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const urls = [urlA, urlB, urlC];
    for (const u of urls) {
      if (opener === 'cmd') {
        execFile('cmd', ['/c', 'start', '', u], () => {});
      } else {
        execFile(opener, [u], () => {});
      }
      await sleep(800);
    }
  }

  await new Promise(() => {});
}

main().catch((e) => {
  console.error('[playnet-mesh]', e && e.stack ? e.stack : e);
  process.exit(1);
});
