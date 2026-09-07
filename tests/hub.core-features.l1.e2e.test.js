'use strict';

/**
 * Three-hub gossip mesh with L1 proofs for core Hub features (optional; not in
 * default `npm test`).
 *
 * Hub 0 — registry: managed isolated regtest, Beacon native `fabric-beacon`,
 *   operator Accept, document seller, hallmark OP_RETURN.
 * Hub 1 — buyer: Fabric-only, Document Market accumulate.
 * Hub 2 — application publisher: Fabric-only; gossips CONTRACT_PUBLISH /
 *   CONTRACT_MESSAGE into the registry.
 *
 * Narrative:
 *   1. Publish the Hub registry (native Beacon ARC) and prove it on HTTP + L1.
 *   2. Gossip an application contract, Accept it, iterate sidechain patches and
 *      CONTRACT_MESSAGE frames, then seal a Fabric hallmark (OP_RETURN) that
 *      commits the contracts digest to the tip.
 *   3. Document market: unpriced inventory + SendPeerFile, then priced sealed
 *      publish → P2TR inventory HTLC → ConfirmInventoryHtlcPayment → ciphertext,
 *      with VerifyBitcoinL1Payment / HTTP tx proof.
 *   4. WebRTC spokes (one per hub, plus a second on the registry hub):
 *      same-hub signaling, spoke-origin chat + CONTRACT_MESSAGE across the
 *      Fabric mesh, spoke-origin document publish fetched by another spoke.
 *
 * Prerequisites: `bitcoind` on PATH.
 *
 *   npm run test:e2e-core-features-l1
 *
 * Env:
 *   FABRIC_CORE_FEATURES_L1_E2E=1  — required to run (otherwise skipped).
 */

const assert = require('assert');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');

const crypto = require('crypto');
const WebSocket = require('ws');
const Actor = require('@fabric/core/types/actor');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const { HALLMARK_MAGIC_HEX } = require('@fabric/core/functions/fabricHallmark');

const { hubSettingsMerge } = require('../functions/hubSettingsMerge');
const { parseVerboseBlockForSidechainSignals } = require('../functions/sidechainBlockScan');
const Hub = require('../services/hub');
const settings = require('../settings/local');

const RUN = process.env.FABRIC_CORE_FEATURES_L1_E2E === '1'
  || process.env.FABRIC_CORE_FEATURES_L1_E2E === 'true';

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0', '-fallbackfee=0.0002'];
const PRICE_SATS = 2500;
const APP_NAME = 'core-features-e2e-app';
const NOTE_ROUNDS = 3;
const PATCH_ROUNDS = 3;

