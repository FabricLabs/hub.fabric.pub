'use strict';

/**
 * North-star integration: **three** managed regtest `bitcoind` instances on one machine.
 * Hub A is the Bitcoin P2P **seed** (`bitcoin.listen: true`); B and C use Core `-addnode`
 * to the seed so chain + blocks + mempools sync over real Bitcoin P2P (not a JS simulation).
 * Fabric TCP peers connect A↔B and A↔C for federation invite/accept/reject, mid-run member,
 * removal, execution registry **L1** payment, contract run, optional anchor, fee samples, and a
 * **cross-hub L1 payment** (A’s wallet → B’s wallet) visible in the UI via `GetBitcoinStatus`.
 *
 *   FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1 FABRIC_PLAYNET_BEACON=1 npm run test:playnet-beacon
 *
 * **Operator mesh (same topology):** `npm run playnet:mesh` — see `scripts/playnet-regtest-mesh-launch.js`.
 *
 * Requires local `bitcoind`. Console noise is reduced via `playnetMaskedConsole`.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const merge = require('lodash.merge');
const Token = require('@fabric/core/types/token');

const Hub = require('../services/hub');
const settings = require('../settings/local');
const { installMaskedConsole } = require('../functions/playnetMaskedConsole');
const {
  signFederationContractPayload,
  verifyFederationContractPayloadSignature
} = require('../functions/federationContractInviteSigned');
const {
  formatTransactionFeeAsciiGraph,
  verifyTxidMatchesRawHex
} = require('../functions/playnetAsciiFeeGraph');

/** Distinct seeds so peer hubs are not identical keys (would make federation add a no-op). */
const MNEMONIC_HUB_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_HUB_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_HUB_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

const runBeacon = process.env.FABRIC_PLAYNET_BEACON === '1' || process.env.FABRIC_PLAYNET_BEACON === 'true';
const playnetReport =
  process.env.FABRIC_PLAYNET_REPORT !== '0' && process.env.FABRIC_PLAYNET_REPORT !== 'false';

const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0'];

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

function sleep (ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  throw new Error('Follower did not reach min chain height (P2P sync timeout?)');
}

/** @returns {number} peer count if at least one outbound connection to seed P2P port is seen */
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

async function waitWalletBalanceBtc (httpBase, minBtc, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await rpc(httpBase, 'GetBitcoinStatus', []);
    const bal = Number(st && st.balance != null ? st.balance : 0);
    if (bal >= minBtc) return bal;
    await sleep(500);
  }
  throw new Error(`Wallet balance on ${httpBase} did not reach ${minBtc} BTC in time`);
}

function hubPubHex (hub) {
  const k = hub._rootKey && hub._rootKey.pubkey;
  if (!k) return '';
  return Buffer.isBuffer(k) ? k.toString('hex') : String(k).trim();
}

function fabricId (hub) {
  return hub.agent && hub.agent.identity && hub.agent.identity.id
    ? String(hub.agent.identity.id)
    : '';
}

