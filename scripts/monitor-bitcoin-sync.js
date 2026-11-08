#!/usr/bin/env node
'use strict';

/**
 * @fileoverview Read-only observer for a Hub and its managed bitcoind while
 * the chain syncs. It never changes either process; the only write to
 * bitcoind is a short `logging ["rpc"]` window every `--rpc-mix-every` minutes
 * so the RPC method mix can be counted from `debug.log`.
 *
 *   node scripts/monitor-bitcoin-sync.js --network mainnet --instance operator
 *   node scripts/monitor-bitcoin-sync.js --network mainnet --datadir stores/bitcoin-mainnet-pruned \
 *     --rpc-port 8332 --zmq-port 29500 --hub-port 8080 --hub-log reports/hub.log --hub-pid <pid>
 *   node scripts/monitor-bitcoin-sync.js note --run reports/mainnet-sync/<runId> "restart requested"
 *   node scripts/monitor-bitcoin-sync.js summary --run reports/mainnet-sync/<runId>
 *
 * Writes `reports/mainnet-sync/<runId>/samples.jsonl` (one sample per
 * interval), `events.jsonl` (notes, Hub up/down, sync milestones), and a
 * rolling `summary.md`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const net = require('./lib/localNetwork');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GiB = 1024 * 1024 * 1024;
const LOG_PATTERNS = Object.freeze({
  error: /\[ERROR\]|\bError:/,
  workQueue: /Work queue depth exceeded/i,
  econnreset: /ECONNRESET/,
  hangup: /socket hang up/i,
  timeout: /timed out|timeout after|ETIMEDOUT/i,
  rpcWarmup: /-28|Loading block index|Verifying blocks|warming up/i,
  startFailed: /Bitcoin startup required but failed|failed to start/i
});

function parseArgs (argv) {
  const out = {
    command: 'run',
    network: 'mainnet',
    instance: null,
    root: null,
    out: path.join(net.REPO, 'reports', 'mainnet-sync'),
    run: null,
    intervalSec: 60,
    rpcMixEveryMin: 30,
    rpcMixWindowSec: 120,
    duSamples: 10,
    bitcoinStatusSamples: 5,
    rest: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--network') out.network = next();
    else if (a === '--instance') out.instance = next();
    else if (a === '--root') out.root = next();
    else if (a === '--out') out.out = path.resolve(next());
    else if (a === '--run') out.run = path.resolve(next());
    else if (a === '--interval') out.intervalSec = Number(next());
    else if (a === '--rpc-mix-every') out.rpcMixEveryMin = Number(next());
    else if (a === '--rpc-mix-window') out.rpcMixWindowSec = Number(next());
    else if (a === '--datadir') out.datadir = path.resolve(next());
    else if (a === '--rpc-port') out.rpcPort = Number(next());
    else if (a === '--zmq-port') out.zmqPort = Number(next());
    else if (a === '--hub-port') out.hubPort = Number(next());
    else if (a === '--hub-log') out.hubLog = path.resolve(next());
    else if (a === '--hub-pid-file') out.hubPidFile = path.resolve(next());
    else if (a === '--hub-pid') out.hubPid = Number(next());
    else if (a === '--rpc-user') out.rpcUser = next();
    else if (a === '--rpc-pass') out.rpcPass = next();
    else if (a === '--label') out.label = next();
    else if (a === '--help' || a === '-h') out.command = 'help';
    else if (!a.startsWith('-') && ['run', 'note', 'summary'].includes(a) && out.command === 'run' && !out.rest.length) out.command = a;
    else out.rest.push(a);
  }
  return out;
}

/** bitcoind's per-chain subdirectory (cookie, debug.log). */
function chainDir (datadir, network) {
  const sub = { mainnet: '', main: '', testnet: 'testnet3', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[network];
  return sub ? path.join(datadir, sub) : datadir;
}

/**
 * Where to look, from `--instance` (deploy layout) or explicit flags.
 * @returns {object}
 */
function resolveTarget (opts) {
  const t = { network: opts.network, label: opts.label || opts.instance || 'hub' };
  if (opts.instance) {
    const instance = net.instancesFor(opts.network).find((i) => i.name === opts.instance);
    if (!instance) throw new Error(`no instance "${opts.instance}" on ${opts.network}`);
    const dir = path.join(net.networkRoot(opts.network, opts.root), instance.name);
    Object.assign(t, {
      datadir: path.join(dir, 'bitcoin-datadir'),
      rpcPort: instance.ports.btcRpc,
      zmqPort: instance.ports.zmq,
      hubPort: instance.ports.http,
      hubLog: path.join(dir, 'hub.log'),
      hubPidFile: path.join(dir, 'hub.pid')
    });
  }
  for (const k of ['datadir', 'rpcPort', 'zmqPort', 'hubPort', 'hubLog', 'hubPidFile', 'hubPid', 'rpcUser', 'rpcPass']) {
    if (opts[k] != null && !(typeof opts[k] === 'number' && Number.isNaN(opts[k]))) t[k] = opts[k];
  }
  if (!t.datadir || !t.rpcPort) throw new Error('need --instance, or --datadir and --rpc-port');
  t.chainDir = chainDir(t.datadir, t.network);
  t.debugLog = path.join(t.chainDir, 'debug.log');
  return t;
}

function exec (cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function rpcAuth (t) {
  if (t.rpcUser && t.rpcPass) return `${t.rpcUser}:${t.rpcPass}`;
  try {
    return fs.readFileSync(path.join(t.chainDir, '.cookie'), 'utf8').trim();
  } catch (_) {
    return null;
  }
}

/** One JSON-RPC call to bitcoind; resolves `{ result, error, ms }`. */
function rpc (t, method, params = [], timeoutMs = 30000) {
  const auth = rpcAuth(t);
  const started = Date.now();
  if (!auth) return Promise.resolve({ result: null, error: 'no RPC cookie yet', ms: 0 });
  const body = JSON.stringify({ jsonrpc: '1.0', id: method, method, params });
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: t.rpcPort,
      method: 'POST',
      path: '/',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Basic ${Buffer.from(auth).toString('base64')}`
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const ms = Date.now() - started;
        try {
          const json = JSON.parse(raw);
          resolve({ result: json.result, error: json.error ? `${json.error.code} ${json.error.message}` : null, ms });
        } catch (_) {
          resolve({ result: null, error: `HTTP ${res.statusCode} ${raw.slice(0, 120)}`, ms });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
    req.on('error', (err) => resolve({ result: null, error: err.message, ms: Date.now() - started }));
    req.write(body);
    req.end();
  });
}

/** Timed GET against the Hub; resolves `{ status, ms, bytes, error }`. */
function hubGet (port, pathname, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname, method: 'GET', timeout: timeoutMs,
      headers: { Accept: 'application/json' }
    }, (res) => {
      let bytes = 0;
      let raw = '';
      res.on('data', (c) => { bytes += c.length; if (raw.length < 200000) raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - started, bytes, raw }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: null, ms: Date.now() - started, bytes: 0, error: err.message }));
    req.end();
  });
}

/** Last `UpdateTip` line in debug.log: height, tx count, cache, progress. */
function lastUpdateTip (file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.includes('UpdateTip: new best='));
    const line = lines[lines.length - 1];
    if (!line) return null;
    const pick = (re) => { const m = line.match(re); return m ? m[1] : null; };
    return {
      at: pick(/^(\S+)/),
      height: Number(pick(/height=(\d+)/)),
      tx: Number(pick(/ tx=(\d+)/)),
      blockDate: pick(/date='([^']+)'/),
      progress: Number(pick(/progress=([\d.]+)/)),
      cacheMiB: Number(pick(/cache=([\d.]+)MiB/)),
      cacheTxo: Number(pick(/MiB\((\d+)txo\)/))
    };
  } catch (_) {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

/** `ps` row for a pid: cumulative CPU seconds, RSS bytes, command. */
async function procStats (pid) {
  if (!pid) return null;
  const out = await exec('ps', ['-o', 'pid=,time=,rss=,%cpu=,command=', '-p', String(pid)]);
  if (!out || !out.trim()) return null;
  const m = out.trim().match(/^(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
  if (!m) return null;
  return { pid: Number(m[1]), cpuSec: parseCpuTime(m[2]), rss: Number(m[3]) * 1024, pcpu: Number(m[4]), command: m[5] };
}

/** `ps` time ([dd-]hh:mm:ss.cc or mm:ss.cc) to seconds. */
function parseCpuTime (s) {
  let days = 0;
  let rest = String(s);
  if (rest.includes('-')) {
    const [d, r] = rest.split('-');
    days = Number(d);
    rest = r;
  }
  const parts = rest.split(':').map(Number);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return days * 86400 + sec;
}

/** The bitcoind serving this datadir (any parent). */
async function findBitcoind (datadir) {
  const out = await exec('ps', ['-axo', 'pid=,command=']);
  if (!out) return null;
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && /bitcoind/.test(m[2]) && m[2].includes(datadir)) return Number(m[1]);
  }
  return null;
}

function hubPid (t) {
  if (t.hubPid) return t.hubPid;
  try {
    const n = Number(fs.readFileSync(t.hubPidFile, 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

async function diskFree (dir) {
  let probe = dir;
  while (probe && !fs.existsSync(probe)) probe = path.dirname(probe);
  const out = await exec('df', ['-k', probe]);
  if (!out) return null;
  const row = out.trim().split('\n').pop().split(/\s+/);
  return Number(row[3]) * 1024;
}

async function dirSize (dir) {
  if (!fs.existsSync(dir)) return null;
  const out = await exec('du', ['-sk', dir], 120000);
  return out ? Number(out.split(/\s+/)[0]) * 1024 : null;
}

/** Reads what the Hub appended to its log since the last call. */
function createLogTail (file) {
  let offset = null;
  return function read () {
    const out = { lines: 0, counts: {}, top: {}, heap: null };
    for (const k of Object.keys(LOG_PATTERNS)) out.counts[k] = 0;
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      if (offset == null || size < offset) offset = offset == null ? size : 0;
      let len = size - offset;
      if (len <= 0) return out;
      const start = len > 32 * 1024 * 1024 ? size - 32 * 1024 * 1024 : offset;
      if (start !== offset) out.skippedBytes = start - offset;
      len = size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      offset = size;
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line) continue;
        out.lines++;
        if (line.startsWith('[HUB:HEAP] {')) {
          try { out.heap = JSON.parse(line.slice('[HUB:HEAP] '.length)); } catch (_) {}
          continue;
        }
        let matched = false;
        for (const [k, re] of Object.entries(LOG_PATTERNS)) {
          if (re.test(line)) { out.counts[k]++; matched = true; }
        }
        if (matched) {
          const key = line.replace(/[0-9a-f]{16,}/gi, '<hex>').replace(/\d+/g, 'N').slice(0, 160);
          out.top[key] = (out.top[key] || 0) + 1;
        }
      }
      return out;
    } catch (_) {
      return out;
    } finally {
      if (fd != null) fs.closeSync(fd);
    }
  };
}

/** Counts ZMQ messages by topic on its own subscriber. */
function createZmqCounter (port) {
  const counts = {};
  let sock = null;
  try {
    const zmq = require('zeromq/v5-compat');
    sock = zmq.socket('sub');
    sock.connect(`tcp://127.0.0.1:${port}`);
    sock.subscribe('');
    sock.on('message', (topic) => {
      const k = String(topic);
      counts[k] = (counts[k] || 0) + 1;
    });
  } catch (err) {
    return { take: () => ({ error: err.message }), close () {} };
  }
  return {
    take () {
      const snap = Object.assign({}, counts);
      for (const k of Object.keys(counts)) counts[k] = 0;
      return snap;
    },
    close () { try { sock.close(); } catch (_) {} }
  };
}

/**
 * Turns `rpc` debug logging on for a window and counts methods by name,
 * minus the monitor's own calls during the window.
 */
async function rpcMethodMix (t, windowSec, ownCalls) {
  let startSize = 0;
  try { startSize = fs.statSync(t.debugLog).size; } catch (_) {}
  const on = await rpc(t, 'logging', [['rpc'], []]);
  if (on.error) return { error: on.error };
  const before = Object.assign({}, ownCalls);
  const started = Date.now();
  await sleep(windowSec * 1000);
  await rpc(t, 'logging', [[], ['rpc']]);
  const seconds = (Date.now() - started) / 1000;
  const methods = {};
  try {
    const size = fs.statSync(t.debugLog).size;
    const fd = fs.openSync(t.debugLog, 'r');
    const len = Math.max(0, size - startSize);
    const buf = Buffer.alloc(Math.min(len, 64 * 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, startSize);
    fs.closeSync(fd);
    for (const m of buf.toString('utf8').matchAll(/ThreadRPCServer method=([A-Za-z0-9_]+)/g)) {
      methods[m[1]] = (methods[m[1]] || 0) + 1;
    }
  } catch (err) {
    return { error: err.message };
  }
  for (const [k, n] of Object.entries(ownCalls)) {
    const mine = n - (before[k] || 0);
    if (mine > 0 && methods[k]) methods[k] = Math.max(0, methods[k] - mine);
  }
  delete methods.logging;
  const total = Object.values(methods).reduce((a, b) => a + b, 0);
  const sorted = Object.fromEntries(Object.entries(methods).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]));
  return { at: new Date(started).toISOString(), seconds: Math.round(seconds), total, perSec: Math.round((total / seconds) * 10) / 10, methods: sorted };
}