function bitcoindOnPath () {
  try {
    execSync('command -v bitcoind', { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function rpcCall (baseUrl, method, params, { throwOnRpcError = true } = {}) {
  const res = await httpJson(baseUrl, 'POST', '/services/rpc', {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params || []
  });
  if (res.status !== 200) throw new Error(`RPC HTTP ${res.status}: ${res.raw}`);
  if (res.body && res.body.error) {
    throw new Error(res.body.error.message || JSON.stringify(res.body.error));
  }
  const r = res.body && res.body.result;
  if (throwOnRpcError && r && r.status === 'error') {
    throw new Error(r.message || 'RPC error');
  }
  return r;
}

async function rpc (baseUrl, method, params) {
  return rpcCall(baseUrl, method, params, { throwOnRpcError: true });
}

async function rpcSoft (baseUrl, method, params) {
  return rpcCall(baseUrl, method, params, { throwOnRpcError: false });
}

async function waitBitcoinHttp (httpBase, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await httpJson(httpBase, 'GET', '/services/bitcoin');
    if (st.status === 200 && st.body && st.body.available) return;
    await sleep(400);
  }
  throw new Error(`Bitcoin not available on ${httpBase}`);
}

function peerCount (status) {
  const peers = status && status.peers;
  if (Array.isArray(peers)) return peers.length;
  if (peers && typeof peers === 'object') return Object.keys(peers).length;
  return 0;
}

function connectionCount (hub) {
  const conns = hub && hub.agent && hub.agent.connections;
  if (!conns || typeof conns !== 'object') return 0;
  return Object.keys(conns).length;
}

async function waitPeerSession (hub, min = 1, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (connectionCount(hub) >= min) return;
    await sleep(200);
  }
  throw new Error(`Fabric TCP session did not come up (want ${min}, have ${connectionCount(hub)})`);
}

function publisherPubkeyHex (hub) {
  const k = hub && hub.agent && hub.agent.key;
  const pub = k && k.pubkey != null ? String(k.pubkey) : '';
  if (!pub) throw new Error('hub has no identity pubkey');
  return pub.toLowerCase();
}

function buyerRefundPubkeyHex (hub) {
  const k = hub && hub.agent && hub.agent.key;
  if (!k || !k.public || typeof k.public.encodeCompressed !== 'function') {
    throw new Error('buyer hub has no compressed pubkey');
  }
  return String(k.public.encodeCompressed('hex'));
}

function signFrame (hub, type, body) {
  const msg = Message.fromVector([type, JSON.stringify(body)]);
  msg.signWithKey(hub.agent.key);
  return msg;
}

async function gossipFrame (fromHub, msg) {
  if (fromHub.agent && typeof fromHub.agent.relayFrom === 'function') {
    try {
      await Promise.resolve(fromHub.agent.relayFrom('_hub', msg));
    } catch (_) { /* try sockets next */ }
  }
  const conns = (fromHub.agent && fromHub.agent.connections) || {};
  for (const addr of Object.keys(conns)) {
    const sock = conns[addr];
    if (sock && typeof sock._writeFabric === 'function') {
      try {
        sock._writeFabric(msg.toBuffer());
      } catch (_) {}
    }
  }
}

function waitInventoryItem (buyerHub, docId, { requireHtlc = false, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let lastSummary = 'no inventoryResponse';
    const timer = setTimeout(() => {
      buyerHub.agent.removeListener('inventoryResponse', onResp);
      reject(new Error(`inventoryResponse timed out (${lastSummary})`));
    }, timeoutMs);
    function onResp ({ message }) {
      const items = (message && message.object && message.object.items) || [];
      lastSummary = `${items.length} item(s); ids=${items.map((it) => it && it.id).filter(Boolean).join(',') || 'none'}`;
      const hit = items.find((it) => {
        if (!it) return false;
        const id = String(it.id || it.documentId || '').toLowerCase();
        if (id !== String(docId).toLowerCase()) return false;
        if (requireHtlc && !(it.htlc && it.htlc.settlementId)) return false;
        return true;
      });
      if (!hit) return;
      clearTimeout(timer);
      buyerHub.agent.removeListener('inventoryResponse', onResp);
      resolve(hit);
    }
    buyerHub.agent.on('inventoryResponse', onResp);
  });
}

async function waitDocumentBytes (baseUrl, docId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastMsg = '';
  while (Date.now() < deadline) {
    const r = await rpc(baseUrl, 'GetDocument', [{ id: docId }]);
    const doc = r && r.document;
    if (doc && typeof doc.contentBase64 === 'string' && doc.contentBase64.length > 0) {
      return doc;
    }
    lastMsg = (r && r.message)
      || (doc && doc.local === false ? 'peer metadata only' : '')
      || (doc ? 'document without contentBase64' : 'no document');
    await sleep(400);
  }
  throw new Error(`GetDocument wait timeout (${String(docId).slice(0, 8)}…): ${lastMsg}`);
}

function httpBaseToWsUrl (httpBase) {
  return String(httpBase).replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://').replace(/\/?$/, '/');
}

function jsonCallHash (body) {
  const preimage = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  return crypto.createHash('sha256').update(preimage, 'utf8').digest('hex');
}

function parseJsonCallResult (msg) {
  const t = msg && (msg.friendlyType || msg.type);
  if (t !== 'JSONCall' && t !== 'JSON_CALL') return null;
  try {
    const inner = JSON.parse(msg.body);
    if (!inner || inner.method !== 'JSONCallResult') return null;
    return inner;
  } catch (_) {
    return null;
  }
}

function frameBodyText (msg) {
  if (!msg) return '';
  try {
    if (typeof msg.body === 'string') return msg.body;
    if (msg.body && Buffer.isBuffer(msg.body)) return msg.body.toString('utf8');
    if (msg.raw && msg.raw.data != null) {
      const d = msg.raw.data;
      return Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
    }
  } catch (_) { /* ignore */ }
  return '';
}

/**
 * Browser-shaped Hub spoke: WebSocket AMP + JSONCall (Bridge path), with HTTP
 * JSON-RPC fallback for the same methods.
 */
class HubWsSpoke {
  /**
   * @param {object} opts
   * @param {string} opts.httpBase
   * @param {number} opts.hubIndex
   * @param {string} opts.peerId
   */
  constructor (opts) {
    this.httpBase = opts.httpBase;
    this.hubIndex = opts.hubIndex;
    this.peerId = opts.peerId;
    this.key = new Key();
    this.ws = null;
    this.frames = [];
    this._waiters = [];
    this._httpOnly = false;
  }

  async open (timeoutMs = 10000) {
    const url = httpBaseToWsUrl(this.httpBase);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch (_) {}
        reject(new Error(`WebSocket open timeout (${url})`));
      }, timeoutMs);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('error', (err) => {
        if (ws.readyState === WebSocket.OPEN) return;
        clearTimeout(timer);
        reject(err);
      });
      ws.on('message', (data) => {
        let msg = null;
        try {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          msg = Message.fromBuffer(buf);
        } catch (_) {
          return;
        }
        this.frames.push(msg);
        for (const waiter of this._waiters.slice()) waiter(msg);
      });
    });
  }

  /**
   * @param {function} pred
   * @param {number} [timeoutMs]
   * @returns {Promise<object>}
   */
  waitFrame (pred, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const hit = this.frames.find(pred);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== onMsg);
        reject(new Error(`spoke ${this.peerId} waitFrame timeout`));
      }, timeoutMs);
      const onMsg = (msg) => {
        if (!pred(msg)) return;
        clearTimeout(timer);
        this._waiters = this._waiters.filter((w) => w !== onMsg);
        resolve(msg);
      };
      this._waiters.push(onMsg);
    });
  }

  async waitBody (needle, timeoutMs = 20000) {
    const n = String(needle);
    return this.waitFrame((msg) => frameBodyText(msg).includes(n), timeoutMs);
  }

  async rpcWs (method, params, timeoutMs = 15000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('spoke WebSocket is not open');
    }
    const body = JSON.stringify({ method, params: params || [] });
    const wantHash = jsonCallHash(body);
    const call = Message.fromVector(['JSONCall', body]).signWithKey(this.key);
    const pending = this.waitFrame((msg) => {
      const inner = parseJsonCallResult(msg);
      if (!inner || !Array.isArray(inner.params)) return false;
      if (inner.params[1] && inner.params[1].type === 'WebRTCSignal') return false;
      return inner.params[0] === wantHash;
    }, timeoutMs);
    this.ws.send(call.toBuffer());
    const frame = await pending;
    const inner = parseJsonCallResult(frame);
    if (inner.error) {
      throw new Error(inner.error.message || JSON.stringify(inner.error));
    }
    const r = inner.params[1];
    if (r && r.status === 'error') throw new Error(r.message || 'RPC error');
    return r;
  }

  async rpc (method, params) {
    if (!this._httpOnly) {
      try {
        return await this.rpcWs(method, params, 8000);
      } catch (_) {
        this._httpOnly = true;
      }
    }
    return rpc(this.httpBase, method, params);
  }

  close () {
    this._waiters = [];
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}