(runBeacon ? describe : describe.skip)('Playnet beacon + federation contract (regtest integration)', function () {
  this.timeout(400000);

  let restoreConsole = null;
  let hubA;
  let hubB;
  let hubC;
  const fsRoots = [];
  let httpA;
  let httpB;
  let httpC;
  let tokenA;
  let tokenB;
  let tokenC;
  const allTxids = [];

  before(function () {
    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
    restoreConsole = installMaskedConsole();
  });

  after(function () {
    if (restoreConsole) restoreConsole();
  });

  afterEach(async function () {
    this.timeout(120000);
    for (const h of [hubC, hubB, hubA]) {
      if (!h) continue;
      try {
        await Promise.race([
          h.stop(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 20000))
        ]);
      } catch (_) {}
    }
    hubA = hubB = hubC = null;
    httpA = httpB = httpC = '';
    tokenA = tokenB = tokenC = '';
    for (const p of fsRoots) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (_) {}
    }
    fsRoots.length = 0;
    allTxids.length = 0;
  });

  it('runs federation invite/accept/reject, mid membership, removal, real L1 mesh, fees, signatures', async function () {
    if (process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS && String(process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS).trim()) {
      this.skip();
    }

    const fabricPortA = await getFreePort();
    const fabricPortB = await getFreePort();
    const fabricPortC = await getFreePort();
    const httpPortA = await getFreePort();
    const httpPortB = await getFreePort();
    const httpPortC = await getFreePort();
    const btcP2pA = await getFreePort();
    const btcP2pB = await getFreePort();
    const btcP2pC = await getFreePort();
    const btcRpcA = await getFreePort();
    const btcRpcB = await getFreePort();
    const btcRpcC = await getFreePort();
    const zmqA = await getFreePort();
    const zmqB = await getFreePort();
    const zmqC = await getFreePort();

    const rootA = path.join(__dirname, '..', 'stores', `playnet-beacon-a-${process.pid}-${Date.now()}`);
    const rootB = path.join(__dirname, '..', 'stores', `playnet-beacon-b-${process.pid}-${Date.now()}`);
    const rootC = path.join(__dirname, '..', 'stores', `playnet-beacon-c-${process.pid}-${Date.now()}`);
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.mkdirSync(rootC, { recursive: true });
    fsRoots.push(rootA, rootB, rootC);

    const baseA = merge({}, settings, {
      port: fabricPortA,
      peers: [],
      fs: { path: rootA },
      key: { mnemonic: MNEMONIC_HUB_A },
      bitcoin: {
        enable: true,
        network: 'regtest',
        managed: true,
        listen: true,
        port: btcP2pA,
        rpcport: btcRpcA,
        zmqPort: zmqA,
        datadir: path.join(rootA, 'bitcoin-datadir'),
        p2pAddNodes: [],
        bitcoinExtraParams: ['-dnsseed=0'].concat(extraBtcParams)
      },
      beacon: { enable: true, interval: 4000, regtestOnly: true },
      lightning: { managed: false, stub: true },
      http: { hostname: '127.0.0.1', listen: true, port: httpPortA },
      debug: false
    });
    baseA.peers = [];

    hubA = new Hub(baseA);
    await hubA.start();
    httpA = `http://127.0.0.1:${httpPortA}`;

    const bootA = await httpJson(httpA, 'POST', '/settings', {
      NODE_NAME: 'PlaynetBeaconA',
      LIGHTNING_MANAGED: false,
      bitcoinManaged: true
    });
    assert.strictEqual(bootA.status, 200, bootA.raw);
    tokenA = bootA.body.token;
    assert.ok(tokenA, 'admin token A');
    assert.ok(Token.verifySigned(tokenA, hubA._rootKey), 'admin token verifies against hub A identity');

    await waitBitcoinHttpAvailable(httpA, 120000);

    const btcFund = hubA._getBitcoinService();
    assert.ok(btcFund && btcFund._makeRPCRequest);
    const miningAddr = await btcFund.getUnusedAddress();
    for (let i = 0; i < 15; i++) {
      await btcFund._makeRPCRequest('generatetoaddress', [10, miningAddr]);
    }
    const heightAfterMine = await btcFund._makeRPCRequest('getblockcount', []);

    const pkA = hubPubHex(hubA);
    assert.ok(pkA.length >= 64);
    await rpc(httpA, 'SetDistributedFederationPolicy', [{
      adminToken: tokenA,
      validators: [pkA],
      threshold: 1
    }]);

    const baseB = merge({}, settings, {
      port: fabricPortB,
      peers: [],
      fs: { path: rootB },
      key: { mnemonic: MNEMONIC_HUB_B },
      bitcoin: {
        enable: true,
        network: 'regtest',
        managed: true,
        listen: false,
        port: btcP2pB,
        rpcport: btcRpcB,
        zmqPort: zmqB,
        datadir: path.join(rootB, 'bitcoin-datadir'),
        p2pAddNodes: [],
        bitcoinExtraParams: ['-dnsseed=0', `-addnode=127.0.0.1:${btcP2pA}`].concat(extraBtcParams)
      },
      beacon: { enable: false },
      lightning: { managed: false, stub: true },
      http: { hostname: '127.0.0.1', listen: true, port: httpPortB },
      debug: false
    });
    baseB.peers = [];
    hubB = new Hub(baseB);
    await hubB.start();
    httpB = `http://127.0.0.1:${httpPortB}`;
    await waitBitcoinHttpAvailable(httpB, 120000);
    const btcB = hubB._getBitcoinService();
    assert.ok(btcB);
    await waitChainSyncAtLeast(btcB, heightAfterMine, 120000);
    const peerCountB = await waitOutboundBtcPeer(btcB, btcP2pA, 90000);
    assert.ok(peerCountB > 0, 'Hub B bitcoind should have an outbound P2P peer to the seed');

    const bootB = await httpJson(httpB, 'POST', '/settings', { NODE_NAME: 'PlaynetBeaconB', LIGHTNING_MANAGED: false, bitcoinManaged: true });
    assert.strictEqual(bootB.status, 200, bootB.raw);
    tokenB = bootB.body.token;
    assert.ok(Token.verifySigned(tokenB, hubB._rootKey));

    const baseC = merge({}, settings, {
      port: fabricPortC,
      peers: [],
      fs: { path: rootC },
      key: { mnemonic: MNEMONIC_HUB_C },
      bitcoin: {
        enable: true,
        network: 'regtest',
        managed: true,
        listen: false,
        port: btcP2pC,
        rpcport: btcRpcC,
        zmqPort: zmqC,
        datadir: path.join(rootC, 'bitcoin-datadir'),
        p2pAddNodes: [],
        bitcoinExtraParams: ['-dnsseed=0', `-addnode=127.0.0.1:${btcP2pA}`].concat(extraBtcParams)
      },
      beacon: { enable: false },
      lightning: { managed: false, stub: true },
      http: { hostname: '127.0.0.1', listen: true, port: httpPortC },
      debug: false
    });
    baseC.peers = [];
    hubC = new Hub(baseC);
    await hubC.start();
    httpC = `http://127.0.0.1:${httpPortC}`;
    await waitBitcoinHttpAvailable(httpC, 120000);
    const btcC = hubC._getBitcoinService();
    assert.ok(btcC);
    await waitChainSyncAtLeast(btcC, heightAfterMine, 120000);
    const peerCountC = await waitOutboundBtcPeer(btcC, btcP2pA, 90000);
    assert.ok(peerCountC > 0, 'Hub C bitcoind should have an outbound P2P peer to the seed');

    const bootC = await httpJson(httpC, 'POST', '/settings', { NODE_NAME: 'PlaynetBeaconC', LIGHTNING_MANAGED: false, bitcoinManaged: true });
    assert.strictEqual(bootC.status, 200);
    tokenC = bootC.body.token;
    assert.ok(Token.verifySigned(tokenC, hubC._rootKey));

    const heightA = await btcFund._makeRPCRequest('getblockcount', []);
    const heightB = await btcB._makeRPCRequest('getblockcount', []);
    const heightC = await btcC._makeRPCRequest('getblockcount', []);
    assert.strictEqual(heightB, heightA, 'B should match seed chain height');
    assert.strictEqual(heightC, heightA, 'C should match seed chain height');

    await rpc(httpA, 'AddPeer', [`127.0.0.1:${fabricPortB}`]);
    await rpc(httpB, 'AddPeer', [`127.0.0.1:${fabricPortA}`]);
    await sleep(2500);

    const pkB = hubPubHex(hubB);
    const fabA = fabricId(hubA);
    const fabB = fabricId(hubB);
    assert.ok(fabA && fabB);

    const invReject = await rpc(httpA, 'InvitePeerToFederationContract', [{
      adminToken: tokenA,
      peerId: fabB,
      contractId: 'beacon-federation-playnet',
      note: 'synthetic reject path'
    }]);
    assert.strictEqual(invReject.status, 'success');
    const signedMirror = signFederationContractPayload({
      type: 'FederationContractInvite',
      v: 1,
      inviteId: invReject.inviteId,
      inviterHubId: fabA,
      contractId: 'beacon-federation-playnet',
      note: 'synthetic reject path',
      invitedAt: Date.now()
    }, hubA._rootKey);
    assert.strictEqual(verifyFederationContractPayloadSignature(signedMirror).ok, true);

    const decline = signFederationContractPayload({
      type: 'FederationContractInviteResponse',
      v: 1,
      inviteId: invReject.inviteId,
      accept: false,
      responderPubkey: pkB,
      respondedAt: Date.now()
    }, hubB._rootKey);
    assert.strictEqual(verifyFederationContractPayloadSignature(decline).ok, true);
    await rpc(httpB, 'SendPeerMessage', [{ id: fabA }, { content: JSON.stringify(decline), actor: { id: fabB } }]);

    const invAccept = await rpc(httpA, 'InvitePeerToFederationContract', [{
      adminToken: tokenA,
      peerId: fabB,
      contractId: 'beacon-federation-playnet',
      note: 'accept path'
    }]);
    const accept = signFederationContractPayload({
      type: 'FederationContractInviteResponse',
      v: 1,
      inviteId: invAccept.inviteId,
      accept: true,
      responderPubkey: pkB,
      respondedAt: Date.now()
    }, hubB._rootKey);
    assert.strictEqual(verifyFederationContractPayloadSignature(accept).ok, true);
    await rpc(httpB, 'SendPeerMessage', [{ id: fabA }, { content: JSON.stringify(accept), actor: { id: fabB } }]);

    const addB = await rpc(httpA, 'AddDistributedFederationMember', [{ adminToken: tokenA, pubkey: pkB }]);
    assert.strictEqual(addB.status, 'success');
    assert.ok(addB.validators && addB.validators.includes(pkB));

    const polMid = await rpc(httpA, 'GetDistributedFederationPolicy', []);
    assert.strictEqual(polMid.validators.length, 2);

    await rpc(httpC, 'AddPeer', [`127.0.0.1:${fabricPortA}`]);
    await rpc(httpA, 'AddPeer', [`127.0.0.1:${fabricPortC}`]);
    await sleep(2000);
    const pkC = hubPubHex(hubC);
    const fabC = fabricId(hubC);
    const invC = await rpc(httpA, 'InvitePeerToFederationContract', [{
      adminToken: tokenA,
      peerId: fabC,
      contractId: 'beacon-federation-playnet',
      note: 'mid-stream member'
    }]);
    const acceptC = signFederationContractPayload({
      type: 'FederationContractInviteResponse',
      v: 1,
      inviteId: invC.inviteId,
      accept: true,
      responderPubkey: pkC,
      respondedAt: Date.now()
    }, hubC._rootKey);
    assert.strictEqual(verifyFederationContractPayloadSignature(acceptC).ok, true);
    await rpc(httpC, 'SendPeerMessage', [{ id: fabA }, { content: JSON.stringify(acceptC), actor: { id: fabC } }]);
    await rpc(httpA, 'AddDistributedFederationMember', [{ adminToken: tokenA, pubkey: pkC }]);
    const polThree = await rpc(httpA, 'GetDistributedFederationPolicy', []);
    assert.strictEqual(polThree.validators.length, 3);

    await rpc(httpA, 'SetDistributedFederationPolicy', [{
      adminToken: tokenA,
      validators: [pkA, pkB],
      threshold: 2
    }]);
    const polTrim = await rpc(httpA, 'GetDistributedFederationPolicy', []);
    assert.strictEqual(polTrim.validators.length, 2);
    assert.ok(!polTrim.validators.includes(pkC));

    const program = {
      version: 1,
      steps: [
        { op: 'FabricOpcode', fabricType: 'ChatMessage' },
        { op: 'Push', value: { playnetBeacon: true } }
      ]
    };
    const regInv = await rpc(httpA, 'CreateExecutionRegistryInvoice', [{
      program,
      amountSats: 2000,
      name: 'playnet-beacon-exec'
    }]);
    assert.strictEqual(regInv.type, 'CreateExecutionRegistryInvoiceResult');
    let regTxid;
    const payReg = await httpJson(httpA, 'POST', '/services/bitcoin', {
      method: 'sendpayment',
      adminToken: tokenA,
      to: regInv.address,
      amountSats: regInv.amountSats
    });
    if (payReg.status === 200 && payReg.body && payReg.body.payment && payReg.body.payment.txid) {
      regTxid = payReg.body.payment.txid;
    } else {
      await btcFund._loadWallet(btcFund.walletName);
      regTxid = await btcFund._makeWalletRequest(
        'sendtoaddress',
        [regInv.address, regInv.amountSats / 1e8],
        btcFund.walletName
      );
      assert.ok(regTxid && typeof regTxid === 'string', `registry pay failed: ${payReg.raw}`);
    }
    allTxids.push(regTxid);
    await httpBearer(httpA, 'POST', '/services/bitcoin/blocks', { count: 1 }, tokenA);

    const created = await rpc(httpA, 'CreateExecutionContract', [{
      name: 'playnet-beacon-exec',
      program,
      programDigest: regInv.programDigest,
      txid: regTxid
    }]);
    assert.strictEqual(created.type, 'CreateExecutionContractResult');
    const run = await rpc(httpA, 'RunExecutionContract', [{ contractId: created.id }]);
    assert.strictEqual(run.ok, true);
    try {
      const anchor = await rpc(httpA, 'AnchorExecutionRunCommitment', [{
        adminToken: tokenA,
        commitmentHex: run.runCommitmentHex
      }]);
      assert.strictEqual(anchor.type, 'AnchorExecutionRunCommitmentResult');
      assert.ok(anchor.txid);
      allTxids.push(anchor.txid);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!/Fee exceeds maximum|maxfeerate|maxtxfee/i.test(msg)) throw e;
    }

    const addrBRes = await httpJson(httpB, 'POST', '/services/bitcoin', { method: 'getwalletaddress' });
    const toB = addrBRes.body && addrBRes.body.address;
    assert.ok(toB);
    const crossSats = 350_000;
    const payCross = await httpJson(httpA, 'POST', '/services/bitcoin', {
      method: 'sendpayment',
      adminToken: tokenA,
      to: toB,
      amountSats: crossSats
    });
    let crossTxid;
    if (payCross.status === 200 && payCross.body && payCross.body.payment && payCross.body.payment.txid) {
      crossTxid = payCross.body.payment.txid;
    } else {
      await btcFund._loadWallet(btcFund.walletName);
      crossTxid = await btcFund._makeWalletRequest(
        'sendtoaddress',
        [toB, crossSats / 1e8],
        btcFund.walletName
      );
      assert.ok(crossTxid && typeof crossTxid === 'string', `cross pay failed: ${payCross.raw}`);
    }
    allTxids.push(crossTxid);
    await httpBearer(httpA, 'POST', '/services/bitcoin/blocks', { count: 1 }, tokenA);
    await waitChainSyncAtLeast(btcB, heightA + 2, 120000);

    const minExpectBtc = (crossSats / 1e8) * 0.99;
    const balanceB = await waitWalletBalanceBtc(httpB, minExpectBtc, 90000);

    await btcFund._loadWallet(btcFund.walletName);
    const feeRatesBtcPerKb = [0.00002, 0.00006, 0.00003, 0.00009, 0.00004];
    const feePoints = [];
    for (const fr of feeRatesBtcPerKb) {
      const satPerVb = Math.max(1, Math.round((fr * 1e8) / 1000));
      const addrRes = await httpJson(httpA, 'POST', '/services/bitcoin', { method: 'getwalletaddress' });
      const to = addrRes.body && addrRes.body.address;
      assert.ok(to);
      const txid = await btcFund._makeWalletRequest(
        'sendtoaddress',
        [
          to,
          200_000 / 1e8,
          'playnet fee sample',
          '',
          false,
          false,
          null,
          'unset',
          false,
          satPerVb
        ],
        btcFund.walletName
      );
      assert.ok(txid && typeof txid === 'string', 'fee sample sendtoaddress failed');
      allTxids.push(txid);
      await httpBearer(httpA, 'POST', '/services/bitcoin/blocks', { count: 1 }, tokenA);
      const gt = await btcFund._makeWalletRequest('gettransaction', [txid, true], btcFund.walletName);
      const raw = await btcFund._makeRPCRequest('getrawtransaction', [txid, true]);
      assert.ok(verifyTxidMatchesRawHex(txid, raw.hex), 'txid must match double-SHA256 of raw hex');
      const feeBtc = Math.abs(Number(gt.fee != null ? gt.fee : 0));
      const feeSats = Math.round(feeBtc * 1e8);
      const vsize = Number(raw.vsize || raw.size || 1);
      const ssize = Number(raw.size || vsize || 1);
      feePoints.push({
        satPerVbyte: feeSats / vsize,
        satPerByte: feeSats / ssize
      });
    }

    await sleep(4500);

    const heightFinalA = await btcFund._makeRPCRequest('getblockcount', []);
    const heightFinalB = await btcB._makeRPCRequest('getblockcount', []);
    const heightFinalC = await btcC._makeRPCRequest('getblockcount', []);
    assert.strictEqual(heightFinalB, heightFinalA);
    assert.strictEqual(heightFinalC, heightFinalA);

    if (playnetReport) {
      const lines = [];
      lines.push('\n======== PLAYNET BEACON + FEDERATION — REPORT ========');
      lines.push('Bitcoin: 3× managed regtest; A P2P listen; B/C `-addnode` seed (real Core P2P + blocks + mempool sync).');
      lines.push('Federation: invite → signed decline → invite → signed accept → AddMember(B);');
      lines.push('mid-stream C accept → AddMember(C); policy trim removes C.');
      lines.push(`L1 heights (A/B/C): ${heightFinalA} / ${heightFinalB} / ${heightFinalC}`);
      lines.push(`Bitcoin P2P: B peers=${peerCountB}, C peers=${peerCountC} (outbound to seed :${btcP2pA})`);
      lines.push(`Revenue (real L1): protocol registry invoice ${regInv.amountSats} sats (tx ${regTxid}); user/host leg A→B ${crossSats} sats (B wallet ~${balanceB.toFixed(8)} BTC).`);
      lines.push('Signatures verified: admin Token (Schnorr), invite/response JSON, txid vs raw hex.');
      lines.push('--- Transaction IDs (this run) ---');
      for (const t of allTxids) lines.push(`  ${t}`);
      lines.push('--- Wallet spend fee density (regtest, per-tx fee_rate sat/vB) ---');
      lines.push(formatTransactionFeeAsciiGraph(feePoints));
      lines.push('UI: open each hub HTTP base → Bitcoin tab: same height; hub B shows received balance after cross payment.');
      lines.push('Operator script: npm run playnet:mesh (see scripts/playnet-regtest-mesh-launch.js).');
      lines.push('======================================================\n');
      console.log(lines.join('\n'));
    }
  });
});
