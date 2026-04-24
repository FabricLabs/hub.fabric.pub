'use strict';

/**
 * Playnet market + mesh integration
 * ---------------------------------
 * 1) **Always-on:** pure `runPlaynetMarketSimulation` — stochastic rounds (unchanged).
 * 2) **Fabric mesh:** `FABRIC_PLAYNET_MESH=1` — N hubs without Bitcoin, federation manifest,
 *    ring + star `AddPeer`, publish document, resync; **final report prints once at the end**
 *    (no mid-test tables). Console noise masked during mesh tests.
 * 3) **L1 mesh:** `FABRIC_PLAYNET_MESH_L1=1` — **hub 0** runs managed regtest Bitcoin (mine + all L1 pays);
 *    **hubs 1…n−1** are Fabric-only (avoids N bitcoinds in one Node). Ring + star `AddPeer`, then
 *    **multiple internal rounds** of real L1 on hub 0: publish (purchase price) → distribute invoice →
 *    pay → mine → storage contract → purchase invoice → pay → mine → claim. Documents are pushed
 *    to peers with `SendPeerFile` (listen address, then Fabric id if the session key differs);
 *    replication is polled with `GetDocument` on every satellite. **Also:** unhappy-path RPC checks
 *    (failed storage contract + failed claim, then successful completion), Fabric **partition** (hub0↔hub2
 *    `RemovePeer`, expect `SendPeerFile` failure, then heal + successful P2P file delivery / “download” on
 *    hub 2). **Chain audit:** native **HTTP JSON** (`GET /services/bitcoin/blocks/…`, `…/transactions/…`)
 *    + JSON-RPC `GetBitcoinStatus` on the audit base (playnet hub 0 or `FABRIC_PLAYNET_BROWSER_HTTP_BASE` /
 *    desktop star). Set `FABRIC_PLAYNET_MESH_BROWSER=0` to skip **L1** chain audit (default: on with L1 mesh).
 *    `FABRIC_PLAYNET_BROWSER_DEEP_*` adds block/tx JSON GETs on that base.
 *
 *   FABRIC_PLAYNET_MESH=1 FABRIC_PLAYNET_NODES=7 npm run test:playnet-mesh
 *   FABRIC_PLAYNET_MESH_L1=1 npm run test:playnet-mesh-l1
 *   Fabric mesh ignores `FABRIC_MNEMONIC` for hub identity — each hub gets a fixed test phrase so peers stay distinct.
 *   Optional: `FABRIC_PLAYNET_MESH_RESYNC_TIMEOUT_MS`, `FABRIC_PLAYNET_MESH_RESYNC_POLL_MS` for catalog convergence waits.
 *   `FABRIC_PLAYNET_MESH_RESYNC_GAP_MS` (default 1200), `FABRIC_PLAYNET_MESH_RESYNC_ROUNDS` (default 2) — stagger ChainSync to hub 0.
 *
 * **Why Bitcoin height ≠ hub.fabric.pub (or any public hub):** this suite spawns **throwaway** hubs under
 * `stores/playnet-mesh-*` with **isolated** datadirs. `test:playnet-mesh` sets **bitcoin.enable: false** on
 * every hub (Fabric-only; no L1 chain). `test:playnet-mesh-l1` uses **regtest** on hub 0 only and mines
 * ~150 blocks at startup plus a few per scenario (~150–250 total typical) — unrelated to a live site’s
 * mainnet/signet/regtest tip (e.g. thousands of blocks on a long-running operator node).
 *
 * **Desktop Hub (Electron) + L1 mesh:** optional env merges the running desktop into the playnet:
 *   `FABRIC_PLAYNET_DESKTOP_FABRIC=127.0.0.1:7777` — each mesh hub `AddPeer`s the desktop Fabric P2P port
 *     (`FABRIC_PORT` / default 7777).
 *   `FABRIC_PLAYNET_DESKTOP_BITCOIN_P2P=127.0.0.1:<desktop-regtest-p2p>` — playnet hub 0 `bitcoin.p2pAddNodes`
 *     so Core syncs with the desktop wallet’s regtest peer group (port from desktop Bitcoin status / your config).
 *   `FABRIC_PLAYNET_DESKTOP_HTTP=http://127.0.0.1:8080` — printed **MCP** hints (Bitcoin home, txs).
 *   `FABRIC_PLAYNET_BROWSER_HTTP_BASE` — chain audit + `GetBitcoinStatus` target this Hub (e.g. desktop HTTP).
 *   `FABRIC_PLAYNET_BROWSER_USE_DESKTOP_HTTP=1` — same as setting browser base to `FABRIC_PLAYNET_DESKTOP_HTTP`
 *     or the default `http://127.0.0.1:8080` when desktop fabric/P2P env is set.
 *   `FABRIC_PLAYNET_DESKTOP_STAR=1` — **one switch** for local desktop: fills unset `FABRIC_PLAYNET_DESKTOP_*` from
 *     `settings/local.js` loopback defaults (`127.0.0.1` + `port` / `http.port` / Fabric Bitcoin `port` or **18444**
 *     P2P for regtest when `bitcoin.port` is unset — matches managed Hub bitcoind `-port`). Also aims chain audit + `GetBitcoinStatus`
 *     at that HTTP URL. Override any piece with the explicit `DESKTOP_*` envs.
 *   On the **desktop** UI (or RPC), add Fabric peer `127.0.0.1:<playnet-hub-0-fabric-port>` (logged as `[PLAYNET:MCP]`)
 *   so the connection is reciprocal.
 *   `FABRIC_PLAYNET_BROWSER_DEEP_TX=1` — extra `GET /services/bitcoin/transactions/<txid>` (JSON) for sample txids.
 *   `FABRIC_PLAYNET_BROWSER_DEEP_BLOCK=1` — extra `GET /services/bitcoin/blocks/<bestHash>` for chain tip block JSON.
 *   Pure simulation: `FABRIC_PLAYNET_SIM_FEDERATION_COUNT` — optional cohort size for federation vs normal profit table.
 *
 * **Shared regtest (Bitcoin Core P2P + longest-chain rules):** `FABRIC_PLAYNET_L1_SYNC_BITCOIN_P2P=1` — this suite does **not**
 * set `FABRIC_BITCOIN_SKIP_PLAYNET_PEER`, so hub 0’s managed regtest merges the default playnet `addnode` target
 * (`FABRIC_BITCOIN_PLAYNET_PEER`, else `hub.fabric.pub:18444`) with `p2pAddNodes` / `FABRIC_BITCOIN_P2P_ADDNODES`.
 * Hub 0 sets `listen: false` so the ephemeral P2P port is not advertised; operators use default `listen: true` on standard
 * ports. Chain sync here uses **outbound** `addnode` to the playnet peer
 * and optional `FABRIC_PLAYNET_DESKTOP_BITCOIN_P2P` — no inbound P2P bind on the ephemeral `-port`. After HTTP-ready, the test waits for tip stability (or
 * `FABRIC_PLAYNET_L1_SYNC_TIMEOUT_MS`), then **skips** the ~150-block `generatetoaddress` bootstrap when
 * `getblockcount` ≥ `FABRIC_PLAYNET_L1_SYNC_MIN_HEIGHT` (default `101`). Force local mining anyway with
 * `FABRIC_PLAYNET_L1_FORCE_BOOTSTRAP_MINES=1`. Remote hub must be **regtest** on the same chain; conflict resolution
 * is ordinary Bitcoin block acceptance. If the chain is deep but this hub’s **wallet** has no coins (fresh datadir),
 * the test still runs the bootstrap `generatetoaddress` loop (extends the shared tip); tune via `FABRIC_PLAYNET_L1_MIN_WALLET_BTC`
 * (default `0.05` BTC) to treat balance as sufficient and skip those mines. Balance is read via the **named Fabric
 * wallet** (`getbalances` on the wallet endpoint), not node-level `getbalance`, which is wrong under multiwallet.
 *
 * **L1 visibility:** `FABRIC_PLAYNET_L1_TX_LOG=0` silences `[PLAYNET:L1_TX]` mempool/confirmation lines (default logs).
 * The suite prints wallet/traffic economics under `[PLAYNET:L1_ECONOMICS]` and ties **simulation profit** (first test)
 * to **deterministic settlement + satellite replication** (L1 mesh).
 * **Reference doc:** round-0 published document is asserted on **every** hub (catalog + matching `contentBase64`); final report
 * includes **Per-node cost / benefit** (hub 0: invoices + miner fees + regtest subsidy; satellites: no L1 spend). Miner fees use
 * wallet `gettransaction` when plausible (under 0.05 BTC), else **vsize×1 sat** lower bound (large regtest UTXOs confuse `fee`).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const merge = require('lodash.merge');

const { hubSettingsMerge } = require('../functions/hubSettingsMerge');
const Hub = require('../services/hub');
const settings = require('../settings/local');
const { installMaskedConsole } = require('../functions/playnetMaskedConsole');
const {
  runPlaynetMarketSimulation,
  formatPlaynetSimulationReport
} = require('../functions/playnetMarketSimulation');

const playnetReport =
  process.env.FABRIC_PLAYNET_REPORT !== '0' && process.env.FABRIC_PLAYNET_REPORT !== 'false';

/** Per-tx mempool → `generateblock` confirmation logging on the L1 mesh test (default on). */
const playnetL1TxLog =
  process.env.FABRIC_PLAYNET_L1_TX_LOG !== '0' && process.env.FABRIC_PLAYNET_L1_TX_LOG !== 'false';

const runMeshFabric = process.env.FABRIC_PLAYNET_MESH === '1' || process.env.FABRIC_PLAYNET_MESH === 'true';
const runMeshL1 =
  process.env.FABRIC_PLAYNET_MESH_L1 === '1' || process.env.FABRIC_PLAYNET_MESH_L1 === 'true';
const meshBrowserExplicitOff =
  process.env.FABRIC_PLAYNET_MESH_BROWSER === '0' || process.env.FABRIC_PLAYNET_MESH_BROWSER === 'false';
const meshBrowserExplicitOn =
  process.env.FABRIC_PLAYNET_MESH_BROWSER === '1' || process.env.FABRIC_PLAYNET_MESH_BROWSER === 'true';
/** When true, L1 mesh runs native HTTP/JSON chain audit (no headless browser). */
const runMeshL1ChainAudit =
  meshBrowserExplicitOn || (!meshBrowserExplicitOff && runMeshL1);
const runMesh = runMeshFabric || runMeshL1;

/** When set, mesh `before` omits `FABRIC_BITCOIN_SKIP_PLAYNET_PEER` so Core can addnode the playnet/regtest peer. */
const playnetL1SyncBitcoinP2p =
  process.env.FABRIC_PLAYNET_L1_SYNC_BITCOIN_P2P === '1' ||
  process.env.FABRIC_PLAYNET_L1_SYNC_BITCOIN_P2P === 'true';

const playnetBrowserDeepTx =
  process.env.FABRIC_PLAYNET_BROWSER_DEEP_TX === '1' ||
  process.env.FABRIC_PLAYNET_BROWSER_DEEP_TX === 'true';