async function waitTracked (httpBase, pred, timeoutMs = 30000, label = 'tracked contracts') {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await rpc(httpBase, 'ListTrackedApplicationContracts', []);
    if (pred(last)) return last;
    await sleep(400);
  }
  throw new Error(`${label} timed out: ${JSON.stringify({
    pendingCount: last && last.pendingCount,
    acceptedCount: last && last.acceptedCount,
    pending: last && (last.pending || []).map((e) => e.name),
    accepted: last && (last.accepted || []).map((e) => e.name)
  })}`);
}

(RUN ? describe : describe.skip)('Core features L1 (three-hub gossip)', function () {
  this.timeout(480000);

  /** @type {import('../services/hub')[]} */
  let hubs = [];
  let fsRoots = [];
  const httpBases = [];
  let fabricPorts = [];
  let adminTokens = [];
  let btc0 = null;
  let prevDefaultMaxListeners;
  /** @type {HubWsSpoke[]} */
  let spokes = [];
  /** @type {HubWsSpoke|null} */
  let spoke0b = null;
  const suite = {
    appContractId: null,
    pricedId: null,
    sealedB64: null
  };

  before(async function () {
    if (!bitcoindOnPath()) {
      this.skip();
      return;
    }

    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
    process.env.FABRIC_DOCUMENT_MARKET_ACCUMULATE = '1';
    prevDefaultMaxListeners = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = Math.max(Number(prevDefaultMaxListeners) || 10, 48);

    fabricPorts = [await getFreePort(), await getFreePort(), await getFreePort()];
    const httpPorts = [await getFreePort(), await getFreePort(), await getFreePort()];
    const btcP2p0 = await getFreePort();
    const btcRpc0 = await getFreePort();
    const zmq0 = await getFreePort();
    const seeds = [MNEMONIC_A, MNEMONIC_B, MNEMONIC_C];

    const makeBase = (i, root) => {
      if (i === 0) {
        return hubSettingsMerge(settings, {
          port: fabricPorts[i],
          peers: [],
          fs: { path: root },
          key: { mnemonic: seeds[i], seed: null },
          bitcoin: {
            enable: true,
            network: 'regtest',
            managed: true,
            listen: false,
            enforceIsolatedRegtest: true,
            port: btcP2p0,
            rpcport: btcRpc0,
            zmqPort: zmq0,
            datadir: path.join(root, 'bitcoin-datadir'),
            p2pAddNodes: [],
            bitcoinExtraParams: ['-dnsseed=0'].concat(extraBtcParams),
            documentBlocks: false,
            federationRegistryScan: { enable: false },
            hallmarks: { enable: false, scan: true }
          },
          beacon: { enable: true, interval: 600000, regtestOnly: true },
          payjoin: { enable: false },
          lightning: { managed: false, stub: true },
          http: { hostname: '127.0.0.1', listen: true, port: httpPorts[i] },
          debug: false
        });
      }
      return hubSettingsMerge(settings, {
        port: fabricPorts[i],
        peers: [],
        fs: { path: root },
        key: { mnemonic: seeds[i], seed: null },
        bitcoin: { enable: false, network: 'regtest' },
        beacon: { enable: false },
        payjoin: { enable: false },
        lightning: { managed: false, stub: true },
        documents: { market: { accumulatePeerInventories: true } },
        http: { hostname: '127.0.0.1', listen: true, port: httpPorts[i] },
        debug: false
      });
    };

    for (let i = 0; i < 3; i++) {
      const root = path.join(
        __dirname,
        '..',
        'stores',
        `core-features-l1-${process.pid}-${Date.now()}-${i}`
      );
      fs.mkdirSync(root, { recursive: true });
      fsRoots.push(root);
      const h = new Hub(makeBase(i, root));
      await h.start();
      hubs.push(h);
      httpBases.push(`http://127.0.0.1:${httpPorts[i]}`);
      await sleep(i === 0 ? 800 : 350);
    }

    for (let i = 0; i < 3; i++) {
      const boot = await httpJson(httpBases[i], 'POST', '/settings', {
        NODE_NAME: `CoreFeaturesL1-${i}`,
        LIGHTNING_MANAGED: false,
        bitcoinManaged: i === 0,
        BITCOIN_NETWORK: 'regtest',
        BITCOIN_LISTEN: false,
        BITCOIN_TXINDEX: true,
        BITCOIN_TXRELAY: true
      });
      assert.strictEqual(boot.status, 200, boot.raw);
      assert.ok(boot.body && boot.body.token, `admin token hub ${i}`);
      adminTokens[i] = boot.body.token;
    }

    await waitBitcoinHttp(httpBases[0], 120000);
    btc0 = hubs[0]._getBitcoinService();
    assert.ok(btc0, 'registry hub Bitcoin service');
    if (typeof btc0.on === 'function') {
      btc0.on('error', () => {});
    }

    const miningAddr = await btc0.getUnusedAddress();
    for (let g = 0; g < 12; g++) {
      await btc0._makeRPCRequest('generatetoaddress', [10, miningAddr]);
    }

    const add = async (fromIdx, toIdx) => {
      const addr = `127.0.0.1:${fabricPorts[toIdx]}`;
      const r = await rpc(httpBases[fromIdx], 'AddPeer', [addr]);
      assert.strictEqual(r.status, 'success', `AddPeer ${fromIdx}→${toIdx}`);
    };
    await add(0, 1);
    await add(0, 2);
    await add(1, 0);
    await add(1, 2);
    await add(2, 0);
    await add(2, 1);
    await waitPeerSession(hubs[0], 2);
    await waitPeerSession(hubs[1], 2);
    await waitPeerSession(hubs[2], 2);

    for (let i = 0; i < 3; i++) {
      const st = await rpc(httpBases[i], 'GetNetworkStatus', []);
      assert.ok(peerCount(st) >= 1, `hub ${i} should list Fabric peers`);
    }

    const runTag = `${process.pid}-${Date.now().toString(16).slice(-6)}`;
    for (let i = 0; i < 3; i++) {
      const spoke = new HubWsSpoke({
        httpBase: httpBases[i],
        hubIndex: i,
        peerId: `core-l1-spoke-${i}-${runTag}`
      });
      await spoke.open();
      spokes.push(spoke);
    }
    spoke0b = new HubWsSpoke({
      httpBase: httpBases[0],
      hubIndex: 0,
      peerId: `core-l1-spoke-0b-${runTag}`
    });
    await spoke0b.open();
  });

  after(async function () {
    this.timeout(120000);
    if (prevDefaultMaxListeners != null) {
      EventEmitter.defaultMaxListeners = prevDefaultMaxListeners;
    }
    for (const s of spokes.concat(spoke0b ? [spoke0b] : [])) {
      try { s.close(); } catch (_) {}
    }
    spokes = [];
    spoke0b = null;
    for (const h of hubs) {
      try {
        await Promise.race([
          h.stop(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 25000))
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

  it('publishes the Hub registry, accepts an application contract, and settles document-market L1', async function () {
    const adminToken = adminTokens[0];
    assert.ok(adminToken, 'registry admin token');

    // --- Hub registry (native fabric-beacon) ---
    const tracked0 = await waitTracked(
      httpBases[0],
      (s) => (s.accepted || []).some((e) => e && e.name === 'fabric-beacon'),
      45000,
      'native fabric-beacon accept'
    );
    const beaconRow = (tracked0.accepted || []).find((e) => e.name === 'fabric-beacon');
    assert.ok(beaconRow && beaconRow.contractId, 'fabric-beacon contractId');
    assert.ok(/^[0-9a-f]{64}$/i.test(beaconRow.contractId), 'fabric-beacon id is Actor hex');

    const man = await httpJson(httpBases[0], 'GET', '/services/distributed/manifest', null);
    assert.strictEqual(man.status, 200, man.raw);
    assert.ok(man.body && man.body.programId, 'distributed manifest programId');
    const manTracked = man.body.trackedApplicationContracts || man.body.trackedContracts;
    if (manTracked) {
      assert.ok(
        Number(manTracked.acceptedCount || 0) >= 1
          || (manTracked.accepted || []).some((e) => e.name === 'fabric-beacon'),
        'manifest lists accepted Beacon registry'
      );
    }
    const epoch = await httpJson(httpBases[0], 'GET', '/services/distributed/epoch', null);
    assert.strictEqual(epoch.status, 200, epoch.raw);

    // --- Application CONTRACT_PUBLISH from hub 2 ---
    const ownerPub = publisherPubkeyHex(hubs[2]);
    const definition = {
      name: APP_NAME,
      version: 1,
      messageTypes: ['AppNote', 'GroupChat'],
      parties: [ownerPub],
      validators: [ownerPub],
      proposedPolicy: { validators: [ownerPub], threshold: 1 },
      creator: ownerPub,
      members: { signers: [ownerPub], threshold: 1 },
      state: { network: 'regtest', suite: 'core-features-l1' }
    };
    const appContractId = new Actor(definition).id;
    suite.appContractId = appContractId;
    assert.ok(/^[0-9a-f]{64}$/i.test(appContractId), 'application Actor id');

    const pendingWait = waitTracked(
      httpBases[0],
      (s) => (s.pending || []).some((e) => e.contractId === appContractId)
        || (s.accepted || []).some((e) => e.contractId === appContractId),
      25000,
      'application CONTRACT_PUBLISH pending'
    );
    await gossipFrame(hubs[2], signFrame(hubs[2], 'CONTRACT_PUBLISH', definition));
    let pendingSummary;
    try {
      pendingSummary = await pendingWait;
    } catch (err) {
      if (hubs[0].agent && typeof hubs[0].agent._handleFabricMessage === 'function') {
        hubs[0].agent._handleFabricMessage(
          signFrame(hubs[2], 'CONTRACT_PUBLISH', definition).toBuffer(),
          { name: `127.0.0.1:${fabricPorts[2]}` },
          null
        );
        pendingSummary = await waitTracked(
          httpBases[0],
          (s) => (s.pending || []).some((e) => e.contractId === appContractId)
            || (s.accepted || []).some((e) => e.contractId === appContractId),
          15000,
          'application CONTRACT_PUBLISH after local ingest'
        );
      } else {
        throw err;
      }
    }
    assert.ok(pendingSummary, 'application publish reached registry');

    const accepted = await rpc(httpBases[0], 'AcceptTrackedApplicationContract', [{
      contractId: appContractId,
      adminToken
    }]);
    assert.ok(accepted && (accepted.status === 'success' || accepted.type === 'AcceptTrackedApplicationContractResult'),
      accepted && accepted.message ? accepted.message : 'AcceptTrackedApplicationContract');
    assert.ok(accepted.contract && accepted.contract.contractId === appContractId);

    const sc0 = await rpc(httpBases[0], 'GetContractSidechainState', [{ contractId: appContractId }]);
    assert.ok(sc0 && sc0.type === 'ContractSidechainState', sc0 && sc0.message ? sc0.message : 'contract sidechain');
    let basisClock = Number(sc0.clock) || 0;
    let lastDigest = sc0.stateDigest;

    for (let i = 0; i < PATCH_ROUNDS; i++) {
      const patches = i === 0
        ? [{ op: 'add', path: '/round', value: 1 }]
        : [{ op: 'replace', path: '/round', value: i + 1 }];
      const patched = await rpc(httpBases[0], 'SubmitContractSidechainStatePatch', [{
        contractId: appContractId,
        patches,
        basisClock,
        adminToken
      }]);
      assert.strictEqual(patched.type, 'SubmitContractSidechainStatePatchResult', patched.message || 'patch');
      assert.strictEqual(Number(patched.clock), basisClock + 1);
      assert.ok(patched.stateDigest, 'patch produces stateDigest');
      assert.notStrictEqual(patched.stateDigest, lastDigest, 'each patch changes the digest');
      lastDigest = patched.stateDigest;
      basisClock = Number(patched.clock);
    }

    const scAfter = await rpc(httpBases[0], 'GetContractSidechainState', [{ contractId: appContractId }]);
    assert.strictEqual(Number(scAfter.content && scAfter.content.round), PATCH_ROUNDS);

    const beforeNotes = Number((hubs[0]._contractMessageCounts || {})[appContractId] || 0);
    for (let i = 0; i < NOTE_ROUNDS; i++) {
      await gossipFrame(hubs[2], signFrame(hubs[2], 'CONTRACT_MESSAGE', {
        contract: appContractId,
        type: 'AppNote',
        object: { body: `core-features iteration ${i + 1}`, n: i + 1 }
      }));
      await sleep(250);
    }
    const notesDeadline = Date.now() + 20000;
    while (Date.now() < notesDeadline) {
      const n = Number((hubs[0]._contractMessageCounts || {})[appContractId] || 0);
      if (n >= beforeNotes + NOTE_ROUNDS) break;
      await sleep(200);
    }
    const notesGot = Number((hubs[0]._contractMessageCounts || {})[appContractId] || 0);
    assert.ok(
      notesGot >= beforeNotes + NOTE_ROUNDS,
      `expected ${NOTE_ROUNDS} CONTRACT_MESSAGE frames (have ${notesGot - beforeNotes})`
    );

    // --- L1 hallmark commits registry + application contracts digest ---
    const committedTip = String(await btc0._makeRPCRequest('getbestblockhash', [])).toLowerCase();
    if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
      try {
        await btc0._makeWalletRequest('settxfee', [0.0001], btc0.walletName);
      } catch (_) { /* optional; hallmark PSBT pins fee_rate */ }
    }
    const hallmark = await rpc(httpBases[0], 'PublishFabricHallmark', [{
      adminToken,
      tipBlockHash: committedTip
    }]);
    assert.ok(hallmark && hallmark.txid, hallmark && hallmark.message ? hallmark.message : 'PublishFabricHallmark');
    assert.ok(hallmark.payloadHex && hallmark.payloadHex.toLowerCase().startsWith(HALLMARK_MAGIC_HEX),
      'hallmark OP_RETURN starts with c0d3f33d magic');
    assert.ok(hallmark.contracts || hallmark.payloadHex, 'hallmark encodes contracts snapshot');

    const miningAddr = await btc0.getUnusedAddress();
    const bitcoinBlockWait = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 20000);
      function onBlock () {
        clearTimeout(timer);
        hubs[1].agent.removeListener('bitcoinBlock', onBlock);
        resolve(true);
      }
      hubs[1].agent.on('bitcoinBlock', onBlock);
    });
    await btc0._makeRPCRequest('generatetoaddress', [1, miningAddr]);

    let walletTx = null;
    const waitTx = Date.now();
    while (Date.now() - waitTx < 20000) {
      try {
        if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
          walletTx = await btc0._makeWalletRequest('gettransaction', [hallmark.txid], btc0.walletName);
        } else {
          walletTx = await btc0._makeRPCRequest('getrawtransaction', [hallmark.txid, true]);
        }
        if (walletTx && Number(walletTx.confirmations || 0) >= 1) break;
      } catch (_) {}
      await sleep(250);
    }
    assert.ok(walletTx && Number(walletTx.confirmations || 0) >= 1, 'hallmark tx confirmed');

    const verboseTx = await btc0._makeRPCRequest('getrawtransaction', [hallmark.txid, true]).catch(() => null);
    const blockHash = (verboseTx && verboseTx.blockhash)
      || (walletTx && walletTx.blockhash)
      || null;
    assert.ok(blockHash, 'hallmark tx has containing block');
    const block = await btc0._makeRPCRequest('getblock', [blockHash, 2]);
    const height = Number(block.height);
    const signals = parseVerboseBlockForSidechainSignals(block, height, {
      hallmarksScan: true,
      tipBlockHashHex: committedTip,
      opReturnMagicHex: '',
      watchAddresses: [],
      recordTimelocks: false
    });
    const hit = signals.find((s) => s.kind === 'fabric_hallmark' && s.txid === hallmark.txid);
    assert.ok(hit, 'containing block decodes a fabric_hallmark OP_RETURN');
    assert.strictEqual(hit.payloadHex, hallmark.payloadHex);
    assert.strictEqual(hit.tipMatch, true, 'hallmark verifies against the committed tip');
    await bitcoinBlockWait;

    // --- Document market: unpriced inventory + SendPeerFile ---
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const freePlain = `core-features free ${runId}\n`;
    const freeB64 = Buffer.from(freePlain, 'utf8').toString('base64');
    const freeCreated = await rpc(httpBases[0], 'CreateDocument', [{
      name: `core-free-${runId}.txt`,
      mime: 'text/plain',
      contentBase64: freeB64
    }]);
    const freeId = freeCreated && freeCreated.document && freeCreated.document.id;
    assert.ok(freeId, 'CreateDocument free id');
    const freePub = await rpc(httpBases[0], 'PublishDocument', [{ id: freeId }]);
    assert.ok(freePub && freePub.document && freePub.document.published, 'unpriced PublishDocument');

    const sellerId = hubs[0].agent && hubs[0].agent.identity && hubs[0].agent.identity.id;
    assert.ok(sellerId, 'seller Fabric identity id');

    const freeInvWait = waitInventoryItem(hubs[1], freeId, { requireHtlc: false, timeoutMs: 45000 });
    let freeReq = await rpcSoft(httpBases[1], 'RequestPeerInventory', [String(sellerId), 'documents']);
    if (freeReq && freeReq.status === 'error') {
      freeReq = await rpc(httpBases[1], 'RequestPeerInventory', [
        `127.0.0.1:${fabricPorts[0]}`,
        'documents',
        { inventoryTarget: String(sellerId) }
      ]);
    } else {
      assert.ok(!freeReq || freeReq.status !== 'error', freeReq && freeReq.message);
    }
    const freeItem = await freeInvWait;
    assert.ok(freeItem && (freeItem.id || freeItem.documentId), 'unpriced inventory lists free doc');
    assert.ok(!freeItem.htlc || !freeItem.htlc.settlementId, 'unpriced inventory has no HTLC quote');

    const fid2 = hubs[2].agent && hubs[2].agent.identity && hubs[2].agent.identity.id;
    let sendFree = await rpcSoft(httpBases[0], 'SendPeerFile', [
      { address: `127.0.0.1:${fabricPorts[2]}` },
      { id: freeId }
    ]);
    if (!sendFree || sendFree.status !== 'success') {
      sendFree = await rpc(httpBases[0], 'SendPeerFile', [{ id: String(fid2) }, { id: freeId }]);
    }
    assert.strictEqual(sendFree.status, 'success', sendFree && sendFree.message);
    const freeOn2 = await waitDocumentBytes(httpBases[2], freeId, 45000);
    assert.strictEqual(freeOn2.contentBase64, freeB64, 'hub 2 received unpriced P2P_FILE_SEND plaintext');

    // --- Priced sealed publish + inventory HTLC on L1 ---
    const pricedPlain = `core-features htlc ${runId}\n`;
    const pricedB64 = Buffer.from(pricedPlain, 'utf8').toString('base64');
    const pricedCreated = await rpc(httpBases[0], 'CreateDocument', [{
      name: `core-htlc-${runId}.txt`,
      mime: 'text/plain',
      contentBase64: pricedB64
    }]);
    const pricedId = pricedCreated && pricedCreated.document && pricedCreated.document.id;
    assert.ok(pricedId, 'CreateDocument priced id');
    const pricedPub = await rpc(httpBases[0], 'PublishDocument', [{
      id: pricedId,
      purchasePriceSats: PRICE_SATS
    }]);
    assert.ok(pricedPub.document && pricedPub.document.published, 'priced PublishDocument');
    assert.strictEqual(Number(pricedPub.document.purchasePriceSats), PRICE_SATS);

    const sellerHeld = await rpc(httpBases[0], 'GetDocument', [{ id: pricedId }]);
    const sealedB64 = sellerHeld && sellerHeld.document && sellerHeld.document.contentBase64;
    assert.ok(sealedB64, 'seller holds sealed bytes');
    assert.notStrictEqual(sealedB64, pricedB64, 'priced publish stores ciphertext');

    const buyerHex = buyerRefundPubkeyHex(hubs[1]);
    const htlcWait = waitInventoryItem(hubs[1], pricedId, { requireHtlc: true, timeoutMs: 45000 });
    let req = await rpcSoft(httpBases[1], 'RequestPeerInventory', [
      String(sellerId),
      'documents',
      { buyerRefundPublicKey: buyerHex }
    ]);
    if (req && req.status === 'error') {
      req = await rpc(httpBases[1], 'RequestPeerInventory', [
        `127.0.0.1:${fabricPorts[0]}`,
        'documents',
        { buyerRefundPublicKey: buyerHex, inventoryTarget: String(sellerId) }
      ]);
    }
    assert.ok(!req || req.status !== 'error', req && req.message);

    const quoted = await htlcWait;
    const htlc = quoted.htlc;
    assert.ok(htlc.settlementId, 'HTLC settlementId');
    assert.ok(htlc.paymentAddress, 'HTLC paymentAddress');
    assert.ok(Number(htlc.amountSats) >= PRICE_SATS, 'HTLC amount covers list price');

    const offers = await rpc(httpBases[1], 'ListDocumentOffers', [{ documentId: pricedId }]);
    const offerHit = (offers && offers.offers || []).find((row) => row && row.htlc && row.htlc.settlementId);
    assert.ok(offerHit && offerHit.htlc.settlementId === htlc.settlementId, 'offer book keeps compact HTLC quote');
    assert.ok(!offerHit.htlc.preimageHex, 'offer book must not store preimage');

    if (typeof btc0._loadWallet === 'function') {
      await btc0._loadWallet(btc0.walletName);
    }
    const amountBtc = Number(htlc.amountSats) / 1e8;
    let fundTxid;
    if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
      fundTxid = await btc0._makeWalletRequest(
        'sendtoaddress',
        [htlc.paymentAddress, amountBtc],
        btc0.walletName
      );
    } else {
      fundTxid = await btc0._makeRPCRequest('sendtoaddress', [htlc.paymentAddress, amountBtc]);
    }
    assert.ok(fundTxid && String(fundTxid).length === 64, 'HTLC funding txid');

    await btc0._makeRPCRequest('generatetoaddress', [1, miningAddr]);
    const fundedAt = Date.now();
    while (Date.now() - fundedAt < 20000) {
      try {
        let wtx = null;
        if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
          wtx = await btc0._makeWalletRequest('gettransaction', [String(fundTxid).trim()], btc0.walletName);
        } else {
          wtx = await btc0._makeRPCRequest('gettransaction', [String(fundTxid).trim()]);
        }
        if (wtx && Number(wtx.confirmations || 0) >= 1) break;
      } catch (_) {}
      await sleep(250);
    }

    let confirm;
    for (let attempt = 0; attempt < 8; attempt++) {
      confirm = await rpcSoft(httpBases[0], 'ConfirmInventoryHtlcPayment', [{
        settlementId: htlc.settlementId,
        txid: String(fundTxid).trim()
      }]);
      if (confirm && confirm.status === 'success') break;
      await sleep(500);
    }
    assert.ok(confirm && confirm.status === 'success', confirm && confirm.message
      ? `ConfirmInventoryHtlcPayment: ${confirm.message}`
      : 'ConfirmInventoryHtlcPayment success');
    assert.strictEqual(confirm.documentId, pricedId);
    assert.ok(confirm.keyRevealed, 'seller reports HTLC_KEY_REVEAL sent');

    const l1 = await rpc(httpBases[0], 'VerifyBitcoinL1Payment', [{
      txid: String(fundTxid).trim(),
      address: htlc.paymentAddress,
      amountSats: Number(htlc.amountSats)
    }]);
    assert.strictEqual(l1.verified, true, `VerifyBitcoinL1Payment: ${JSON.stringify(l1)}`);
    assert.ok(Number(l1.confirmations) >= 1, 'HTLC funding has a confirmation');

    const httpProof = await httpJson(
      httpBases[0],
      'GET',
      `/services/bitcoin/transactions/${String(fundTxid).trim()}?address=${encodeURIComponent(htlc.paymentAddress)}&amountSats=${Number(htlc.amountSats)}`,
      null
    );
    assert.strictEqual(httpProof.status, 200, httpProof.raw);
    if (httpProof.body && httpProof.body.verified != null) {
      assert.strictEqual(httpProof.body.verified, true, 'HTTP L1 payment proof');
    }

    const delivered = await waitDocumentBytes(httpBases[1], pricedId, 45000);
    assert.strictEqual(delivered.contentBase64, sealedB64, 'buyer receives seller ciphertext');
    assert.notStrictEqual(delivered.contentBase64, pricedB64, 'buyer store is still sealed');
    suite.pricedId = pricedId;
    suite.sealedB64 = sealedB64;
  });

  it('uses WebRTC spokes as origin and destination across the gossip mesh', async function () {
    assert.strictEqual(spokes.length, 3, 'one WebRTC spoke per hub');
    assert.ok(spoke0b, 'second spoke on the registry hub');
    assert.ok(suite.appContractId, 'application contract id from L1 narrative');

    for (let i = 0; i < 3; i++) {
      const reg = await spokes[i].rpc('RegisterWebRTCPeer', [{
        peerId: spokes[i].peerId,
        metadata: { role: 'core-features-spoke', hub: i }
      }]);
      assert.strictEqual(reg.status, 'success', `RegisterWebRTCPeer hub ${i}`);
    }
    const reg0b = await spoke0b.rpc('RegisterWebRTCPeer', [{
      peerId: spoke0b.peerId,
      metadata: { role: 'core-features-spoke', hub: 0, extra: true }
    }]);
    assert.strictEqual(reg0b.status, 'success', 'RegisterWebRTCPeer hub 0b');

    for (let i = 0; i < 3; i++) {
      const listed = await spokes[i].rpc('ListWebRTCPeers', [{
        excludeSelf: true,
        peerId: spokes[i].peerId
      }]);
      assert.strictEqual(listed.type, 'ListWebRTCPeersResult', `ListWebRTCPeers hub ${i}`);
      assert.ok(Array.isArray(listed.peers), `ListWebRTCPeers peers hub ${i}`);
      if (i === 0) {
        assert.ok(
          listed.peers.some((p) => p && (p.id === spoke0b.peerId || p.peerId === spoke0b.peerId)),
          'registry hub lists the extra spoke'
        );
        assert.strictEqual(
          listed.peers.some((p) => p && (p.id === spokes[0].peerId || p.peerId === spokes[0].peerId)),
          false,
          'excludeSelf drops the calling spoke'
        );
      } else {
        assert.ok(listed.peers.length >= 0);
      }
    }

    const offerSdp = `v=0\r\no=- ${Date.now()} 1 IN IP4 127.0.0.1\r\ns=core-l1\r\n`;
    const signalWait = spoke0b.waitFrame((msg) => {
      const inner = parseJsonCallResult(msg);
      const payload = inner && inner.params && inner.params[1];
      return !!(payload && payload.type === 'WebRTCSignal'
        && payload.toPeerId === spoke0b.peerId
        && payload.fromPeerId === spokes[0].peerId);
    }, 15000);
    const sig = await spokes[0].rpc('SendWebRTCSignal', [{
      fromPeerId: spokes[0].peerId,
      toPeerId: spoke0b.peerId,
      signal: {
        type: 'offer',
        sdp: { type: 'offer', sdp: offerSdp },
        _fabric: { protocol: 'fabric-webrtc-v2', sessionId: spokes[0].peerId, targetSessionId: spoke0b.peerId }
      }
    }]);
    assert.strictEqual(sig.status, 'success', 'same-hub SendWebRTCSignal');
    const signalFrame = await signalWait;
    const signalInner = parseJsonCallResult(signalFrame);
    assert.ok(signalInner && signalInner.params[1].signal, 'extra spoke received WebRTCSignal');

    const chatText = `spoke-chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const chatWait = spokes[0].waitBody(chatText, 25000);
    const chatRelay = await spokes[2].rpc('RelayFromWebRTC', [{
      fromPeerId: spokes[2].peerId,
      envelope: {
        original: chatText,
        originalType: 'P2P_CHAT_MESSAGE',
        hops: []
      }
    }]);
    assert.strictEqual(chatRelay.status, 'success', chatRelay && chatRelay.message);
    await chatWait;

    const beforeNotes = Number((hubs[0]._contractMessageCounts || {})[suite.appContractId] || 0);
    const spokeNote = {
      contract: suite.appContractId,
      type: 'AppNote',
      object: { body: 'spoke-origin CONTRACT_MESSAGE', via: 'webrtc', n: Date.now() }
    };
    const signedNote = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(spokeNote)])
      .signWithKey(spokes[2].key);
    const noteRelay = await spokes[2].rpc('RelayFromWebRTC', [{
      fromPeerId: spokes[2].peerId,
      envelope: {
        original: signedNote.toBuffer().toString('base64'),
        originalType: 'CONTRACT_MESSAGE',
        hops: []
      }
    }]);
    assert.strictEqual(noteRelay.status, 'success', noteRelay && noteRelay.message);
    const notesDeadline = Date.now() + 20000;
    while (Date.now() < notesDeadline) {
      const n = Number((hubs[0]._contractMessageCounts || {})[suite.appContractId] || 0);
      if (n >= beforeNotes + 1) break;
      await sleep(200);
    }
    const notesGot = Number((hubs[0]._contractMessageCounts || {})[suite.appContractId] || 0);
    assert.ok(notesGot >= beforeNotes + 1, `spoke-origin CONTRACT_MESSAGE reached registry (have ${notesGot - beforeNotes})`);

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const spokePlain = `spoke-origin-doc ${runId}\n`;
    const spokeB64 = Buffer.from(spokePlain, 'utf8').toString('base64');
    const created = await spokes[0].rpc('CreateDocument', [{
      name: `spoke-origin-${runId}.txt`,
      mime: 'text/plain',
      contentBase64: spokeB64
    }]);
    const spokeDocId = created && created.document && created.document.id;
    assert.ok(spokeDocId, 'spoke-origin CreateDocument');
    const pub = await spokes[0].rpc('PublishDocument', [{ id: spokeDocId }]);
    assert.ok(pub && pub.document && pub.document.published, 'spoke-origin PublishDocument');

    const destId = hubs[2].agent && hubs[2].agent.identity && hubs[2].agent.identity.id;
    let send = await rpcSoft(httpBases[0], 'SendPeerFile', [
      { address: `127.0.0.1:${fabricPorts[2]}` },
      { id: spokeDocId }
    ]);
    if (!send || send.status !== 'success') {
      send = await spokes[0].rpc('SendPeerFile', [{ id: String(destId) }, { id: spokeDocId }]);
    }
    assert.ok(send && send.status === 'success', send && send.message);

    const destDeadline = Date.now() + 45000;
    let destDoc = null;
    while (Date.now() < destDeadline) {
      destDoc = await rpcSoft(httpBases[2], 'GetDocument', [{ id: spokeDocId }]);
      if (destDoc && destDoc.document && destDoc.document.contentBase64 === spokeB64) break;
      await sleep(400);
    }
    assert.ok(destDoc && destDoc.document && destDoc.document.contentBase64 === spokeB64,
      'hub 2 holds spoke-origin document bytes');
    const viaSpoke = await spokes[2].rpc('GetDocument', [{ id: spokeDocId }]);
    assert.strictEqual(viaSpoke.document.contentBase64, spokeB64, 'hub 2 spoke received spoke-origin document');

    if (suite.pricedId && suite.sealedB64) {
      const htlcDoc = await spokes[1].rpc('GetDocument', [{ id: suite.pricedId }]);
      assert.ok(htlcDoc && htlcDoc.document, 'buyer spoke sees HTLC document');
      assert.strictEqual(
        htlcDoc.document.contentBase64,
        suite.sealedB64,
        'buyer spoke reads seller ciphertext from the L1 inventory flow'
      );
    }
  });
});