function appendJson (file, value) {
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

function readJsonl (file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

const fmt = {
  n: (x, d = 0) => (x == null || Number.isNaN(x) ? '?' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })),
  gib: (x) => (x == null ? '?' : `${(x / GiB).toFixed(1)} GiB`),
  mib: (x) => (x == null ? '?' : `${(x / (1024 * 1024)).toFixed(0)} MiB`),
  pct: (x, d = 2) => (x == null ? '?' : `${(x * 100).toFixed(d)}%`),
  h: (x) => (x == null || !Number.isFinite(x) ? '?' : (x >= 48 ? `${(x / 24).toFixed(1)} d` : `${x.toFixed(1)} h`))
};

function percentile (values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

/** Rolling `summary.md` from every sample so far. */
function writeSummary (runDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const samples = readJsonl(path.join(runDir, 'samples.jsonl'));
  const events = readJsonl(path.join(runDir, 'events.jsonl'));
  const mixes = readJsonl(path.join(runDir, 'rpc-mix.jsonl'));
  const last = samples[samples.length - 1] || {};
  const first = samples.find((s) => s.chain) || {};
  const lines = [];
  lines.push(`# Sync monitor: ${meta.label} on ${meta.network}`);
  lines.push('');
  lines.push(`- Run \`${meta.runId}\`, started ${meta.startedAt}; ${samples.length} samples every ${meta.intervalSec} s; updated ${last.at || '?'}.`);
  lines.push(`- Datadir \`${meta.target.datadir}\`, RPC ${meta.target.rpcPort}, ZMQ ${meta.target.zmqPort || '?'}, Hub HTTP ${meta.target.hubPort || '?'}.`);
  if (last.bitcoind && last.bitcoind.command) lines.push(`- bitcoind: \`${last.bitcoind.command}\``);
  if (meta.bitcoindVersion) lines.push(`- Version: ${meta.bitcoindVersion}`);
  lines.push('');
  if (last.chain) {
    const c = last.chain;
    lines.push('## Now');
    lines.push('');
    lines.push(`- Height ${fmt.n(c.blocks)} of ${fmt.n(c.headers)} headers, progress ${fmt.pct(c.verificationprogress, 3)}, IBD ${c.initialblockdownload}.`);
    lines.push(`- Rate (last hour): ${fmt.n(last.derived && last.derived.blocksPerHour)} blocks/h, ${fmt.pct(last.derived && last.derived.progressPerHour, 3)}/h, ETA ${fmt.h(last.derived && last.derived.etaHours)}.`);
    lines.push(`- Disk: blocks ${fmt.gib(c.size_on_disk)}, datadir ${fmt.gib(last.datadirBytes)}, free ${fmt.gib(last.diskFree)}${last.diskFree != null && last.diskFree < 10 * GiB ? ' **(under 10 GiB)**' : ''}.`);
    if (last.tip) lines.push(`- Core cache ${fmt.n(last.tip.cacheMiB, 1)} MiB (${fmt.n(last.tip.cacheTxo)} txo), block date ${last.tip.blockDate}.`);
    lines.push(`- Downloaded ${fmt.gib(last.net && last.net.totalbytesrecv)} (since bitcoind start), peers ${last.net ? last.net.connections : '?'}.`);
    lines.push(`- Hub ${last.hub && last.hub.alive ? 'up' : '**down**'}: CPU ${fmt.pct(last.derived && last.derived.hubCpu, 0)}, RSS ${fmt.mib(last.hub && last.hub.rss)}; bitcoind CPU ${fmt.pct(last.derived && last.derived.bitcoindCpu, 0)}, RSS ${fmt.mib(last.bitcoind && last.bitcoind.rss)}.`);
    lines.push('');
  }
  lines.push('## Hourly');
  lines.push('');
  lines.push('| Hour (UTC) | Height | Blocks/h | Progress | Hub CPU | bitcoind CPU | Hub RSS | ZMQ rawtx/s | ZMQ hashblock | GET /settings p50 / max ms | timeouts | log errors | loop p99 / max ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const hours = new Map();
  for (const s of samples) {
    const k = String(s.at).slice(0, 13);
    if (!hours.has(k)) hours.set(k, []);
    hours.get(k).push(s);
  }
  for (const [k, group] of hours) {
    const g0 = group.find((s) => s.chain) || {};
    const g1 = [...group].reverse().find((s) => s.chain) || {};
    const avg = (f) => { const v = group.map(f).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const sum = (f) => group.map(f).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const spanH = g0.at && g1.at ? (Date.parse(g1.at) - Date.parse(g0.at)) / 3600000 : 0;
    const blocks = g0.chain && g1.chain ? g1.chain.blocks - g0.chain.blocks : null;
    const lat = group.map((s) => s.hubHttp && s.hubHttp.settings && s.hubHttp.settings.ms);
    const timeouts = group.filter((s) => s.hubHttp && s.hubHttp.settings && s.hubHttp.settings.status == null).length;
    const loops = group.map((s) => s.hubHeap && s.hubHeap.eventLoop).filter(Boolean);
    lines.push(`| ${k}:00 | ${g1.chain ? fmt.n(g1.chain.blocks) : '?'} | ${blocks != null && spanH > 0 ? fmt.n(blocks / spanH) : '?'} | ${g1.chain ? fmt.pct(g1.chain.verificationprogress, 2) : '?'} | ` +
      `${fmt.pct(avg((s) => s.derived && s.derived.hubCpu), 0)} | ${fmt.pct(avg((s) => s.derived && s.derived.bitcoindCpu), 0)} | ${fmt.mib(avg((s) => s.hub && s.hub.rss))} | ` +
      `${fmt.n(avg((s) => s.derived && s.derived.zmqPerSec && s.derived.zmqPerSec.rawtx), 0)} | ${fmt.n(sum((s) => s.zmq && s.zmq.hashblock))} | ` +
      `${fmt.n(percentile(lat, 50))} / ${fmt.n(percentile(lat, 100))} | ${timeouts} | ${fmt.n(sum((s) => s.hubLog && s.hubLog.counts && s.hubLog.counts.error))} | ` +
      `${loops.length ? `${fmt.n(Math.max(...loops.map((l) => l.p99Ms)))} / ${fmt.n(Math.max(...loops.map((l) => l.maxMs)))}` : '?'} |`);
  }
  lines.push('');
  if (mixes.length) {
    lines.push('## RPC method mix (bitcoind `rpc` log windows, monitor calls removed)');
    lines.push('');
    for (const m of mixes.slice(-12)) {
      if (m.error) { lines.push(`- ${m.at || '?'}: ${m.error}`); continue; }
      const top = Object.entries(m.methods || {}).slice(0, 10).map(([k, n]) => `${k} ${n}`).join(', ');
      lines.push(`- ${m.at} (height ${fmt.n(m.height)}): ${fmt.n(m.total)} calls in ${m.seconds} s (${m.perSec}/s): ${top || 'none'}`);
    }
    lines.push('');
  }
  const top = {};
  for (const s of samples) for (const [k, n] of Object.entries((s.hubLog && s.hubLog.top) || {})) top[k] = (top[k] || 0) + n;
  const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (topList.length) {
    lines.push('## Most frequent Hub log problems');
    lines.push('');
    for (const [k, n] of topList) lines.push(`- ${fmt.n(n)} × \`${k.replace(/`/g, "'")}\``);
    lines.push('');
  }
  if (events.length) {
    lines.push('## Events');
    lines.push('');
    for (const e of events) lines.push(`- ${e.at}: ${e.type}${e.text ? ` — ${e.text}` : ''}${e.height != null ? ` (height ${fmt.n(e.height)})` : ''}`);
    lines.push('');
  }
  if (first.at) lines.push(`First chain sample ${first.at} at height ${fmt.n(first.chain && first.chain.blocks)}.`);
  fs.writeFileSync(path.join(runDir, 'summary.md'), lines.join('\n') + '\n');
}

async function run (opts) {
  const t = resolveTarget(opts);
  const runId = `${t.network}-${t.label}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const runDir = opts.run || path.join(opts.out, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    samples: path.join(runDir, 'samples.jsonl'),
    events: path.join(runDir, 'events.jsonl'),
    mix: path.join(runDir, 'rpc-mix.jsonl')
  };
  const meta = {
    runId: path.basename(runDir),
    label: t.label,
    network: t.network,
    startedAt: new Date().toISOString(),
    intervalSec: opts.intervalSec,
    target: Object.assign({}, t, { rpcPass: t.rpcPass ? '<set>' : undefined }),
    monitorPid: process.pid
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(path.join(runDir, 'monitor.pid'), `${process.pid}\n`);
  console.log(`[monitor] ${runDir}`);

  const ownCalls = {};
  const call = (method, params, timeoutMs) => {
    ownCalls[method] = (ownCalls[method] || 0) + 1;
    return rpc(t, method, params, timeoutMs);
  };
  const event = (type, text, extra = {}) => appendJson(files.events, Object.assign({ at: new Date().toISOString(), type, text }, extra));
  const logTail = t.hubLog ? createLogTail(t.hubLog) : () => null;
  const zmq = t.zmqPort ? createZmqCounter(t.zmqPort) : null;
  const history = [];
  let prev = null;
  let lastHeap = null;
  let wasAlive = null;
  let lastHubPid = null;
  let wasIbd = null;
  let mixDueAt = Date.now() + 5 * 60 * 1000;
  let mixRunning = false;
  let stopping = false;
  let i = 0;
  event('monitor-start', `pid ${process.pid}`);

  const stop = () => {
    if (stopping) return;
    stopping = true;
    event('monitor-stop', 'signal');
    try { writeSummary(runDir); } catch (_) {}
    if (zmq) zmq.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    const tickStarted = Date.now();
    const s = { at: new Date().toISOString(), n: i };
    const errors = {};
    const bci = await call('getblockchaininfo', [], 30000);
    s.rpcMs = bci.ms;
    if (bci.result) {
      const c = bci.result;
      s.chain = {
        blocks: c.blocks, headers: c.headers, verificationprogress: c.verificationprogress,
        initialblockdownload: c.initialblockdownload, size_on_disk: c.size_on_disk,
        pruned: c.pruned, pruneheight: c.pruneheight, mediantime: c.mediantime
      };
    } else errors.getblockchaininfo = bci.error;
    const [nt, ni, ri, mi] = await Promise.all([
      call('getnettotals'), call('getnetworkinfo'), call('getrpcinfo'), call('getmempoolinfo')
    ]);
    if (nt.result || ni.result) {
      s.net = {
        totalbytesrecv: nt.result && nt.result.totalbytesrecv,
        totalbytessent: nt.result && nt.result.totalbytessent,
        connections: ni.result && ni.result.connections,
        connectionsIn: ni.result && ni.result.connections_in,
        connectionsOut: ni.result && ni.result.connections_out
      };
      if (ni.result && !meta.bitcoindVersion) {
        meta.bitcoindVersion = `${ni.result.subversion} (${ni.result.version})`;
        fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(meta, null, 2) + '\n');
      }
    }
    if (ri.result) s.rpcActive = (ri.result.active_commands || []).map((c) => c.method).filter((m) => m !== 'getrpcinfo');
    if (mi.result) s.mempool = { size: mi.result.size, bytes: mi.result.bytes, usage: mi.result.usage };
    s.tip = lastUpdateTip(t.debugLog);

    const pid = hubPid(t);
    const bitcoindPid = await findBitcoind(t.datadir);
    const [hubProc, btcProc] = await Promise.all([procStats(pid), procStats(bitcoindPid)]);
    s.hub = { pid, alive: !!hubProc, rss: hubProc && hubProc.rss, cpuSec: hubProc && hubProc.cpuSec, pcpu: hubProc && hubProc.pcpu };
    s.bitcoind = btcProc ? { pid: btcProc.pid, rss: btcProc.rss, cpuSec: btcProc.cpuSec, pcpu: btcProc.pcpu } : null;
    if (btcProc && (!prev || !prev.bitcoind || prev.bitcoind.pid !== btcProc.pid)) s.bitcoind.command = btcProc.command;
    else if (btcProc && i % 60 === 0) s.bitcoind.command = btcProc.command;

    if (t.hubPort) {
      s.hubHttp = { settings: await hubGet(t.hubPort, '/settings', 30000) };
      delete s.hubHttp.settings.raw;
      if (i % opts.bitcoinStatusSamples === 0) {
        const st = await hubGet(t.hubPort, '/services/bitcoin', 60000);
        let available = null;
        try { available = JSON.parse(st.raw).available; } catch (_) {}
        delete st.raw;
        s.hubHttp.bitcoin = Object.assign(st, { available });
      }
    }
    const logs = logTail();
    if (logs) {
      if (logs.heap) lastHeap = logs.heap;
      s.hubLog = { lines: logs.lines, counts: logs.counts, top: logs.top, skippedBytes: logs.skippedBytes };
    }
    if (lastHeap) {
      s.hubHeap = {
        at: lastHeap.at,
        rss: lastHeap.memory && lastHeap.memory.rss,
        heapUsed: lastHeap.memory && lastHeap.memory.heapUsed,
        eventLoop: lastHeap.eventLoop || null,
        pending: lastHeap.pending || null,
        fabricMessages: lastHeap.retainers && lastHeap.retainers.fabricMessages,
        chainHistory: lastHeap.retainers && lastHeap.retainers.chainHistory
      };
    }
    if (zmq) s.zmq = zmq.take();
    s.diskFree = await diskFree(t.datadir);
    if (i % opts.duSamples === 0) s.datadirBytes = await dirSize(t.datadir);
    else if (prev) s.datadirBytes = prev.datadirBytes;
    if (Object.keys(errors).length) s.errors = errors;

    // Rates: CPU and ZMQ over the last interval; blocks and progress over about an hour.
    const d = {};
    if (prev) {
      const dt = (Date.parse(s.at) - Date.parse(prev.at)) / 1000;
      if (dt > 0) {
        if (s.hub.cpuSec != null && prev.hub && prev.hub.cpuSec != null && s.hub.pid === prev.hub.pid) d.hubCpu = (s.hub.cpuSec - prev.hub.cpuSec) / dt;
        if (s.bitcoind && prev.bitcoind && s.bitcoind.pid === prev.bitcoind.pid) d.bitcoindCpu = (s.bitcoind.cpuSec - prev.bitcoind.cpuSec) / dt;
        if (s.net && prev.net && s.net.totalbytesrecv >= prev.net.totalbytesrecv) d.recvBytesPerSec = Math.round((s.net.totalbytesrecv - prev.net.totalbytesrecv) / dt);
        if (s.tip && prev.tip && s.tip.tx >= prev.tip.tx) d.txPerSec = Math.round((s.tip.tx - prev.tip.tx) / dt);
        if (s.zmq && !s.zmq.error) d.zmqPerSec = Object.fromEntries(Object.entries(s.zmq).map(([k, n]) => [k, Math.round((n / dt) * 10) / 10]));
      }
    }
    if (s.chain) history.push({ at: Date.parse(s.at), blocks: s.chain.blocks, progress: s.chain.verificationprogress });
    while (history.length > 2 && history[0].at < Date.parse(s.at) - 3600000) history.shift();
    if (history.length >= 2) {
      const a = history[0];
      const b = history[history.length - 1];
      const hrs = (b.at - a.at) / 3600000;
      if (hrs > 0) {
        d.blocksPerHour = Math.round((b.blocks - a.blocks) / hrs);
        d.progressPerHour = (b.progress - a.progress) / hrs;
        if (d.progressPerHour > 0) d.etaHours = (1 - b.progress) / d.progressPerHour;
      }
    }
    s.derived = d;
    appendJson(files.samples, s);

    if (wasAlive !== null && wasAlive !== s.hub.alive) event(s.hub.alive ? 'hub-up' : 'hub-down', `pid ${pid}`, { height: s.chain && s.chain.blocks });
    if (s.hub.alive && lastHubPid && pid !== lastHubPid) event('hub-new-pid', `${lastHubPid} -> ${pid}`, { height: s.chain && s.chain.blocks });
    if (s.chain && wasIbd === true && s.chain.initialblockdownload === false) event('ibd-complete', null, { height: s.chain.blocks });
    if (s.diskFree != null && s.diskFree < 10 * GiB && (!prev || prev.diskFree == null || prev.diskFree >= 10 * GiB)) event('disk-low', fmt.gib(s.diskFree));
    wasAlive = s.hub.alive;
    if (s.hub.alive) lastHubPid = pid;
    if (s.chain) wasIbd = s.chain.initialblockdownload;

    if (!mixRunning && opts.rpcMixEveryMin > 0 && Date.now() >= mixDueAt && s.chain) {
      mixRunning = true;
      mixDueAt = Date.now() + opts.rpcMixEveryMin * 60 * 1000;
      const height = s.chain.blocks;
      rpcMethodMix(t, opts.rpcMixWindowSec, ownCalls)
        .then((m) => appendJson(files.mix, Object.assign({ height }, m)))
        .catch((err) => appendJson(files.mix, { at: new Date().toISOString(), height, error: err.message }))
        .finally(() => { mixRunning = false; });
    }
    try { writeSummary(runDir); } catch (err) { console.warn('[monitor] summary failed:', err.message); }
    prev = s;
    i++;
    await sleep(Math.max(1000, opts.intervalSec * 1000 - (Date.now() - tickStarted)));
  }
}

function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  if (opts.command === 'note') {
    if (!opts.run) throw new Error('note needs --run <dir>');
    appendJson(path.join(opts.run, 'events.jsonl'), { at: new Date().toISOString(), type: 'note', text: opts.rest.join(' ') });
    writeSummary(opts.run);
    return;
  }
  if (opts.command === 'summary') {
    if (!opts.run) throw new Error('summary needs --run <dir>');
    writeSummary(opts.run);
    process.stdout.write(fs.readFileSync(path.join(opts.run, 'summary.md'), 'utf8'));
    return;
  }
  run(opts).catch((err) => {
    console.error('[monitor]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { parseArgs, resolveTarget, chainDir, parseCpuTime, lastUpdateTip, createLogTail, writeSummary, percentile };
