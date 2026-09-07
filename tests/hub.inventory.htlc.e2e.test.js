'use strict';

/**
 * Two-hub inventory HTLC on L1 (optional; not run in default `npm test`).
 *
 * Hub 0 (seller): managed isolated regtest + priced sealed document.
 * Hub 1 (buyer): Fabric-only peer. Requests inventory with a buyer refund
 * pubkey; seller attaches a P2TR HTLC quote; miner wallet funds that address;
 * seller `ConfirmInventoryHtlcPayment` pushes ciphertext over `P2P_FILE_SEND`.
 *
 * This is the dedicated automated suite for Hub Phase E document exchange on L1
 * (inventory HTLC across two hubs). Same-hub `CreatePurchaseInvoice` /
 * `ClaimPurchase` lives in `scripts/verify-document-purchase-e2e.js`.
 *
 * Prerequisites: `bitcoind` on PATH.
 *
 *   npm run test:e2e-inventory-htlc
 *
 * Env:
 *   FABRIC_INVENTORY_HTLC_E2E=1  — required to run (otherwise skipped).
 */

const assert = require('assert');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');

const { hubSettingsMerge } = require('../functions/hubSettingsMerge');
const Hub = require('../services/hub');
const settings = require('../settings/local');

const RUN = process.env.FABRIC_INVENTORY_HTLC_E2E === '1'
  || process.env.FABRIC_INVENTORY_HTLC_E2E === 'true';

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0'];
const PRICE_SATS = 2500;

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

async function rpc (baseUrl, method, params) {
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
  if (r && r.status === 'error') throw new Error(r.message || 'RPC error');
  return r;
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

async function waitPeerSession (hub, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (connectionCount(hub) >= 1) return;
    await sleep(200);
  }
  throw new Error('Fabric TCP session did not come up');
}

function buyerRefundPubkeyHex (hub) {
  const k = hub && hub.agent && hub.agent.key;
  if (!k || !k.public || typeof k.public.encodeCompressed !== 'function') {
    throw new Error('buyer hub has no compressed pubkey');
  }
  return String(k.public.encodeCompressed('hex'));
}