const playnetBrowserDeepBlock =
  process.env.FABRIC_PLAYNET_BROWSER_DEEP_BLOCK === '1' ||
  process.env.FABRIC_PLAYNET_BROWSER_DEEP_BLOCK === 'true';

const playnetDesktopStar =
  process.env.FABRIC_PLAYNET_DESKTOP_STAR === '1' ||
  process.env.FABRIC_PLAYNET_DESKTOP_STAR === 'true';

/**
 * Loopback desktop Hub defaults when `FABRIC_PLAYNET_DESKTOP_STAR=1`.
 * Bitcoin P2P: `settings.bitcoin.port` if set, else **18444** for regtest / **8333** for mainnet (@fabric/core defaults).
 */
function playnetResolveDesktopStarDefaults () {
  const host =
    String(process.env.FABRIC_PLAYNET_DESKTOP_STAR_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const httpPort = Number(settings.http && settings.http.port) || 8080;
  const fabricPort = Number(settings.port) || 7777;
  const btcNetwork =
    settings.bitcoin && settings.bitcoin.network
      ? String(settings.bitcoin.network).trim().toLowerCase()
      : 'regtest';
  const defaultP2p = btcNetwork === 'regtest' ? 18444 : 8333;
  const btcP2pPort =
    settings.bitcoin && settings.bitcoin.port != null && String(settings.bitcoin.port).trim() !== ''
      ? Number(settings.bitcoin.port)
      : defaultP2p;
  return {
    fabric: `${host}:${fabricPort}`,
    http: `http://${host}:${httpPort}`.replace(/\/+$/, ''),
    bitcoinP2p: `${host}:${btcP2pPort}`
  };
}

/**
 * Spendable BTC in the Fabric named Core wallet. Node-level `getbalance` is unreliable when multiple
 * wallets are loaded; mining and spends use the Fabric wallet RPC.
 */
async function playnetFabricWalletTrustedBtc (btc) {
  if (!btc || typeof btc._loadWallet !== 'function') return 0;
  try {
    await btc._loadWallet(btc.walletName);
  } catch (_) { /* non-fatal */ }
  try {
    const g = await btc._makeWalletRequest('getbalances', [], btc.walletName);
    const mine = g && g.mine && typeof g.mine === 'object' ? g.mine : {};
    const t = Number(mine.trusted);
    const p = Number(mine.untrusted_pending);
    const trusted = Number.isFinite(t) ? t : 0;
    const pend = Number.isFinite(p) ? p : 0;
    return trusted + pend;
  } catch (_) {
    const b = Number(
      await btc._makeWalletRequest('getbalance', ['*', 0, false], btc.walletName).catch(() => NaN)
    );
    return Number.isFinite(b) ? b : 0;
  }
}

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

/**
 * One distinct BIP39 phrase per mesh hub (max 15). Avoids inheriting `FABRIC_MNEMONIC` / `settings.key`,
 * which would give every hub the same Fabric id and break P2P + catalog replication.
 */
const PLAYNET_MESH_MNEMONICS = [
  MNEMONIC_A,
  MNEMONIC_B,
  MNEMONIC_C,
  'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic',
  'gravity trophy super accident disease wrestle princess million silk problem border',
  'turtle salad enlist busy shuffle bulb crab useful work solar pelican discover',
  'void come effort suffer camp faith million banner alone panther weekend allow',
  'cat swing flag economy stadium alone churn speed unique patch report train',
  'light rule cinnamon mesh drastic easy spirit twist couple desert arena noise',
  'hamster diagram private dutch cause delay private meat slide toddler razor book',
  'scheme spot draw tide estate vehicle embrace admit female whale dash cross',
  'near account window bike charge curtain ceremony uncle exclude fire',
  'pork resemble laptop black fancy cycle shift pen pledge tape civil wave',
  'fragile fog grant lab retreat night match sign drama shoulder lens',
  'clutch control favorite shuffle credit enough smoke monitor hub remove cargo'
];

const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0'];

/**
 * @param {string[]} httpBases
 * @param {{ illustrativeOfferSats?: number, publishedDocId?: string, mode?: string, l1ExtraLines?: string[], federation?: { threshold: number, validatorPubkeysHex: string[], fabricPorts?: number[] }, referenceDocument?: { id: string, rows?: { hub: number, listed: boolean, payloadMatch: boolean }[] }, nodeEconomics?: string[] }} [opts]
 */
async function formatPlaynetMeshFinalReport (httpBases, opts = {}) {
  const illustrative = Math.max(1, Number(opts.illustrativeOfferSats) || 11_000);
  const wantId = opts.publishedDocId ? String(opts.publishedDocId).trim() : '';
  const mode = opts.mode || 'fabric';
  const lines = [];
  lines.push('');
  lines.push('======== PLAYNET MESH — FINAL REPORT ========');
  if (mode === 'l1') {
    lines.push(
      'Mode: **L1** — Bitcoin on hub 0 only; satellite hubs Fabric-only; real distribute + purchase txs on hub 0.'
    );
  } else {
    lines.push(
      'Mode: **Fabric-only** — hubs run with bitcoin.enable: false (no wallet / beacon epochs on L1).'
    );
  }
  lines.push(
    `Illustrative sat/byte: flat ${illustrative} sats per distribute-style offer ÷ stored payload bytes (metadata size).`
  );
  lines.push('hub | HTTP base | peers | docs listed | published | bytes (sum meta.size) | sats/B @ illustrative');
  for (let i = 0; i < httpBases.length; i++) {
    const base = httpBases[i];
    let peers = 0;
    try {
      const st = await rpc(base, 'GetNetworkStatus', []);
      const pb = st && st.peers;
      peers = pb && typeof pb === 'object' ? Object.keys(pb).length : 0;
    } catch (e) {
      lines.push(` ${i} | (GetNetworkStatus failed: ${e && e.message ? e.message : e})`);
      continue;
    }
    let docs = [];
    try {
      const listed = await rpc(base, 'ListDocuments', []);
      docs = listed && listed.documents ? listed.documents : [];
    } catch (e) {
      lines.push(` ${i} | ${base} | ${peers} | ListDocuments error`);
      continue;
    }
    let totalBytes = 0;
    let published = 0;
    let hasPublishedId = false;
    for (const d of docs) {
      if (!d) continue;
      totalBytes += Math.max(0, Number(d.size) || 0);
      if (d.published) published++;
      if (wantId && (d.id === wantId || d.sha256 === wantId)) hasPublishedId = true;
    }
    const spb = totalBytes > 0 ? illustrative / totalBytes : null;
    const spbStr = spb != null ? spb.toFixed(8) : '—';
    const flag = wantId ? (hasPublishedId ? 'seen' : 'missing') : '';
    lines.push(
      ` ${i} | ${base} | ${peers} | ${docs.length} | ${published} | ${totalBytes} | ${spbStr}${flag ? ` | doc ${flag}` : ''}`
    );
  }
  if (mode === 'l1') {
    for (let i = 0; i < httpBases.length; i++) {
      try {
        const st = await rpc(httpBases[i], 'GetBitcoinStatus', []);
        const h = st && st.height != null ? st.height : '—';
        const bh = st && st.bestHash ? String(st.bestHash).slice(0, 16) + '…' : '—';
        lines.push(`[hub ${i}] Bitcoin height=${h} tip=${bh}`);
      } catch (e) {
        lines.push(`[hub ${i}] GetBitcoinStatus: ${e && e.message ? e.message : e}`);
      }
    }
    lines.push(
      'Bitcoin height note: **ephemeral regtest** on hub 0 only (~150 bootstrap blocks + a few per round). ' +
        'Satellites show no chain. This is not comparable to a long-lived hub (e.g. hub.fabric.pub) on another network/datadir.'
    );
  }
  lines.push('--- /services/bitcoin (availability + Lightning stub/live hints) ---');
  for (let i = 0; i < httpBases.length; i++) {
    try {
      const r = await httpJson(httpBases[i], 'GET', '/services/bitcoin', null);
      if (r.status !== 200) {
        lines.push(` [hub ${i}] GET /services/bitcoin → HTTP ${r.status}`);
        continue;
      }
      const b = r.body && typeof r.body === 'object' ? r.body : {};
      const ln = b.lightning && typeof b.lightning === 'object' ? b.lightning : {};
      const lnAvail =
        ln.available === true ? 'true' : ln.available === false ? 'false' : '—';
      lines.push(
        ` [hub ${i}] available=${b.available !== false} network=${b.network || '—'} ` +
          `lightning.stub=${ln.stub === true} lightning.available=${lnAvail}`
      );
    } catch (e) {
      lines.push(` [hub ${i}] /services/bitcoin: ${e && e.message ? e.message : e}`);
    }
  }
  if (opts.federation && opts.federation.validatorPubkeysHex) {
    const f = opts.federation;
    const pks = f.validatorPubkeysHex;
    const fp = Array.isArray(f.fabricPorts) ? f.fabricPorts : [];
    lines.push('--- Live mesh: distributed federation (hub order = validator order) ---');
    lines.push(
      `Policy: M-of-N threshold=${f.threshold} over N=${pks.length} validator keys (all hubs in this test are validators; satellites without bitcoind still enforce policy + replicate).`
    );
    for (let i = 0; i < pks.length; i++) {
      const pk = pks[i];
      const pre = pk.length > 24 ? `${pk.slice(0, 12)}…${pk.slice(-8)}` : pk;
      const fab = fp[i] != null ? `127.0.0.1:${fp[i]}` : '—';
      const role =
        opts.mode === 'l1' && i === 0
          ? 'L1 anchor (managed regtest) + Fabric'
          : opts.mode === 'l1'
            ? 'Fabric + catalog replica (no local bitcoind)'
            : 'Fabric peer';
      lines.push(`  hub ${i}  ${role}  P2P ${fab}  pubkey ${pre}`);
    }
    lines.push(
      'Economic split (this integration): pay-to-distribute / document purchase txs settle on the L1 anchor hub’s wallet; other validators observe Fabric + HTTP surfaces above.'
    );
  }
  for (let i = 0; i < httpBases.length; i++) {
    try {
      const res = await httpJson(httpBases[i], 'GET', '/services/distributed/epoch', null);
      if (res.status === 200 && res.body && typeof res.body === 'object') {
        lines.push(`[hub ${i}] /services/distributed/epoch: clock=${res.body.clock != null ? res.body.clock : '—'}`);
      }
    } catch (_) {}
  }
  if (opts.referenceDocument && opts.referenceDocument.id) {
    const ref = opts.referenceDocument;
    const rid = String(ref.id).trim();
    lines.push('--- Reference document (network-wide) ---');
    lines.push(
      `id ${rid.slice(0, 10)}…${rid.slice(-8)} (round-0 published doc; same bytes on every hub)`
    );
    const rows = Array.isArray(ref.rows) ? ref.rows : [];
    for (const row of rows) {
      const ok = row.listed && row.payloadMatch;
      lines.push(
        `  hub ${row.hub}  catalog ${row.listed ? 'listed' : 'MISSING'}  payload ${row.payloadMatch ? 'match' : 'MISMATCH'}  ${ok ? 'ok' : 'FAIL'}`
      );
    }
  }
  if (opts.nodeEconomics && opts.nodeEconomics.length) {
    lines.push('--- Per-node cost / benefit (this test) ---');
    for (const L of opts.nodeEconomics) lines.push(`  ${L}`);
  }
  if (opts.l1ExtraLines && opts.l1ExtraLines.length) {
    lines.push('--- L1 rounds / txids ---');
    for (const L of opts.l1ExtraLines) lines.push(L);
  }
  lines.push('============================================');
  lines.push('');
  return lines.join('\n');
}

function getFreePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function httpJson (baseUrl, method, pathname, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = url.parse(`${baseUrl}${pathname}`);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.path,
      method,
      headers: Object.assign(
        { Accept: 'application/json', 'Content-Type': 'application/json' },
        extraHeaders
      )
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

function httpBearer (baseUrl, method, pathname, body, token) {
  const h = token ? { Authorization: `Bearer ${token}` } : {};
  return httpJson(baseUrl, method, pathname, body, h);
}

async function rpc (baseUrl, method, params) {
  const res = await httpJson(baseUrl, 'POST', '/services/rpc', {
    jsonrpc: '2.0',
    id: 1,
    method,
    params
  });
  if (res.status !== 200) {
    throw new Error(`RPC ${method} HTTP ${res.status}: ${res.raw}`);
  }
  const j = res.body;
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  const r = j.result;
  if (r && r.status === 'error') throw new Error(r.message || 'RPC error');
  return r;
}

/** Like {@link rpc} but returns hub `{ status, message }` results without throwing. */
async function rpcResult (baseUrl, method, params) {
  const res = await httpJson(baseUrl, 'POST', '/services/rpc', {
    jsonrpc: '2.0',
    id: 1,
    method,
    params
  });
  if (res.status !== 200) {
    throw new Error(`RPC ${method} HTTP ${res.status}: ${res.raw}`);
  }
  const j = res.body;
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Match {@link BitcoinHome#trimHash} (8 + … + 8 for 64-char hex). */
function playnetTrimHashUi (value, left = 8, right = 8) {
  const text = String(value || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(text)) return '';
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}...${text.slice(-right)}`;
}

/** True if `getblock` verbosity-2 style JSON lists `txid` in `tx` (string ids or full tx objects). */
function playnetBlockJsonContainsTxid (blockBody, txid) {
  const want = String(txid || '').toLowerCase();
  if (!want || !blockBody || typeof blockBody !== 'object') return false;
  const txs = Array.isArray(blockBody.tx) ? blockBody.tx : [];
  for (const t of txs) {
    if (typeof t === 'string' && t.toLowerCase() === want) return true;
    if (t && typeof t === 'object' && String(t.txid || '').toLowerCase() === want) return true;
  }
  return false;
}

/** Pull 64-char txids from `allRoundTxids` lines like `r0-distribute:<hex>`. */
function playnetExtractTxidsFromRoundLines (lines) {
  const out = [];
  for (const line of lines || []) {
    const m = String(line).match(/:([0-9a-fA-F]{64})$/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Comma-separated `host:port` lists from env (Fabric P2P or Bitcoin P2P). */
function parsePlaynetCommaAddrs (raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * Log URLs for Cursor / IDE **browser MCP** (navigate → Bitcoin → transactions / explorer).
 * @param {{ desktopHttp: string, browserHttpBase: string, fabricPorts: number[], n: number, sampleTxids: string[] }} o
 */
function logPlaynetDesktopMcpHints (o) {
  const base = String(o.desktopHttp || '').replace(/\/+$/, '');
  if (!base) return;
  const tx0 = o.sampleTxids && o.sampleTxids[0] ? String(o.sampleTxids[0]).trim() : '';
  const playnetFabric = [];
  for (let i = 0; i < o.n; i++) playnetFabric.push(`127.0.0.1:${o.fabricPorts[i]}`);
  console.log(
    [
      '',
      '[PLAYNET:MCP] IDE browser — open the desktop Hub (same UI as Electron shell):',
      `  ${base}/`,
      `  ${base}/services/bitcoin`,
      `  ${base}/services/bitcoin/blocks`,
      tx0 && /^[0-9a-fA-F]{64}$/.test(tx0)
        ? `  ${base}/services/bitcoin/transactions/${tx0}  (sample tx from this run)`
        : null,
      '[PLAYNET:MCP] On the desktop Hub, add Fabric peer(s) so playnet reaches you:',
      `  ${playnetFabric.join('  ·  ')}`,
      `[PLAYNET:MCP] Chain audit + GetBitcoinStatus base for this test: ${o.browserHttpBase}`,
      ''
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** Avoid rare collisions when the OS reassigns a just-freed ephemeral port to the next `listen(0)`. */
async function allocUniquePorts (count) {
  const seen = new Set();
  const out = [];
  while (out.length < count) {
    const p = await getFreePort();
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
    await sleep(15);
  }
  return out;
}

async function waitBitcoinHttpAvailable (httpBase, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await httpJson(httpBase, 'GET', '/services/bitcoin');
    if (st.status === 200 && st.body && st.body.available) return;
    await sleep(400);
  }
  throw new Error(`Bitcoin not available on ${httpBase}`);
}

async function waitChainSyncAtLeast (btcFollower, minHeight, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = await btcFollower._makeRPCRequest('getblockcount', []).catch(() => -1);
    if (h >= minHeight) return h;
    await sleep(500);
  }
  throw new Error('Follower did not reach min chain height');
}

async function waitOutboundBtcPeer (btc, seedP2pPort, timeoutMs = 90000) {
  const portStr = String(seedP2pPort);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const peers = await btc._makeRPCRequest('getpeerinfo', []).catch(() => []);
    const hit = peers.some((p) => {
      const a = String((p && p.addr) || '');
      return a.includes(`:${portStr}`) || a.includes(`]:${portStr}`);
    });
    if (hit) return peers.length;
    await sleep(400);
  }
  return 0;
}

/**
 * Wait until `getblockcount` is unchanged for `stableMs` (P2P sync settled or isolated regtest at genesis).
 * @param {{ _makeRPCRequest: Function }} btc
 */
async function waitRegtestTipStable (btc, { timeoutMs = 120000, stableMs = 6000, pollMs = 2000 } = {}) {
  let last = -2;
  let stableStart = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const h = Number(await btc._makeRPCRequest('getblockcount', []).catch(() => -1));
    if (!Number.isFinite(h) || h < 0) {
      await sleep(pollMs);
      continue;
    }
    if (h === last) {
      if (stableStart === 0) stableStart = Date.now();
      else if (Date.now() - stableStart >= stableMs) return h;
    } else {
      last = h;
      stableStart = 0;
    }
    await sleep(pollMs);
  }
  const finalH = await btc._makeRPCRequest('getblockcount', []).catch(() => last);
  return Number(finalH);
}

async function sendPaymentOrWallet (httpBase, adminToken, btcSvc, to, amountSats) {
  const payRes = await httpJson(httpBase, 'POST', '/services/bitcoin', {
    method: 'sendpayment',
    adminToken,
    to,
    amountSats: Math.round(amountSats)
  });
  if (payRes.status === 200 && payRes.body && payRes.body.payment && payRes.body.payment.txid) {
    return String(payRes.body.payment.txid).trim();
  }
  await btcSvc._loadWallet(btcSvc.walletName);
  return btcSvc._makeWalletRequest(
    'sendtoaddress',
    [to, amountSats / 1e8],
    btcSvc.walletName
  );
}

/** @param {{ _makeRPCRequest: Function }} btc */
async function playnetBlockHashForTxid (btc, txid) {
  const h = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h) || !btc) return '';
  try {
    const tx = await btc._makeRPCRequest('getrawtransaction', [h, true]);
    return tx && tx.blockhash ? String(tx.blockhash).trim() : '';
  } catch (_) {
    return '';
  }
}

async function playnetAwaitTxConfirmations (btc, txid, minConf, timeoutMs) {
  const h = String(txid || '').trim();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const tx = await btc._makeRPCRequest('getrawtransaction', [h, true]);
      const c = tx && tx.confirmations != null ? Number(tx.confirmations) : 0;
      if (c >= minConf) return c;
    } catch (_) { /* not visible yet */ }
    await sleep(150);
  }
  throw new Error(`tx ${h.slice(0, 12)}… did not reach ${minConf} conf in ${timeoutMs}ms`);
}

async function playnetLogMempoolAfterBroadcast (btc, txid, label) {
  if (!playnetL1TxLog) return;
  const h = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h) || !btc) return;
  try {
    await btc._makeRPCRequest('getmempoolentry', [h]);
    console.log(`[PLAYNET:L1_TX] ${label} → broadcast ${playnetTrimHashUi(h)} (mempool)`);
    return;
  } catch (_) { /* may already be in block on fast paths */ }
  try {
    const tx = await btc._makeRPCRequest('getrawtransaction', [h, true]);
    const c = tx && tx.confirmations != null ? Number(tx.confirmations) : 0;
    console.log(`[PLAYNET:L1_TX] ${label} → broadcast ${playnetTrimHashUi(h)} (chain conf=${c})`);
  } catch (e) {
    console.log(`[PLAYNET:L1_TX] ${label} → broadcast ${playnetTrimHashUi(h)} (pending visibility: ${e.message || e})`);
  }
}

/**
 * Mine one regtest block via Hub admin API and assert `txid` is confirmed (≥1 conf).
 */
async function playnetMineBlockConfirmTx (httpBase, adminToken, btc, txid, label, blockCounter) {
  const res = await httpBearer(httpBase, 'POST', '/services/bitcoin/blocks', { count: 1 }, adminToken);
  assert.strictEqual(res.status, 200, `mine 1 block (${label}): HTTP ${res.status}`);
  if (blockCounter && typeof blockCounter.blocks === 'number') blockCounter.blocks += 1;
  const h = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h) || !btc) return;
  const conf = await playnetAwaitTxConfirmations(btc, h, 1, 20000);
  const tx = await btc._makeRPCRequest('getrawtransaction', [h, true]);
  const bh = tx && tx.blockhash ? String(tx.blockhash) : '';
  if (playnetL1TxLog) {
    console.log(
      `[PLAYNET:L1_TX] ${label} → confirmed conf=${conf} block=${bh ? playnetTrimHashUi(bh) : '—'} tx=${playnetTrimHashUi(h)}`
    );
  }
  assert.ok(conf >= 1, `${label}: expected ≥1 confirmation after generateblock`);
}

/** ~1 sat/vbyte lower bound when wallet `fee` field is untrustworthy (large regtest UTXOs). */
async function playnetTxFeeLowerBoundFromVsize (btc, txid) {
  const h = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h) || !btc) return 0;
  try {
    const raw = await btc._makeRPCRequest('getrawtransaction', [h, true]);
    const vs = Number(
      raw && (raw.vsize != null ? raw.vsize : raw.weight != null ? Math.ceil(raw.weight / 4) : 0)
    );
    if (!Number.isFinite(vs) || vs <= 0) return 0;
    return Math.round(vs);
  } catch (_) {
    return 0;
  }
}

/** Miner fee in sats from wallet `gettransaction` when plausible; else vsize lower bound. */
async function playnetWalletTxFeeSats (btc, txid) {
  if (!btc || typeof btc._loadWallet !== 'function') return 0;
  const h = String(txid || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h)) return 0;
  try {
    await btc._loadWallet(btc.walletName);
    const tx = await btc._makeWalletRequest('gettransaction', [h, true], btc.walletName);
    const fee = tx && tx.fee != null ? Number(tx.fee) : NaN;
    if (Number.isFinite(fee)) {
      const absBtc = Math.abs(fee);
      if (absBtc < 0.05) return Math.round(absBtc * 1e8);
    }
    return await playnetTxFeeLowerBoundFromVsize(btc, h);
  } catch (_) {
    return 0;
  }
}

async function playnetSumWalletFeesForTxids (btc, txids) {
  const seen = new Set();
  let sum = 0;
  for (const t of txids) {
    const h = String(t || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(h) || seen.has(h)) continue;
    seen.add(h);
    sum += await playnetWalletTxFeeSats(btc, h);
  }
  return { sum, count: seen.size };
}

async function playnetBuildReferenceDocRows (httpBases, docId, expectedB64) {
  const want = String(expectedB64 || '');
  const id = String(docId || '').trim();
  const rows = [];
  for (let i = 0; i < httpBases.length; i++) {
    const listed = await rpc(httpBases[i], 'ListDocuments', []);
    const docs = listed && listed.documents ? listed.documents : [];
    const listedOk = Array.isArray(docs) && docs.some((d) => d && (d.id === id || d.sha256 === id));
    const got = await rpc(httpBases[i], 'GetDocument', [{ id }]);
    const b64 = got && got.document ? got.document.contentBase64 : '';
    rows.push({ hub: i, listed: listedOk, payloadMatch: b64 === want });
  }
  return rows;
}

/** Round-0 reference doc must appear in catalog with identical bytes on every hub (polls Fabric replication). */
async function playnetWaitReferenceDocNetwork (httpBases, docId, expectedB64, timeoutMs = 45000) {
  const want = String(expectedB64 || '');
  const id = String(docId || '').trim();
  assert.ok(id && want, 'reference doc id and content required');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const rows = await playnetBuildReferenceDocRows(httpBases, id, want);
    if (rows.length && rows.every((r) => r.listed && r.payloadMatch)) return rows;
    await sleep(500);
  }
  const last = await playnetBuildReferenceDocRows(httpBases, id, want);
  throw new Error(`reference document not stored on all hubs: ${JSON.stringify(last)}`);
}

async function playnetFabricPeerCount (httpBase) {
  const st = await rpc(httpBase, 'GetNetworkStatus', []);
  const pb = st && st.peers;
  return pb && typeof pb === 'object' ? Object.keys(pb).length : 0;
}

/**
 * @param {string} httpBase
 * @param {string} docId
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 */
async function playnetWaitListDocumentsContains (httpBase, docId, opts = {}) {
  const want = String(docId || '').trim();
  if (!want) return false;
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 90000);
  const pollMs = Math.max(200, Number(opts.pollMs) || 2000);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const listed = await rpc(httpBase, 'ListDocuments', []);
    const docs = listed && listed.documents ? listed.documents : [];
    const hit =
      Array.isArray(docs) && docs.some((d) => d && (d.id === want || d.sha256 === want));
    if (hit) return true;
    await sleep(pollMs);
  }
  return false;
}

describe('Playnet market (simulation + optional mesh)', function () {
  describe('Markov-style market ledger (pure)', function () {
    it('yields strictly positive profit for at least one node over many rounds (5–15 operators)', function () {
      let lastOut = null;
      for (const n of [5, 9, 15]) {
        lastOut = runPlaynetMarketSimulation({
          nodeCount: n,
          rounds: 200,
          seed: 42 + n,
          acceptProbability: 0.44,
          offerSats: 11_000
        });
        assert.ok(lastOut.someNodeProfited, `expected some profitable node when n=${n}`);
        assert.ok(lastOut.successfulContracts > 5, `expected several bonded rounds when n=${n}`);
        assert.ok(lastOut.maxProfit > 0, `maxProfit should be > 0 when n=${n}`);
        assert.ok(lastOut.cohortFederation && lastOut.cohortNormal, 'simulation should compute federation vs normal cohorts');
      }
      if (playnetReport && lastOut) {
        console.log('\n[playnet] simulation assertions passed for n ∈ {5, 9, 15}; table is the final run (n=15).\n');
        console.log(formatPlaynetSimulationReport(lastOut));
      }
      if (playnetReport) {
        console.log(
          '[PLAYNET:SIM_PROFIT] Stochastic ledger: at least one operator ends with positive net balance; ' +
            'the L1 mesh test (when enabled) pins the same economic shapes to regtest broadcasts and conf≥1.\n'
        );
      }
    });
  });

  (runMesh ? describe : describe.skip)('Multi-hub mesh (Fabric ± L1)', function () {
    this.timeout(600000);

    let restoreConsole = null;
    /** @type {import('../services/hub')[]} */
    let hubs = [];
    let fsRoots = [];
    const httpBases = [];

    before(function () {
      if (playnetL1SyncBitcoinP2p) {
        delete process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER;
      } else {
        process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
      }
      restoreConsole = installMaskedConsole();
    });

    after(function () {
      if (restoreConsole) restoreConsole();
    });

    afterEach(async function () {
      this.timeout(120000);
      for (const h of hubs) {
        try {
          await Promise.race([
            h.stop(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 20000))
          ]);
        } catch (_) {}
      }
      hubs = [];
      for (const p of fsRoots) {
        try {
          fs.rmSync(p, { recursive: true, force: true });
        } catch (_) {}
      }
      fsRoots = [];
      httpBases.length = 0;
    });

    (runMeshFabric ? it : it.skip)(
      'starts N hubs, aligns federation, ring+star P2P, publishes a document (Fabric-only)',
      async function () {
        const n = Math.max(5, Math.min(15, Number(process.env.FABRIC_PLAYNET_NODES) || 7));
        assert.ok(
          n <= PLAYNET_MESH_MNEMONICS.length,
          `FABRIC_PLAYNET_NODES must be ≤ ${PLAYNET_MESH_MNEMONICS.length} (one test mnemonic per hub)`
        );
        const p2pPorts = [];
        const httpPorts = [];
        for (let i = 0; i < n; i++) {
          p2pPorts.push(await getFreePort());
          httpPorts.push(await getFreePort());
        }

        hubs = [];
        fsRoots = [];

        for (let i = 0; i < n; i++) {
          const root = path.join(__dirname, '..', 'stores', `playnet-mesh-${process.pid}-${Date.now()}-${i}`);
          fs.mkdirSync(root, { recursive: true });
          fsRoots.push(root);

          const h = new Hub(hubSettingsMerge(settings, {
            port: p2pPorts[i],
            peers: [],
            fs: { path: root },
            key: {
              mnemonic: PLAYNET_MESH_MNEMONICS[i],
              seed: null
            },
            bitcoin: { enable: false, network: 'regtest' },
            beacon: { enable: false },
            http: {
              hostname: '127.0.0.1',
              listen: true,
              port: httpPorts[i]
            },
            debug: false
          }));
          await h.start();
          hubs.push(h);
          httpBases.push(`http://127.0.0.1:${httpPorts[i]}`);
          await sleep(300);
        }

        const pubkeys = hubs
          .map((hub) => {
            const k = hub._rootKey && hub._rootKey.pubkey;
            if (!k) return '';
            return Buffer.isBuffer(k) ? k.toString('hex') : String(k).trim();
          })
          .filter((x) => x.length === 66 || x.length === 64 || x.length === 130);

        assert.ok(pubkeys.length === n, 'each hub should expose a root pubkey hex');
        const threshold = Math.max(1, Math.min(3, pubkeys.length));

        for (const hub of hubs) {
          hub.settings.distributed = hub.settings.distributed || {};
          hub.settings.distributed.federation = {
            validators: pubkeys.slice(),
            threshold
          };
          if (typeof hub._reapplyBeaconFederationPolicy === 'function') {
            hub._reapplyBeaconFederationPolicy();
          }
        }

        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const addr = `127.0.0.1:${p2pPorts[next]}`;
          const r = await rpc(httpBases[i], 'AddPeer', [addr]);
          assert.strictEqual(r.status, 'success', `AddPeer ring ${i}→${next}`);
        }

        for (let i = 1; i < n; i++) {
          try {
            await rpc(httpBases[0], 'AddPeer', [`127.0.0.1:${p2pPorts[i]}`]);
          } catch (_) {}
          try {
            await rpc(httpBases[i], 'AddPeer', [`127.0.0.1:${p2pPorts[0]}`]);
          } catch (_) {}
        }

        await sleep(4000);

        for (let i = 0; i < n; i++) {
          const st = await rpc(httpBases[i], 'GetNetworkStatus', []);
          const peerBlock = st && st.peers;
          const count = peerBlock && typeof peerBlock === 'object'
            ? Object.keys(peerBlock).length
            : 0;
          assert.ok(count >= 1, `hub ${i} should see at least one Fabric peer`);
        }

        for (let i = 0; i < n; i++) {
          const res = await httpJson(httpBases[i], 'GET', '/services/distributed/manifest', null);
          assert.strictEqual(res.status, 200, `manifest HTTP hub ${i}`);
          const man = res.body;
          assert.ok(man && man.federation, `manifest should include federation hub ${i}`);
          assert.strictEqual(man.federation.threshold, threshold);
          assert.strictEqual(man.federation.validators.length, pubkeys.length);
        }

        const runId = Date.now();
        const contentB64 = Buffer.from(`playnet mesh doc ${runId}\n`, 'utf8').toString('base64');
        const created = await rpc(httpBases[0], 'CreateDocument', [{
          name: `playnet-mesh-${runId}.txt`,
          mime: 'text/plain',
          contentBase64: contentB64
        }]);
        const docId = created && created.document && created.document.id;
        assert.ok(docId, 'CreateDocument should return id');

        const pub = await rpc(httpBases[0], 'PublishDocument', [{ id: docId }]);
        assert.ok(pub && pub.document, 'PublishDocument should return document');

        const resyncGapMs = Math.max(0, Number(process.env.FABRIC_PLAYNET_MESH_RESYNC_GAP_MS) || 1200);
        const resyncRounds = Math.max(1, Math.min(4, Number(process.env.FABRIC_PLAYNET_MESH_RESYNC_ROUNDS) || 2));
        for (let r = 0; r < resyncRounds; r++) {
          for (let i = 1; i < n; i++) {
            try {
              await rpc(httpBases[i], 'RequestFabricPeerResync', [{ address: `127.0.0.1:${p2pPorts[0]}` }]);
            } catch (_) {}
            if (resyncGapMs > 0) await sleep(resyncGapMs);
          }
          if (r < resyncRounds - 1) await sleep(2500);
        }
        await sleep(3500);

        const lastHub = n - 1;
        const resyncPollMs = Math.max(500, Number(process.env.FABRIC_PLAYNET_MESH_RESYNC_POLL_MS) || 2000);
        const resyncTimeoutMs = Math.max(5000, Number(process.env.FABRIC_PLAYNET_MESH_RESYNC_TIMEOUT_MS) || 90000);
        let seen = await playnetWaitListDocumentsContains(httpBases[lastHub], docId, {
          timeoutMs: resyncTimeoutMs,
          pollMs: resyncPollMs
        });

        if (!seen) {
          const anchor = `127.0.0.1:${p2pPorts[0]}`;
          const extraAttempts = Math.max(0, Math.min(16, Number(process.env.FABRIC_PLAYNET_MESH_LAST_HUB_RESYNC_ATTEMPTS) || 10));
          for (let a = 0; a < extraAttempts && !seen; a++) {
            try {
              await rpc(httpBases[lastHub], 'RequestFabricPeerResync', [{ address: anchor }]);
            } catch (_) {}
            await sleep(2200);
            seen = await playnetWaitListDocumentsContains(httpBases[lastHub], docId, {
              timeoutMs: Math.min(resyncTimeoutMs, 12000),
              pollMs: resyncPollMs
            });
          }
        }

        if (playnetReport) {
          const report = await formatPlaynetMeshFinalReport(httpBases, {
            illustrativeOfferSats: 11_000,
            publishedDocId: docId,
            mode: 'fabric',
            federation: { threshold, validatorPubkeysHex: pubkeys, fabricPorts: p2pPorts },
            l1ExtraLines: seen
              ? []
              : [`Catalog note: hub ${lastHub} ListDocuments did not yet include ${docId} after star+resync.`]
          });
          console.log(report);
        }

        assert.ok(seen, `hub ${lastHub} should list published document ${docId} after mesh + resync`);
      }
    );

    (runMeshL1 ? it : it.skip)(
      'L1 mesh: 3 hubs, real txs (distribute + purchase rounds), doc replication, optional chain audit',
      async function () {
        this.timeout(600000);

        const n = 3;
        const rounds = Math.max(1, Math.min(8, Number(process.env.FABRIC_PLAYNET_MESH_ROUNDS) || 3));

        const need = n * 2 + 3;
        const flat = await allocUniquePorts(need);
        const fabricPorts = flat.slice(0, n);
        const httpPorts = flat.slice(n, n * 2);
        const btcP2p0 = flat[n * 2];
        const btcRpc0 = flat[n * 2 + 1];
        const zmq0 = flat[n * 2 + 2];

        let desktopFabricAddrs = parsePlaynetCommaAddrs(process.env.FABRIC_PLAYNET_DESKTOP_FABRIC);
        let desktopBitcoinP2p = parsePlaynetCommaAddrs(process.env.FABRIC_PLAYNET_DESKTOP_BITCOIN_P2P);
        let desktopHttpConfigured = String(process.env.FABRIC_PLAYNET_DESKTOP_HTTP || '').trim().replace(/\/+$/, '');

        if (playnetDesktopStar) {
          const star = playnetResolveDesktopStarDefaults();
          if (!desktopFabricAddrs.length) desktopFabricAddrs = parsePlaynetCommaAddrs(star.fabric);
          if (!desktopBitcoinP2p.length) desktopBitcoinP2p = parsePlaynetCommaAddrs(star.bitcoinP2p);
          if (!desktopHttpConfigured) desktopHttpConfigured = star.http;
          console.log(
            `[PLAYNET:DESKTOP_STAR] defaults → Fabric ${star.fabric} | Bitcoin P2P ${star.bitcoinP2p} | HTTP ${star.http}`
          );
        }

        const desktopHttpHint =
          desktopHttpConfigured ||
          (desktopFabricAddrs.length || desktopBitcoinP2p.length ? 'http://127.0.0.1:8080' : '');

        const seeds = [MNEMONIC_A, MNEMONIC_B, MNEMONIC_C];
        hubs = [];
        fsRoots = [];
        const tokens = [];

        const makeBase = (i, root) => {
          if (i === 0) {
            const extra = ['-dnsseed=0'].concat(extraBtcParams);
            return hubSettingsMerge(settings, {
              port: fabricPorts[i],
              peers: [],
              fs: { path: root },
              key: { mnemonic: seeds[i] },
              bitcoin: {
                enable: true,
                network: 'regtest',
                managed: true,
                listen: false,
                port: btcP2p0,
                rpcport: btcRpc0,
                zmqPort: zmq0,
                datadir: path.join(root, 'bitcoin-datadir'),
                p2pAddNodes: desktopBitcoinP2p.slice(),
                bitcoinExtraParams: extra,
                documentBlocks: false,
                federationRegistryScan: { enable: false }
              },
              beacon: { enable: false },
              lightning: { managed: false, stub: true },
              http: { hostname: '127.0.0.1', listen: true, port: httpPorts[i] },
              debug: false
            });
          }
          return hubSettingsMerge(settings, {
            port: fabricPorts[i],
            peers: [],
            fs: { path: root },
            key: { mnemonic: seeds[i % seeds.length] },
            bitcoin: { enable: false, network: 'regtest' },
            beacon: { enable: false },
            lightning: { managed: false, stub: true },
            http: { hostname: '127.0.0.1', listen: true, port: httpPorts[i] },
            debug: false
          });
        };

        for (let i = 0; i < n; i++) {
          const root = path.join(__dirname, '..', 'stores', `playnet-mesh-l1-${process.pid}-${Date.now()}-${i}`);
          fs.mkdirSync(root, { recursive: true });
          fsRoots.push(root);
          const h = new Hub(makeBase(i, root));
          await h.start();
          hubs.push(h);
          httpBases.push(`http://127.0.0.1:${httpPorts[i]}`);
          await sleep(i === 0 ? 800 : 400);
        }

        const wantDesktopBrowser =
          playnetDesktopStar ||
          process.env.FABRIC_PLAYNET_BROWSER_USE_DESKTOP_HTTP === '1' ||
          process.env.FABRIC_PLAYNET_BROWSER_USE_DESKTOP_HTTP === 'true';
        const browserHttpBase =
          String(process.env.FABRIC_PLAYNET_BROWSER_HTTP_BASE || '').trim().replace(/\/+$/, '') ||
          (wantDesktopBrowser && desktopHttpHint ? desktopHttpHint : '') ||
          httpBases[0];

        await waitBitcoinHttpAvailable(httpBases[0], 120000);

        const btc0 = hubs[0]._getBitcoinService();
        assert.ok(btc0);
        const syncTimeoutMs = Math.max(
          5000,
          Number(process.env.FABRIC_PLAYNET_L1_SYNC_TIMEOUT_MS) || 120000
        );
        const syncMinHeight = Math.max(
          1,
          Number(process.env.FABRIC_PLAYNET_L1_SYNC_MIN_HEIGHT) || 101
        );
        const forceBootstrapMines =
          process.env.FABRIC_PLAYNET_L1_FORCE_BOOTSTRAP_MINES === '1' ||
          process.env.FABRIC_PLAYNET_L1_FORCE_BOOTSTRAP_MINES === 'true';

        let chainHeight = Number(await btc0._makeRPCRequest('getblockcount', []).catch(() => 0)) || 0;
        if (playnetL1SyncBitcoinP2p) {
          chainHeight = Number(await waitRegtestTipStable(btc0, { timeoutMs: syncTimeoutMs })) || 0;
          if (playnetReport) {
            console.log(
              `[PLAYNET:L1_SYNC] P2P regtest tip stable at height ${chainHeight} (timeout ${syncTimeoutMs}ms, skip bootstrap if ≥ ${syncMinHeight})`
            );
          }
        }

        const miningAddr = await btc0.getUnusedAddress();
        const shallowChain = chainHeight < syncMinHeight;
        let walletPoor = false;
        if (playnetL1SyncBitcoinP2p && !shallowChain && !forceBootstrapMines) {
          const bal = await playnetFabricWalletTrustedBtc(btc0);
          const minBtc = Math.max(0, Number(process.env.FABRIC_PLAYNET_L1_MIN_WALLET_BTC) || 0.05);
          if (!Number.isFinite(bal) || bal < minBtc) walletPoor = true;
        }
        if (forceBootstrapMines || !playnetL1SyncBitcoinP2p || shallowChain || walletPoor) {
          if (playnetL1SyncBitcoinP2p && walletPoor && playnetReport) {
            console.log('[PLAYNET:L1_SYNC] wallet balance low after sync — mining bootstrap blocks for test spends');
          }
          for (let g = 0; g < 15; g++) {
            await btc0._makeRPCRequest('generatetoaddress', [10, miningAddr]);
          }
        }

        for (let i = 0; i < n; i++) {
          const boot = await httpJson(httpBases[i], 'POST', '/settings', {
            NODE_NAME: `PlaynetMeshL1-${i}`,
            LIGHTNING_MANAGED: false,
            bitcoinManaged: true
          });
          assert.strictEqual(boot.status, 200, boot.raw);
          tokens.push(boot.body.token);
          assert.ok(tokens[i], `admin token hub ${i}`);
        }

        const pubkeys = hubs.map((hub) => {
          const k = hub._rootKey && hub._rootKey.pubkey;
          if (!k) return '';
          return Buffer.isBuffer(k) ? k.toString('hex') : String(k).trim();
        }).filter((x) => x.length >= 64);
        assert.strictEqual(pubkeys.length, n);
        const threshold = Math.max(1, Math.min(2, pubkeys.length));
        for (const hub of hubs) {
          hub.settings.distributed = hub.settings.distributed || {};
          hub.settings.distributed.federation = { validators: pubkeys.slice(), threshold };
          if (typeof hub._reapplyBeaconFederationPolicy === 'function') {
            hub._reapplyBeaconFederationPolicy();
          }
        }

        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          await rpc(httpBases[i], 'AddPeer', [`127.0.0.1:${fabricPorts[next]}`]);
        }
        for (let i = 1; i < n; i++) {
          try {
            await rpc(httpBases[0], 'AddPeer', [`127.0.0.1:${fabricPorts[i]}`]);
          } catch (_) {}
          try {
            await rpc(httpBases[i], 'AddPeer', [`127.0.0.1:${fabricPorts[0]}`]);
          } catch (_) {}
        }
        await sleep(4000);

        const l1Lines = [];
        if (desktopFabricAddrs.length) {
          for (const dAddr of desktopFabricAddrs) {
            for (let i = 0; i < n; i++) {
              try {
                await rpc(httpBases[i], 'AddPeer', [dAddr]);
              } catch (err) {
                l1Lines.push(
                  `desktop Fabric AddPeer hub${i}→${dAddr}: ${err && err.message ? err.message : err}`
                );
              }
            }
          }
          await sleep(2000);
          l1Lines.push(`desktop Fabric AddPeer (mesh→desktop): ${desktopFabricAddrs.join(', ')}`);
        }
        if (desktopBitcoinP2p.length) {
          l1Lines.push(`desktop Bitcoin P2P on playnet hub0 p2pAddNodes: ${desktopBitcoinP2p.join(', ')}`);
        }
        if (playnetL1SyncBitcoinP2p) {
          const peer = String(process.env.FABRIC_BITCOIN_PLAYNET_PEER || 'hub.fabric.pub:18444').trim();
          l1Lines.push(
            `FABRIC_PLAYNET_L1_SYNC_BITCOIN_P2P: Core addnode merge includes playnet peer ${peer || '(unset)'}`
          );
        }

        const allRoundTxids = [];
        const l1BlockCounter = { blocks: 0 };
        let totalInvoiceDistributeSats = 0;
        let totalInvoicePurchaseSats = 0;
        const l1WalletTrustedStart = await playnetFabricWalletTrustedBtc(btc0);
        let lastDocId = '';
        let lastPurchaseTxid = '';
        let lastDistributeTxid = '';
        /** First published doc in round 0 — asserted on every hub’s catalog + payload. */
        let referenceDocId = '';
        let referenceContentB64 = '';

        for (let r = 0; r < rounds; r++) {
          const purchaseSats = 2800 + r * 100;
          const distributeSats = 7500 + r * 200;
          const runTag = `${Date.now()}-r${r}`;
          const contentB64 = Buffer.from(`playnet L1 mesh round ${r} ${runTag}\n`, 'utf8').toString('base64');

          const created = await rpc(httpBases[0], 'CreateDocument', [{
            name: `playnet-l1-${runTag}.txt`,
            mime: 'text/plain',
            contentBase64: contentB64
          }]);
          const docId = created && created.document && created.document.id;
          assert.ok(docId, `round ${r} CreateDocument`);
          lastDocId = docId;

          const pub = await rpc(httpBases[0], 'PublishDocument', [{
            id: docId,
            purchasePriceSats: purchaseSats
          }]);
          assert.ok(pub && pub.document && pub.document.published, `round ${r} PublishDocument`);

          const distInv = await rpc(httpBases[0], 'CreateDistributeInvoice', [{
            documentId: docId,
            amountSats: distributeSats,
            durationYears: 4,
            challengeCadence: 'daily',
            responseDeadline: '10s'
          }]);
          assert.strictEqual(distInv.type, 'CreateDistributeInvoiceResult', `round ${r} distribute invoice`);
          const distTxid = await sendPaymentOrWallet(
            httpBases[0],
            tokens[0],
            btc0,
            distInv.address,
            distInv.amountSats
          );
          assert.ok(distTxid, `round ${r} distribute pay`);
          lastDistributeTxid = distTxid;
          allRoundTxids.push(`r${r}-distribute:${distTxid}`);
          totalInvoiceDistributeSats += Math.round(Number(distInv.amountSats) || distributeSats);
          await playnetLogMempoolAfterBroadcast(btc0, distTxid, `round ${r} distribute pay`);
          await playnetMineBlockConfirmTx(
            httpBases[0],
            tokens[0],
            btc0,
            distTxid,
            `round ${r} distribute confirm`,
            l1BlockCounter
          );

          const stor = await rpc(httpBases[0], 'CreateStorageContract', [{
            documentId: docId,
            amountSats: distributeSats,
            txid: distTxid,
            durationYears: 4,
            challengeCadence: 'daily',
            responseDeadline: '10s'
          }]);
          assert.strictEqual(stor.type, 'CreateStorageContractResult', `round ${r} storage contract`);

          const purchInv = await rpc(httpBases[0], 'CreatePurchaseInvoice', [{ documentId: docId }]);
          assert.strictEqual(purchInv.type, 'CreatePurchaseInvoiceResult', `round ${r} purchase invoice`);
          const purchTxid = await sendPaymentOrWallet(
            httpBases[0],
            tokens[0],
            btc0,
            purchInv.address,
            purchInv.amountSats
          );
          assert.ok(purchTxid, `round ${r} purchase pay`);
          lastPurchaseTxid = purchTxid;
          allRoundTxids.push(`r${r}-purchase:${purchTxid}`);
          totalInvoicePurchaseSats += Math.round(Number(purchInv.amountSats) || 0);
          await playnetLogMempoolAfterBroadcast(btc0, purchTxid, `round ${r} purchase pay`);
          await playnetMineBlockConfirmTx(
            httpBases[0],
            tokens[0],
            btc0,
            purchTxid,
            `round ${r} purchase confirm`,
            l1BlockCounter
          );

          const claim = await rpc(httpBases[0], 'ClaimPurchase', [{ documentId: docId, txid: purchTxid }]);
          assert.strictEqual(claim.type, 'ClaimPurchaseResult', `round ${r} claim`);
          assert.ok(claim.document && claim.document.contentBase64, `round ${r} claim content`);
          if (r === 0) {
            referenceDocId = docId;
            referenceContentB64 = contentB64;
          }
          l1Lines.push(
            `round ${r}: doc=${docId.slice(0, 12)}… distribute=${distTxid.slice(0, 14)}… purchase=${purchTxid.slice(0, 14)}…`
          );
        }

        // --- Unhappy paths: reject invalid L1 proof, then complete the same document happily ---
        const unhappyTag = `${Date.now()}-unhappy`;
        const unhappyB64 = Buffer.from(`playnet unhappy-path ${unhappyTag}\n`, 'utf8').toString('base64');
        const unhappyCreated = await rpc(httpBases[0], 'CreateDocument', [{
          name: `playnet-l1-unhappy-${unhappyTag}.txt`,
          mime: 'text/plain',
          contentBase64: unhappyB64
        }]);
        const unhappyDocId = unhappyCreated && unhappyCreated.document && unhappyCreated.document.id;
        assert.ok(unhappyDocId, 'unhappy CreateDocument');
        await rpc(httpBases[0], 'PublishDocument', [{
          id: unhappyDocId,
          purchasePriceSats: 2100
        }]);
        const unhappyDistInv = await rpc(httpBases[0], 'CreateDistributeInvoice', [{
          documentId: unhappyDocId,
          amountSats: 6200,
          durationYears: 4,
          challengeCadence: 'daily',
          responseDeadline: '10s'
        }]);
        assert.strictEqual(unhappyDistInv.type, 'CreateDistributeInvoiceResult', 'unhappy distribute invoice');
        const badStor = await rpcResult(httpBases[0], 'CreateStorageContract', [{
          documentId: unhappyDocId,
          amountSats: unhappyDistInv.amountSats,
          txid: 'f'.repeat(64),
          durationYears: 4,
          challengeCadence: 'daily',
          responseDeadline: '10s'
        }]);
        assert.ok(
          badStor && badStor.type === 'CreateStorageContractFailed',
          `CreateStorageContract should fail on fake txid; got ${JSON.stringify(badStor).slice(0, 200)}`
        );
        l1Lines.push('unhappy: CreateStorageContract rejected fake distribute payment txid');
        const unhappyDistPay = await sendPaymentOrWallet(
          httpBases[0],
          tokens[0],
          btc0,
          unhappyDistInv.address,
          unhappyDistInv.amountSats
        );
        assert.ok(unhappyDistPay, 'unhappy distribute pay');
        totalInvoiceDistributeSats += Math.round(Number(unhappyDistInv.amountSats) || 0);
        await playnetLogMempoolAfterBroadcast(btc0, unhappyDistPay, 'unhappy distribute pay');
        await playnetMineBlockConfirmTx(
          httpBases[0],
          tokens[0],
          btc0,
          unhappyDistPay,
          'unhappy distribute confirm',
          l1BlockCounter
        );
        const happyStor = await rpc(httpBases[0], 'CreateStorageContract', [{
          documentId: unhappyDocId,
          amountSats: unhappyDistInv.amountSats,
          txid: unhappyDistPay,
          durationYears: 4,
          challengeCadence: 'daily',
          responseDeadline: '10s'
        }]);
        assert.strictEqual(happyStor.type, 'CreateStorageContractResult', 'unhappy doc storage after real pay');
        const unhappyPurchInv = await rpc(httpBases[0], 'CreatePurchaseInvoice', [{ documentId: unhappyDocId }]);
        assert.strictEqual(unhappyPurchInv.type, 'CreatePurchaseInvoiceResult', 'unhappy purchase invoice');
        const badClaim = await rpcResult(httpBases[0], 'ClaimPurchase', [{
          documentId: unhappyDocId,
          txid: 'e'.repeat(64)
        }]);
        assert.ok(
          badClaim && badClaim.status === 'error',
          `ClaimPurchase should fail on fake payment txid; got ${JSON.stringify(badClaim).slice(0, 200)}`
        );
        l1Lines.push('unhappy: ClaimPurchase rejected fake purchase txid');
        const unhappyPurchPay = await sendPaymentOrWallet(
          httpBases[0],
          tokens[0],
          btc0,
          unhappyPurchInv.address,
          unhappyPurchInv.amountSats
        );
        assert.ok(unhappyPurchPay, 'unhappy purchase pay');
        allRoundTxids.push(`unhappy-distribute:${unhappyDistPay}`);
        allRoundTxids.push(`unhappy-purchase:${unhappyPurchPay}`);
        totalInvoicePurchaseSats += Math.round(Number(unhappyPurchInv.amountSats) || 0);
        await playnetLogMempoolAfterBroadcast(btc0, unhappyPurchPay, 'unhappy purchase pay');
        await playnetMineBlockConfirmTx(
          httpBases[0],
          tokens[0],
          btc0,
          unhappyPurchPay,
          'unhappy purchase confirm',
          l1BlockCounter
        );
        const happyClaim = await rpc(httpBases[0], 'ClaimPurchase', [{
          documentId: unhappyDocId,
          txid: unhappyPurchPay
        }]);
        assert.strictEqual(happyClaim.type, 'ClaimPurchaseResult', 'unhappy doc claim after real pay');
        assert.ok(
          happyClaim.document && happyClaim.document.contentBase64,
          'unhappy-path doc download (claim) should return content'
        );

        // --- Partition hub0↔hub2, expect SendPeerFile failure, heal, replicate “download” on satellite ---
        let partitionPurchaseTxid = '';
        const partitionTag = `${Date.now()}-partition`;
        const partitionB64 = Buffer.from(`playnet partition download ${partitionTag}\n`, 'utf8').toString('base64');
        const partCreated = await rpc(httpBases[0], 'CreateDocument', [{
          name: `playnet-l1-partition-${partitionTag}.txt`,
          mime: 'text/plain',
          contentBase64: partitionB64
        }]);
        const partitionDocId = partCreated && partCreated.document && partCreated.document.id;
        assert.ok(partitionDocId, 'partition CreateDocument');
        const partPub = await rpc(httpBases[0], 'PublishDocument', [{
          id: partitionDocId,
          purchasePriceSats: 2900
        }]);
        assert.ok(partPub && partPub.document && partPub.document.published, 'partition PublishDocument');
        const partDistInv = await rpc(httpBases[0], 'CreateDistributeInvoice', [{
          documentId: partitionDocId,
          amountSats: 6800,
          durationYears: 4,
          challengeCadence: 'daily',
          responseDeadline: '10s'
        }]);
        assert.strictEqual(partDistInv.type, 'CreateDistributeInvoiceResult', 'partition distribute invoice');
        const partDistTxid = await sendPaymentOrWallet(
          httpBases[0],
          tokens[0],
          btc0,
          partDistInv.address,
          partDistInv.amountSats
        );
        assert.ok(partDistTxid, 'partition distribute pay');
        totalInvoiceDistributeSats += Math.round(Number(partDistInv.amountSats) || 0);
        await playnetLogMempoolAfterBroadcast(btc0, partDistTxid, 'partition distribute pay');
        await playnetMineBlockConfirmTx(
          httpBases[0],
          tokens[0],
          btc0,
          partDistTxid,
          'partition distribute confirm',
          l1BlockCounter
        );
        const partStor = await rpc(httpBases[0], 'CreateStorageContract', [{
          documentId: partitionDocId,
          amountSats: partDistInv.amountSats,
          txid: partDistTxid,
          durationYears: 4,
          challengeCadence: 'daily',
          responseDeadline: '10s'
        }]);
        assert.strictEqual(partStor.type, 'CreateStorageContractResult', 'partition storage contract');
        const partPurchInv = await rpc(httpBases[0], 'CreatePurchaseInvoice', [{ documentId: partitionDocId }]);
        assert.strictEqual(partPurchInv.type, 'CreatePurchaseInvoiceResult', 'partition purchase invoice');
        partitionPurchaseTxid = await sendPaymentOrWallet(
          httpBases[0],
          tokens[0],
          btc0,
          partPurchInv.address,
          partPurchInv.amountSats
        );
        assert.ok(partitionPurchaseTxid, 'partition purchase pay');
        allRoundTxids.push(`partition-distribute:${partDistTxid}`);
        allRoundTxids.push(`partition-purchase:${partitionPurchaseTxid}`);
        totalInvoicePurchaseSats += Math.round(Number(partPurchInv.amountSats) || 0);
        await playnetLogMempoolAfterBroadcast(btc0, partitionPurchaseTxid, 'partition purchase pay');
        await playnetMineBlockConfirmTx(
          httpBases[0],
          tokens[0],
          btc0,
          partitionPurchaseTxid,
          'partition purchase confirm',
          l1BlockCounter
        );
        const partClaim = await rpc(httpBases[0], 'ClaimPurchase', [{
          documentId: partitionDocId,
          txid: partitionPurchaseTxid
        }]);
        assert.strictEqual(partClaim.type, 'ClaimPurchaseResult', 'partition ClaimPurchase');
        assert.ok(partClaim.document && partClaim.document.contentBase64, 'partition claim content');

        const addr0to2 = `127.0.0.1:${fabricPorts[2]}`;
        const addr2to0 = `127.0.0.1:${fabricPorts[0]}`;
        const addr1to2 = `127.0.0.1:${fabricPorts[2]}`;
        const addr2to1 = `127.0.0.1:${fabricPorts[1]}`;
        const peersBeforePart = await playnetFabricPeerCount(httpBases[2]);
        await rpcResult(httpBases[0], 'RemovePeer', [addr0to2]);
        await rpcResult(httpBases[2], 'RemovePeer', [addr2to0]);
        await rpcResult(httpBases[1], 'RemovePeer', [addr1to2]);
        await rpcResult(httpBases[2], 'RemovePeer', [addr2to1]);
        await sleep(2500);
        const sendWhilePart = await rpcResult(httpBases[0], 'SendPeerFile', [
          { address: addr0to2 },
          { id: partitionDocId }
        ]);
        assert.ok(
          !sendWhilePart || sendWhilePart.status !== 'success',
          `SendPeerFile should not succeed across Fabric partition; got ${JSON.stringify(sendWhilePart).slice(0, 180)}`
        );
        l1Lines.push('partition: hub2 isolated (cut 0↔2 and 1↔2) → SendPeerFile blocked');
        await rpc(httpBases[0], 'AddPeer', [addr0to2]);
        await rpc(httpBases[2], 'AddPeer', [addr2to0]);
        await rpc(httpBases[1], 'AddPeer', [addr1to2]);
        await rpc(httpBases[2], 'AddPeer', [addr2to1]);
        await sleep(2500);
        try {
          await rpc(httpBases[2], 'RequestFabricPeerResync', [{ address: addr2to0 }]);
        } catch (_) {}
        await sleep(800);
        const fid2 = hubs[2].agent && hubs[2].agent.identity && hubs[2].agent.identity.id;
        let sendHealed = await rpcResult(httpBases[0], 'SendPeerFile', [{ address: addr0to2 }, { id: partitionDocId }]);
        if (!sendHealed || sendHealed.status !== 'success') {
          sendHealed = await rpcResult(httpBases[0], 'SendPeerFile', [{ id: String(fid2) }, { id: partitionDocId }]);
        }
        assert.strictEqual(
          sendHealed && sendHealed.status,
          'success',
          `SendPeerFile after heal: ${sendHealed && sendHealed.message ? sendHealed.message : JSON.stringify(sendHealed)}`
        );
        const peersAfterHeal = await playnetFabricPeerCount(httpBases[2]);
        assert.ok(
          peersAfterHeal >= 1,
          `hub2 should see Fabric peers after heal (was ${peersBeforePart})`
        );
        let partDlOk = false;
        for (let a = 0; a < 40; a++) {
          const g = await rpc(httpBases[2], 'GetDocument', [{ id: partitionDocId }]);
          partDlOk = !!(g && g.document && g.document.contentBase64);
          if (partDlOk) break;
          await sleep(400);
        }
        assert.ok(partDlOk, 'hub2 GetDocument after partition heal (P2P download / replication)');
        l1Lines.push(
          `partition: healed → SendPeerFile ok; hub2 downloaded doc ${partitionDocId.slice(0, 10)}…`
        );

        const browserStoryPurchaseTxid = partitionPurchaseTxid || lastPurchaseTxid;
        let storyBlockHash = '';
        if (browserStoryPurchaseTxid && /^[0-9a-fA-F]{64}$/.test(browserStoryPurchaseTxid)) {
          storyBlockHash = await playnetBlockHashForTxid(btc0, browserStoryPurchaseTxid);
        }

        if (desktopHttpHint) {
          const sampleTxids = [];
          for (const line of allRoundTxids) {
            const m = String(line).match(/:([0-9a-fA-F]{64})$/);
            if (m) sampleTxids.push(m[1]);
          }
          logPlaynetDesktopMcpHints({
            desktopHttp: desktopHttpHint,
            browserHttpBase,
            fabricPorts,
            n,
            sampleTxids
          });
          l1Lines.push(
            `MCP: desktop ${desktopHttpHint} — add Fabric peer 127.0.0.1:${fabricPorts[0]} (and other mesh ports) on the desktop Hub`
          );
        }

        for (let i = 1; i < n; i++) {
          try {
            await rpc(httpBases[i], 'RequestFabricPeerResync', [{ address: `127.0.0.1:${fabricPorts[0]}` }]);
          } catch (_) {}
        }
        await sleep(2000);

        // Prefer the peer's listen address when hub 0 outbound-connected to that port; otherwise
        // the active session may be keyed by the remote ephemeral port (mutual AddPeer), so fall
        // back to Fabric id resolution. Space sends slightly to reduce back-to-back wire bursts.
        for (let i = 1; i < n; i++) {
          const fid = hubs[i].agent && hubs[i].agent.identity && hubs[i].agent.identity.id;
          assert.ok(fid, `hub ${i} fabric id`);
          const peerAddr = `127.0.0.1:${fabricPorts[i]}`;
          let sf = await rpcResult(httpBases[0], 'SendPeerFile', [{ address: peerAddr }, { id: lastDocId }]);
          if (!sf || sf.status !== 'success') {
            sf = await rpcResult(httpBases[0], 'SendPeerFile', [{ id: String(fid) }, { id: lastDocId }]);
          }
          assert.strictEqual(
            sf && sf.status,
            'success',
            `SendPeerFile hub0→hub${i} (${peerAddr} / id) doc ${lastDocId.slice(0, 8)}…: ${sf && sf.message ? sf.message : sf}`
          );
          await sleep(400);
        }

        if (referenceDocId && referenceDocId !== lastDocId) {
          for (let i = 1; i < n; i++) {
            const fid = hubs[i].agent && hubs[i].agent.identity && hubs[i].agent.identity.id;
            assert.ok(fid, `hub ${i} fabric id (reference send)`);
            const peerAddr = `127.0.0.1:${fabricPorts[i]}`;
            let sf = await rpcResult(httpBases[0], 'SendPeerFile', [{ address: peerAddr }, { id: referenceDocId }]);
            if (!sf || sf.status !== 'success') {
              sf = await rpcResult(httpBases[0], 'SendPeerFile', [{ id: String(fid) }, { id: referenceDocId }]);
            }
            assert.strictEqual(
              sf && sf.status,
              'success',
              `SendPeerFile reference doc hub0→hub${i}: ${sf && sf.message ? sf.message : sf}`
            );
            await sleep(400);
          }
        }

        const pollMs = 500;
        const pollAttempts = 60;
        const remoteDocOk = new Array(n - 1).fill(false);
        for (let attempt = 0; attempt < pollAttempts; attempt++) {
          for (let i = 1; i < n; i++) {
            const got = await rpc(httpBases[i], 'GetDocument', [{ id: lastDocId }]);
            remoteDocOk[i - 1] = !!(got && got.document && got.document.contentBase64);
          }
          if (remoteDocOk.every(Boolean)) break;
          await sleep(pollMs);
        }

        const listedRemote = await rpc(httpBases[n - 1], 'ListDocuments', []);
        const docsR = listedRemote && listedRemote.documents ? listedRemote.documents : [];
        const catalogLists = docsR.some((d) => d && (d.id === lastDocId || d.sha256 === lastDocId));
        assert.ok(
          catalogLists,
          'satellite ListDocuments should include the replicated published id (participation value)'
        );

        assert.ok(referenceDocId && referenceContentB64, 'round 0 should pin reference document');
        const referenceRows = await playnetWaitReferenceDocNetwork(
          httpBases,
          referenceDocId,
          referenceContentB64,
          45000
        );
        if (playnetReport) {
          console.log(
            `[PLAYNET:REFERENCE_DOC] round-0 reference ${referenceDocId.slice(0, 10)}… on all ${httpBases.length} hubs: ` +
              `${referenceRows.map((r) => `h${r.hub}=${r.listed && r.payloadMatch ? 'ok' : 'bad'}`).join(' ')}`
          );
        }

        const l1FeeTxids = playnetExtractTxidsFromRoundLines(allRoundTxids);
        const { sum: l1TotalTxFeesSats, count: l1FeeTxCount } = await playnetSumWalletFeesForTxids(btc0, l1FeeTxids);
        const l1WalletTrustedEnd = await playnetFabricWalletTrustedBtc(btc0);
        const walletDeltaBtc = l1WalletTrustedEnd - l1WalletTrustedStart;
        const invoiceFlowBtc = (totalInvoiceDistributeSats + totalInvoicePurchaseSats) / 1e8;
        const regtestSubsidySats = Math.round(50 * 1e8) * l1BlockCounter.blocks;
        const peerRow = [];
        for (let hi = 0; hi < httpBases.length; hi++) {
          try {
            const st = await rpc(httpBases[hi], 'GetNetworkStatus', []);
            const pb = st && st.peers;
            peerRow.push(pb && typeof pb === 'object' ? Object.keys(pb).length : 0);
          } catch (_) {
            peerRow.push(0);
          }
        }
        const docCounts = [];
        for (let hi = 0; hi < httpBases.length; hi++) {
          try {
            const listed = await rpc(httpBases[hi], 'ListDocuments', []);
            docCounts.push((listed && listed.documents ? listed.documents : []).length);
          } catch (_) {
            docCounts.push(0);
          }
        }
        const nodeEconomics = [
          `hub 0 (L1 anchor): nominal invoice Σ ${totalInvoiceDistributeSats + totalInvoicePurchaseSats} sats (protocol line items) | miner fees Σ ${l1TotalTxFeesSats} sats (${l1FeeTxCount} txs; vsize floor if wallet fee field unreliable) | regtest coinbase from this test ${l1BlockCounter.blocks}×50 BTC = ${regtestSubsidySats} sats | wallet trusted+pending ${l1WalletTrustedStart.toFixed(4)}→${l1WalletTrustedEnd.toFixed(4)} BTC (Δ${walletDeltaBtc.toFixed(4)} — coinbase maturity dominates)`,
          ...httpBases.slice(1).map((_, idx) => {
            const hi = idx + 1;
            return `hub ${hi} (Fabric): L1 spend 0 | tx fees 0 | Fabric peers ~${peerRow[hi]} | ListDocuments ${docCounts[hi]} rows | replicated reference + mesh catalog without local bitcoind (participation benefit vs hub 0 chain fees)`;
          })
        ];
        const econSummary = [
          `[PLAYNET:L1_ECONOMICS] invoice volume (nominal distribute+purchase): ${totalInvoiceDistributeSats} + ${totalInvoicePurchaseSats} = ${totalInvoiceDistributeSats + totalInvoicePurchaseSats} sats (~${invoiceFlowBtc.toFixed(8)} BTC) | generateblock ${l1BlockCounter.blocks}× (each tx conf≥1)`,
          `[PLAYNET:L1_ECONOMICS] tx fees (miners, wallet gettransaction when <0.05 BTC else vsize×1 sat lower bound): Σ ${l1TotalTxFeesSats} sats over ${l1FeeTxCount} txs | regtest subsidy (this test): ${regtestSubsidySats} sats`,
          `[PLAYNET:L1_ECONOMICS] anchor wallet trusted+pending: ${l1WalletTrustedStart.toFixed(4)} → ${l1WalletTrustedEnd.toFixed(4)} BTC (Δ ${walletDeltaBtc.toFixed(4)} — regtest: coinbase maturity buckets, not invoice sats)`,
          '[PLAYNET:L1_ECONOMICS] Profit link: Markov simulation proves some operators net-positive in the stochastic model; this mesh proves the same shapes on-chain (broadcast → mempool → conf≥1) and satellites gain replicated catalog without funding bitcoind.'
        ];
        for (const ln of econSummary) console.log(ln);
        for (const ne of nodeEconomics) console.log(`[PLAYNET:L1_ECONOMICS] ${ne}`);
        l1Lines.push(
          `economics: invoices distribute ${totalInvoiceDistributeSats} + purchase ${totalInvoicePurchaseSats} sats; tx fees ${l1TotalTxFeesSats} sats; blocks ${l1BlockCounter.blocks}; wallet Δ ${walletDeltaBtc.toFixed(4)} BTC`
        );
        assert.ok(
          totalInvoiceDistributeSats > 0 && totalInvoicePurchaseSats > 0,
          'L1 mesh should move non-zero distribute and purchase invoice volume'
        );
        assert.ok(l1WalletTrustedEnd > 0, 'anchor wallet should remain funded after protocol exercise');
        assert.ok(
          l1BlockCounter.blocks >= rounds * 2,
          `expected ≥${rounds * 2} main-round confirmations (got ${l1BlockCounter.blocks})`
        );

        if (runMeshL1ChainAudit) {
          const auditBase = browserHttpBase;
          if (auditBase !== httpBases[0]) {
            try {
              await waitBitcoinHttpAvailable(auditBase, 45000);
            } catch (err) {
              l1Lines.push(
                `chain-audit: optional base wait failed (${auditBase}): ${err && err.message ? err.message : err}`
              );
            }
          }
          const btcStatus = await rpc(auditBase, 'GetBitcoinStatus', []);
          const tipHex = String(btcStatus && btcStatus.bestHash ? btcStatus.bestHash : '').trim();
          const chainH = btcStatus && btcStatus.height != null ? Number(btcStatus.height) : NaN;
          const recent = Array.isArray(btcStatus && btcStatus.recentBlocks) ? btcStatus.recentBlocks : [];
          const chainSampleUi = recent
            .map((b) => playnetTrimHashUi(b && (b.hash || b.id)))
            .filter(Boolean)
            .slice(0, 4);
          assert.ok(
            tipHex && /^[0-9a-fA-F]{64}$/.test(tipHex),
            'GetBitcoinStatus.bestHash (64 hex) required for chain audit'
          );
          assert.ok(
            chainSampleUi.length >= 1,
            'GetBitcoinStatus.recentBlocks should list at least one header (Explorer parity)'
          );
          const chainLines = chainSampleUi.length
            ? chainSampleUi.map((h, i) => `    ${i === 0 ? 'tip' : `-${i}`}  ${h}`).join('\n')
            : '    (no recentBlocks in status)';
          console.log(
            [
              '',
              '[PLAYNET:CHAIN_AUDIT] GetBitcoinStatus + HTTP block/tx JSON',
              `  base   ${auditBase}`,
              `  height ${Number.isFinite(chainH) ? chainH : '—'}`,
              '  hashes (same trim as UI: 8…8)',
              chainLines,
              ''
            ].join('\n')
          );
          l1Lines.push(
            `chain-audit: ${auditBase} height=${Number.isFinite(chainH) ? chainH : '—'} sample ${chainSampleUi.join(' | ')}`
          );

          if (storyBlockHash && browserStoryPurchaseTxid && /^[0-9a-fA-F]{64}$/.test(storyBlockHash)) {
            const br = await httpJson(
              auditBase,
              'GET',
              `/services/bitcoin/blocks/${encodeURIComponent(storyBlockHash)}`,
              null
            );
            assert.strictEqual(
              br.status,
              200,
              `purchase block GET → HTTP ${br.status}: ${String(br.raw || '').slice(0, 240)}`
            );
            assert.ok(
              playnetBlockJsonContainsTxid(br.body, browserStoryPurchaseTxid),
              `block JSON should list purchase txid (${browserStoryPurchaseTxid.slice(0, 14)}…)`
            );
            l1Lines.push(
              `chain-audit: purchase tx in block ${playnetTrimHashUi(storyBlockHash)}`
            );
            console.log(
              `[PLAYNET:CHAIN_AUDIT] purchase tx in block /services/bitcoin/blocks/${storyBlockHash.slice(0, 16)}…`
            );
          }

          if (playnetBrowserDeepBlock && tipHex && /^[0-9a-fA-F]{64}$/.test(tipHex)) {
            const br = await httpJson(
              auditBase,
              'GET',
              `/services/bitcoin/blocks/${encodeURIComponent(tipHex)}`,
              null
            );
            assert.strictEqual(br.status, 200, `tip block GET → HTTP ${br.status}`);
            const b = br.body;
            assert.ok(b && typeof b === 'object', 'tip block body should be JSON object');
            assert.ok(
              String(b.hash || '').toLowerCase() === tipHex.toLowerCase(),
              'block.hash should match chain tip'
            );
            assert.ok(Array.isArray(b.tx) && b.tx.length >= 1, 'tip block should include tx[]');
            const parent = b.previousblockhash || b.previoushash;
            assert.ok(
              !parent || typeof parent === 'string',
              'tip block may include previousblockhash when not genesis'
            );
            l1Lines.push(
              `chain-audit: tip block nTx=${b.nTx != null ? b.nTx : b.tx.length} parent=${parent ? playnetTrimHashUi(parent) : '—'}`
            );
            console.log(`[PLAYNET:CHAIN_AUDIT] tip block JSON OK (nTx=${b.nTx != null ? b.nTx : b.tx.length})`);
          }

          if (playnetBrowserDeepTx) {
            const txIds = playnetExtractTxidsFromRoundLines(allRoundTxids);
            const deepSet = [];
            for (const t of txIds) {
              if (t && /^[0-9a-fA-F]{64}$/.test(t) && !deepSet.includes(t)) deepSet.push(t);
              if (deepSet.length >= 2) break;
            }
            if (
              browserStoryPurchaseTxid &&
              /^[0-9a-fA-F]{64}$/.test(browserStoryPurchaseTxid) &&
              !deepSet.includes(browserStoryPurchaseTxid)
            ) {
              deepSet.unshift(browserStoryPurchaseTxid);
            }
            const toVisit = deepSet.slice(0, 2);
            if (toVisit.length === 0) {
              l1Lines.push('chain-audit: deep tx skipped (no 64-hex txid in round lines)');
            }
            for (const tx0 of toVisit) {
              const tr = await httpJson(
                auditBase,
                'GET',
                `/services/bitcoin/transactions/${encodeURIComponent(tx0)}`,
                null
              );
              assert.strictEqual(tr.status, 200, `tx GET ${tx0.slice(0, 12)}… → HTTP ${tr.status}`);
              const txb = tr.body;
              assert.ok(
                txb && Array.isArray(txb.vin) && Array.isArray(txb.vout),
                `transaction JSON should include vin/vout (${tx0.slice(0, 12)}…)`
              );
              assert.ok(
                String(txb.txid || '').toLowerCase() === tx0.toLowerCase(),
                'transaction.txid should match path'
              );
              l1Lines.push(
                `chain-audit: tx ${tx0.slice(0, 14)}… vin=${txb.vin.length} vout=${txb.vout.length}`
              );
              console.log(`[PLAYNET:CHAIN_AUDIT] tx JSON OK ${tx0.slice(0, 16)}…`);
            }
          }
        }

        l1Lines.push(`txid lines: ${allRoundTxids.join('; ')}`);

        assert.ok(
          remoteDocOk.length === n - 1 && remoteDocOk.every(Boolean),
          `hubs 1..${n - 1} should hold document payload after P2P SendPeerFile (${lastDocId}); ok=${JSON.stringify(
            remoteDocOk
          )}`
        );
        l1Lines.push(
          `remote replication: hubs 1..${n - 1} GetDocument ok=${remoteDocOk.join(',')}; hub ${n - 1} ListDocuments lists id=${catalogLists}`
        );

        if (playnetReport) {
          const report = await formatPlaynetMeshFinalReport(httpBases, {
            illustrativeOfferSats: 11_000,
            publishedDocId: referenceDocId || lastDocId,
            mode: 'l1',
            federation: { threshold, validatorPubkeysHex: pubkeys, fabricPorts },
            l1ExtraLines: l1Lines,
            referenceDocument: referenceDocId
              ? { id: referenceDocId, rows: referenceRows }
              : undefined,
            nodeEconomics
          });
          console.log(report);
        }
      }
    );
  });
});