function waitInventoryHtlc (buyerHub, docId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let lastSummary = 'no inventoryResponse';
    const timer = setTimeout(() => {
      buyerHub.agent.removeListener('inventoryResponse', onResp);
      reject(new Error(`inventoryResponse with HTLC quote timed out (${lastSummary})`));
    }, timeoutMs);
    function onResp ({ message }) {
      const items = (message && message.object && message.object.items) || [];
      lastSummary = `${items.length} item(s); ids=${items.map((it) => it && it.id).filter(Boolean).join(',') || 'none'}; htlc=${items.some((it) => it && it.htlc && it.htlc.settlementId)}`;
      const hit = items.find((it) => {
        if (!it || !it.htlc || !it.htlc.settlementId) return false;
        const id = String(it.id || it.documentId || '').toLowerCase();
        return id === String(docId).toLowerCase();
      });
      if (!hit) return;
      clearTimeout(timer);
      buyerHub.agent.removeListener('inventoryResponse', onResp);
      resolve(hit.htlc);
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

(RUN ? describe : describe.skip)('Inventory HTLC L1 (two hubs)', function () {
  this.timeout(240000);

  /** @type {import('../services/hub')[]} */
  let hubs = [];
  let fsRoots = [];
  const httpBases = [];
  let fabricPorts = [];
  let btc0 = null;
  let prevDefaultMaxListeners;

  before(async function () {
    if (!bitcoindOnPath()) {
      this.skip();
      return;
    }

    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
    process.env.FABRIC_DOCUMENT_MARKET_ACCUMULATE = '1';
    prevDefaultMaxListeners = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = Math.max(Number(prevDefaultMaxListeners) || 10, 32);

    fabricPorts = [await getFreePort(), await getFreePort()];
    const httpPorts = [await getFreePort(), await getFreePort()];
    const btcP2p0 = await getFreePort();
    const btcRpc0 = await getFreePort();
    const zmq0 = await getFreePort();
    const seeds = [MNEMONIC_A, MNEMONIC_B];

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
            federationRegistryScan: { enable: false }
          },
          beacon: { enable: false },
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

    for (let i = 0; i < 2; i++) {
      const root = path.join(
        __dirname,
        '..',
        'stores',
        `inventory-htlc-e2e-${process.pid}-${Date.now()}-${i}`
      );
      fs.mkdirSync(root, { recursive: true });
      fsRoots.push(root);
      const h = new Hub(makeBase(i, root));
      await h.start();
      hubs.push(h);
      httpBases.push(`http://127.0.0.1:${httpPorts[i]}`);
      await sleep(i === 0 ? 800 : 400);
    }

    // Fresh stores report needsSetup, which defers managed bitcoind until POST /settings.
    for (let i = 0; i < 2; i++) {
      const boot = await httpJson(httpBases[i], 'POST', '/settings', {
        NODE_NAME: `InventoryHtlc-${i}`,
        LIGHTNING_MANAGED: false,
        bitcoinManaged: i === 0,
        BITCOIN_NETWORK: 'regtest',
        BITCOIN_LISTEN: false,
        BITCOIN_TXINDEX: true,
        BITCOIN_TXRELAY: true
      });
      assert.strictEqual(boot.status, 200, boot.raw);
      assert.ok(boot.body && boot.body.token, `admin token hub ${i}`);
    }

    await waitBitcoinHttp(httpBases[0], 120000);
    btc0 = hubs[0]._getBitcoinService();
    assert.ok(btc0, 'seller hub Bitcoin service');
    if (typeof btc0.on === 'function') {
      btc0.on('error', () => {});
    }

    const miningAddr = await btc0.getUnusedAddress();
    for (let g = 0; g < 12; g++) {
      await btc0._makeRPCRequest('generatetoaddress', [10, miningAddr]);
    }

    await rpc(httpBases[0], 'AddPeer', [`127.0.0.1:${fabricPorts[1]}`]);
    await rpc(httpBases[1], 'AddPeer', [`127.0.0.1:${fabricPorts[0]}`]);
    await waitPeerSession(hubs[0]);
    await waitPeerSession(hubs[1]);

    const st = await rpc(httpBases[0], 'GetNetworkStatus', []);
    assert.ok(peerCount(st) >= 1, 'seller should list the buyer Fabric peer');
  });

  after(async function () {
    this.timeout(120000);
    if (prevDefaultMaxListeners != null) {
      EventEmitter.defaultMaxListeners = prevDefaultMaxListeners;
    }
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

  it('sells a sealed document over P2TR inventory HTLC across two hubs', async function () {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const plaintext = `inventory-htlc-e2e ${runId}\n`;
    const contentBase64 = Buffer.from(plaintext, 'utf8').toString('base64');

    const created = await rpc(httpBases[0], 'CreateDocument', [{
      name: `htlc-e2e-${runId}.txt`,
      mime: 'text/plain',
      contentBase64
    }]);
    const docId = created && created.document && created.document.id;
    assert.ok(docId, 'CreateDocument returns id');

    const pub = await rpc(httpBases[0], 'PublishDocument', [{
      id: docId,
      purchasePriceSats: PRICE_SATS
    }]);
    assert.ok(pub && pub.document && pub.document.published, 'PublishDocument sets published');
    assert.strictEqual(Number(pub.document.purchasePriceSats), PRICE_SATS);

    const sellerHeld = await rpc(httpBases[0], 'GetDocument', [{ id: docId }]);
    const sealedB64 = sellerHeld && sellerHeld.document && sellerHeld.document.contentBase64;
    assert.ok(sealedB64, 'seller holds sealed bytes after priced publish');
    assert.notStrictEqual(sealedB64, contentBase64, 'priced publish stores ciphertext, not plaintext');

    const sellerId = hubs[0].agent && hubs[0].agent.identity && hubs[0].agent.identity.id;
    assert.ok(sellerId, 'seller Fabric identity id');

    const buyerHex = buyerRefundPubkeyHex(hubs[1]);
    assert.ok(/^[0-9a-fA-F]{66}$/.test(buyerHex), 'buyer compressed pubkey');

    const htlcWait = waitInventoryHtlc(hubs[1], docId, 45000);
    let req = await rpc(httpBases[1], 'RequestPeerInventory', [
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
    assert.strictEqual(req.status, 'success', req.message || 'RequestPeerInventory');

    const htlc = await htlcWait;
    assert.ok(htlc.settlementId, 'HTLC settlementId');
    assert.ok(htlc.paymentAddress, 'HTLC paymentAddress');
    assert.ok(Number(htlc.amountSats) >= PRICE_SATS, 'HTLC amount covers list price');

    const offers = await rpc(httpBases[1], 'ListDocumentOffers', [{ documentId: docId }]);
    const offerHit = (offers && offers.offers || []).find((row) => row && row.htlc && row.htlc.settlementId);
    assert.ok(offerHit && offerHit.htlc.settlementId === htlc.settlementId, 'offer book keeps compact HTLC quote');
    assert.ok(!offerHit.htlc.preimageHex, 'offer book must not store preimage');

    if (typeof btc0._loadWallet === 'function') {
      await btc0._loadWallet(btc0.walletName);
    }
    const amountBtc = Number(htlc.amountSats) / 1e8;
    let txid;
    if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
      txid = await btc0._makeWalletRequest(
        'sendtoaddress',
        [htlc.paymentAddress, amountBtc],
        btc0.walletName
      );
    } else {
      txid = await btc0._makeRPCRequest('sendtoaddress', [htlc.paymentAddress, amountBtc]);
    }
    assert.ok(txid && String(txid).length === 64, 'HTLC funding txid');

    const miningAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, miningAddr]);
    const fundedAt = Date.now();
    while (Date.now() - fundedAt < 20000) {
      try {
        let walletTx = null;
        if (btc0.walletName && typeof btc0._makeWalletRequest === 'function') {
          walletTx = await btc0._makeWalletRequest('gettransaction', [String(txid).trim()], btc0.walletName);
        } else {
          walletTx = await btc0._makeRPCRequest('gettransaction', [String(txid).trim()]);
        }
        if (walletTx && Number(walletTx.confirmations || 0) >= 1) break;
      } catch (_) {}
      await sleep(250);
    }

    let confirm;
    for (let attempt = 0; attempt < 8; attempt++) {
      confirm = await rpc(httpBases[0], 'ConfirmInventoryHtlcPayment', [{
        settlementId: htlc.settlementId,
        txid: String(txid).trim()
      }]);
      if (confirm && confirm.status === 'success') break;
      await sleep(500);
    }
    assert.ok(confirm && confirm.status === 'success', confirm && confirm.message
      ? `ConfirmInventoryHtlcPayment: ${confirm.message}`
      : 'ConfirmInventoryHtlcPayment success');
    assert.strictEqual(confirm.documentId, docId);
    assert.ok(confirm.keyRevealed, 'seller reports HTLC_KEY_REVEAL sent');

    const delivered = await waitDocumentBytes(httpBases[1], docId, 45000);
    assert.strictEqual(delivered.contentBase64, sealedB64, 'buyer receives seller ciphertext');
    assert.notStrictEqual(delivered.contentBase64, contentBase64, 'buyer store is still sealed');
  });
});
