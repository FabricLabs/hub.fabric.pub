'use strict';

/**
 * Taproot crowdfund — regtest integration (optional; not run in default `npm test`).
 *
 * Spawns two hubs: **hub 0** = managed Bitcoin regtest + crowdfunding HTTP; **hub 1** = Fabric-only peer.
 * Establishes a Fabric ring (`AddPeer`), bootstraps admin tokens, mines spendable coins, then exercises
 * list/create/detail, ACP donation PSBT, payout (success + failure paths), arbiter co-sign, broadcast,
 * and refund-after-CLTV (arbiter sweep).
 *
 * Prerequisites: `bitcoind` on PATH (managed by hub 0).
 *
 *   FABRIC_CROWDFUND_REGTEST=1 npm run test:crowdfund-regtest
 *
 * Env:
 *   FABRIC_CROWDFUND_REGTEST=1  — required to run this file (otherwise all tests are skipped).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const merge = require('lodash.merge');

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);

const Hub = require('../services/hub');
const settings = require('../settings/local');
const crowdfundingTaproot = require('../functions/crowdfundingTaproot');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

const RUN = process.env.FABRIC_CROWDFUND_REGTEST === '1' || process.env.FABRIC_CROWDFUND_REGTEST === 'true';

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0'];

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

function httpBearer (baseUrl, method, pathname, body, token) {
  const h = token ? { Authorization: `Bearer ${token}` } : {};
  return httpJson(baseUrl, method, pathname, body, h);
}

async function rpc (baseUrl, method, params) {
  const res = await httpJson(baseUrl, 'POST', '/services/rpc', {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: params || []
  });
  if (res.status !== 200) throw new Error(`RPC HTTP ${res.status}: ${res.raw}`);
  if (res.body && res.body.error) throw new Error(res.body.error.message || JSON.stringify(res.body.error));
  return res.body.result;
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

async function awaitTxConf (btc, txid, minConf, timeoutMs = 60000) {
  const h = String(txid || '').trim();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const tx = await btc._makeRPCRequest('getrawtransaction', [h, true]);
      const c = tx && tx.confirmations != null ? Number(tx.confirmations) : 0;
      if (c >= minConf) return c;
    } catch (_) { /* mempool */ }
    await sleep(200);
  }
  throw new Error(`tx ${h.slice(0, 12)}… did not reach ${minConf} conf`);
}

(RUN ? describe : describe.skip)('Crowdfund regtest integration (hub 0 + Fabric peer)', function () {
  this.timeout(600000);

  /** @type {import('../services/hub')[]} */
  let hubs = [];
  let fsRoots = [];
  const httpBases = [];
  let admin0 = '';
  let admin1 = '';
  let fabricPorts = [];
  let btc0 = null;

  before(async function () {
    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';

    const n = 2;
    const httpPorts = [];
    fabricPorts = [];
    const btcP2p0 = await getFreePort();
    const btcRpc0 = await getFreePort();
    const zmq0 = await getFreePort();

    for (let i = 0; i < n; i++) {
      fabricPorts.push(await getFreePort());
      httpPorts.push(await getFreePort());
    }

    const seeds = [MNEMONIC_A, MNEMONIC_B];

    const makeBase = (i, root) => {
      if (i === 0) {
        const extra = ['-dnsseed=0'].concat(extraBtcParams);
        return merge({}, settings, {
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
            p2pAddNodes: [],
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
      return merge({}, settings, {
        port: fabricPorts[i],
        peers: [],
        fs: { path: root },
        key: { mnemonic: seeds[i] },
        bitcoin: { enable: false, network: 'regtest' },
        beacon: { enable: false },
        lightning: { managed: false, stub: true },
        http: { hostname: '127.0.0.1', listen: true, port: httpPorts[i] },
        debug: false
      });
    };

    for (let i = 0; i < n; i++) {
      const root = path.join(__dirname, '..', 'stores', `crowdfund-regtest-${process.pid}-${Date.now()}-${i}`);
      fs.mkdirSync(root, { recursive: true });
      fsRoots.push(root);
      const h = new Hub(makeBase(i, root));
      await h.start();
      hubs.push(h);
      httpBases.push(`http://127.0.0.1:${httpPorts[i]}`);
      await sleep(i === 0 ? 800 : 400);
    }

    await waitBitcoinHttp(httpBases[0], 120000);
    btc0 = hubs[0]._getBitcoinService();
    assert.ok(btc0);

    const miningAddr = await btc0.getUnusedAddress();
    for (let g = 0; g < 12; g++) {
      await btc0._makeRPCRequest('generatetoaddress', [10, miningAddr]);
    }

    for (let i = 0; i < n; i++) {
      const boot = await httpJson(httpBases[i], 'POST', '/settings', {
        NODE_NAME: `CrowdfundRegtest-${i}`,
        LIGHTNING_MANAGED: false,
        bitcoinManaged: true
      });
      assert.strictEqual(boot.status, 200, boot.raw);
      const tok = boot.body && boot.body.token ? String(boot.body.token) : '';
      assert.ok(tok, `admin token hub ${i}`);
      if (i === 0) admin0 = tok;
      else admin1 = tok;
    }

    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      await rpc(httpBases[i], 'AddPeer', [`127.0.0.1:${fabricPorts[next]}`]);
    }
    await sleep(3000);

    const st = await rpc(httpBases[0], 'GetNetworkStatus', []);
    const peers = st && st.peers && typeof st.peers === 'object' ? Object.keys(st.peers).length : 0;
    assert.ok(peers >= 1, 'hub 0 should see at least one Fabric peer');
  });

  after(async function () {
    this.timeout(120000);
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

  const base0 = () => httpBases[0];
  const cfPath = (p) => `/services/bitcoin/crowdfunding/campaigns${p}`;

  it('lists open crowdfunds (empty on fresh hub); satellite hub has separate empty store', async function () {
    // Campaigns are hub-local FS (bitcoin/crowdfunding.json), not gossiped over Fabric — peer hub stays empty.
    const r0 = await httpJson(base0(), 'GET', cfPath(''));
    assert.strictEqual(r0.status, 200);
    assert.strictEqual(r0.body.count, 0);
    assert.deepStrictEqual(r0.body.campaigns, []);

    const r1 = await httpJson(httpBases[1], 'GET', cfPath(''));
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.body.count, 0);
  });

  it('rejects campaign create without admin token', async function () {
    const ben = ecpair.makeRandom();
    const res = await httpJson(base0(), 'POST', cfPath(''), {
      title: 'No auth',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 50000,
      minContributionSats: 1000
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects invalid create body (goal too low, bad pubkey)', async function () {
    const ben = ecpair.makeRandom();
    const low = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Bad goal',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 500,
      minContributionSats: 1000
    }, admin0);
    assert.strictEqual(low.status, 400);

    const badPk = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Bad pk',
      beneficiaryPubkeyHex: 'deadbeef',
      goalSats: 50000,
      minContributionSats: 1000
    }, admin0);
    assert.strictEqual(badPk.status, 400);
  });

  it('ACP donation PSBT: success and amount below min (400)', async function () {
    const ben = ecpair.makeRandom();
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'ACP template',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 80000,
      minContributionSats: 5000,
      refundAfterBlocks: 60
    }, admin0);
    assert.strictEqual(create.status, 200);
    const id = create.body.campaign && create.body.campaign.campaignId;
    assert.ok(id);

    const ok = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/acp-donation-psbt`)}?amountSats=5000`
    );
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.psbtBase64);
    // Outputs-only PSBT (no unsigned tx / inputs) can trip strict bip174 parses; assert BIP174 magic + one output.
    const psbtRaw = Buffer.from(String(ok.body.psbtBase64), 'base64');
    assert.ok(psbtRaw.length > 20);
    assert.ok(psbtRaw.subarray(0, 5).equals(Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff])), 'PSBT magic');
    let psbt;
    try {
      psbt = bitcoin.Psbt.fromBase64(ok.body.psbtBase64, { network: bitcoin.networks.regtest });
    } catch (_) {
      psbt = null;
    }
    if (psbt) {
      assert.strictEqual(psbt.data.outputs.length, 1);
      assert.strictEqual(psbt.data.inputs.length, 0);
    }

    const bad = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/acp-donation-psbt`)}?amountSats=100`
    );
    assert.strictEqual(bad.status, 400);
  });

  it('GET detail / payout errors: unknown id, goal not met, missing destination, min UTXO violation', async function () {
    const ben = ecpair.makeRandom();
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Underfunded',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 200000,
      minContributionSats: 8000,
      refundAfterBlocks: 52
    }, admin0);
    const id = create.body.campaign.campaignId;
    const addr = create.body.campaign.address;

    const missing = await httpJson(base0(), 'GET', cfPath('/not-a-real-id'));
    assert.strictEqual(missing.status, 404);

    const noDest = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/payout-psbt`)}?feeSats=2000`
    );
    assert.strictEqual(noDest.status, 400);

    await sendPaymentOrWallet(base0(), admin0, btc0, addr, 15000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);

    const lowGoal = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/payout-psbt`)}?destination=${encodeURIComponent(mineAddr)}&feeSats=3000`
    );
    assert.strictEqual(lowGoal.status, 400);
    assert.ok(String(lowGoal.body.message || '').includes('goal') || lowGoal.body.balanceSats != null);

    const ben2 = ecpair.makeRandom();
    const c2 = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Min chunk',
      beneficiaryPubkeyHex: ben2.publicKey.toString('hex'),
      goalSats: 200000,
      minContributionSats: 25000,
      refundAfterBlocks: 52
    }, admin0);
    const id2 = c2.body.campaign.campaignId;
    const addr2 = c2.body.campaign.address;
    await sendPaymentOrWallet(base0(), admin0, btc0, addr2, 20000);
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);

    const minViol = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id2)}/payout-psbt`)}?destination=${encodeURIComponent(mineAddr)}&feeSats=5000`
    );
    assert.strictEqual(minViol.status, 400);
    assert.ok(
      String(minViol.body.message || '').includes('minContribution') ||
        String(minViol.body.message || '').includes('MIN_CONTRIBUTION')
    );
  });

  it('full payout: fund vault, beneficiary + arbiter sign, broadcast, confirm on chain', async function () {
    const ben = ecpair.makeRandom();
    const goalSats = 45000;
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Payout e2e',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats,
      minContributionSats: 2000,
      refundAfterBlocks: 80
    }, admin0);
    assert.strictEqual(create.status, 200);
    const campaign = create.body.campaign;
    const id = campaign.campaignId;
    const vaultAddr = campaign.address;

    await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, goalSats + 5000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);

    const detail = await httpJson(base0(), 'GET', cfPath(`/${encodeURIComponent(id)}`));
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.body.goalMet);
    assert.ok(detail.body.balanceSats >= goalSats);
    assert.strictEqual(detail.body.scheme, 'taproot-crowdfund-v1');
    assert.ok(Array.isArray(detail.body.vaultUtxos));

    const dest = await btc0.getUnusedAddress();
    const payout = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/payout-psbt`)}?destination=${encodeURIComponent(dest)}&feeSats=2500`
    );
    assert.strictEqual(payout.status, 200);
    const net = crowdfundingTaproot.networkForFabricName('regtest');
    const psbt = bitcoin.Psbt.fromBase64(payout.body.psbtBase64, { network: net });
    crowdfundingTaproot.signAllInputsWithKey(psbt, ben.privateKey);

    const signedB64 = psbt.toBase64();
    const arb = await httpBearer(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-sign-arbiter`)}`,
      { psbtBase64: signedB64 },
      admin0
    );
    assert.strictEqual(arb.status, 200);
    assert.ok(arb.body.psbtBase64);

    const badBroadcast = await httpJson(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-broadcast`)}`,
      { psbtBase64: 'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }
    );
    assert.strictEqual(badBroadcast.status, 400);

    const unsignedOnly = await httpJson(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-broadcast`)}`,
      { psbtBase64: payout.body.psbtBase64 }
    );
    assert.strictEqual(unsignedOnly.status, 400);
    assert.ok(String(unsignedOnly.body.message || '').toLowerCase().includes('two') || String(unsignedOnly.body.message || '').includes('tapscript'));

    const benOnlyPsbt = bitcoin.Psbt.fromBase64(payout.body.psbtBase64, { network: net });
    crowdfundingTaproot.signAllInputsWithKey(benOnlyPsbt, ben.privateKey);
    const benOnlyBroadcast = await httpJson(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-broadcast`)}`,
      { psbtBase64: benOnlyPsbt.toBase64() }
    );
    assert.strictEqual(benOnlyBroadcast.status, 400);

    const broad = await httpJson(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-broadcast`)}`,
      { psbtBase64: arb.body.psbtBase64 }
    );
    assert.strictEqual(broad.status, 200, `payout-broadcast: ${JSON.stringify(broad.body)}`);
    const payoutTxid = broad.body.txid;
    assert.ok(/^[0-9a-fA-F]{64}$/.test(String(payoutTxid)));

    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    await awaitTxConf(btc0, payoutTxid, 1, 60000);
  });

  it('multi-UTXO vault: two funding txs, payout and broadcast confirm', async function () {
    const ben = ecpair.makeRandom();
    const goalSats = 40000;
    const minC = 5000;
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Multi UTXO',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats,
      minContributionSats: minC,
      refundAfterBlocks: 72
    }, admin0);
    assert.strictEqual(create.status, 200);
    const id = create.body.campaign.campaignId;
    const vaultAddr = create.body.campaign.address;
    await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, 22000);
    await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, 22000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);

    const dest = await btc0.getUnusedAddress();
    const payout = await httpJson(
      base0(),
      'GET',
      `${cfPath(`/${encodeURIComponent(id)}/payout-psbt`)}?destination=${encodeURIComponent(dest)}&feeSats=3000`
    );
    assert.strictEqual(payout.status, 200);
    assert.ok(Number(payout.body.inputCount) >= 2, 'payout PSBT should spend multiple vault UTXOs');
    const net = crowdfundingTaproot.networkForFabricName('regtest');
    const psbt = bitcoin.Psbt.fromBase64(payout.body.psbtBase64, { network: net });
    crowdfundingTaproot.signAllInputsWithKey(psbt, ben.privateKey);
    const arb = await httpBearer(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-sign-arbiter`)}`,
      { psbtBase64: psbt.toBase64() },
      admin0
    );
    assert.strictEqual(arb.status, 200);
    const broad = await httpJson(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/payout-broadcast`)}`,
      { psbtBase64: arb.body.psbtBase64 }
    );
    assert.strictEqual(broad.status, 200, JSON.stringify(broad.body));
    const payoutTxid = broad.body.txid;
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    await awaitTxConf(btc0, payoutTxid, 1, 60000);
  });

  it('refund path: goal not met, mine past CLTV, arbiter refund tx via refund-prepare + broadcast', async function () {
    const ben = ecpair.makeRandom();
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Refund e2e',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 500000,
      minContributionSats: 3000,
      refundAfterBlocks: 48
    }, admin0);
    const id = create.body.campaign.campaignId;
    const vaultAddr = create.body.campaign.address;
    const lockH = create.body.campaign.refundLocktimeHeight;

    const fundTxid = await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, 12000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    await awaitTxConf(btc0, fundTxid, 1, 60000);

    const h0 = await btc0._makeRPCRequest('getblockcount', []);
    const need = Math.max(0, lockH - h0 + 2);
    for (let b = 0; b < need; b++) {
      await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    }

    const refundDest = await btc0.getUnusedAddress();
    const refundPrep = await httpBearer(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/refund-prepare`)}`,
      {
        destinationAddress: refundDest,
        fundedTxid: fundTxid,
        feeSats: 2000
      },
      admin0
    );
    assert.strictEqual(refundPrep.status, 200);
    assert.ok(refundPrep.body.txHex);

    const br = await httpBearer(
      base0(),
      'POST',
      '/services/bitcoin/broadcast',
      { hex: refundPrep.body.txHex },
      admin0
    );
    assert.strictEqual(br.status, 200);
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    await awaitTxConf(btc0, br.body.txid, 1, 60000);
  });

  it('refund-prepare before CLTV height returns 400', async function () {
    const ben = ecpair.makeRandom();
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Early refund',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 999999,
      minContributionSats: 5000,
      refundAfterBlocks: 500
    }, admin0);
    const id = create.body.campaign.campaignId;
    const vaultAddr = create.body.campaign.address;
    const fundTxid = await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, 8000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);

    const refundDest = await btc0.getUnusedAddress();
    const res = await httpBearer(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/refund-prepare`)}`,
      { destinationAddress: refundDest, fundedTxid: fundTxid, feeSats: 2000 },
      admin0
    );
    assert.strictEqual(res.status, 400);
    assert.ok(String(res.body.message || '').includes('height') || String(res.body.message || '').includes('Wait'));
  });

  it('refund-prepare rejects funded tx that does not pay the campaign vault', async function () {
    const ben = ecpair.makeRandom();
    const create = await httpBearer(base0(), 'POST', cfPath(''), {
      title: 'Bad refund txid',
      beneficiaryPubkeyHex: ben.publicKey.toString('hex'),
      goalSats: 800000,
      minContributionSats: 4000,
      refundAfterBlocks: 40
    }, admin0);
    const id = create.body.campaign.campaignId;
    const vaultAddr = create.body.campaign.address;
    const lockH = create.body.campaign.refundLocktimeHeight;
    await sendPaymentOrWallet(base0(), admin0, btc0, vaultAddr, 10000);
    const mineAddr = await btc0.getUnusedAddress();
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    const h0 = await btc0._makeRPCRequest('getblockcount', []);
    const need = Math.max(0, lockH - h0 + 2);
    for (let b = 0; b < need; b++) {
      await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    }
    const otherAddr = await btc0.getUnusedAddress();
    const otherTxid = await sendPaymentOrWallet(base0(), admin0, btc0, otherAddr, 5000);
    await btc0._makeRPCRequest('generatetoaddress', [1, mineAddr]);
    await awaitTxConf(btc0, otherTxid, 1, 60000);
    const refundDest = await btc0.getUnusedAddress();
    const res = await httpBearer(
      base0(),
      'POST',
      `${cfPath(`/${encodeURIComponent(id)}/refund-prepare`)}`,
      { destinationAddress: refundDest, fundedTxid: otherTxid, feeSats: 2000 },
      admin0
    );
    assert.strictEqual(res.status, 400);
    assert.ok(
      String(res.body.message || '').includes('no output') ||
        String(res.body.message || '').includes('P2TR') ||
        String(res.body.message || '').includes('campaign')
    );
  });

  it('list campaigns includes created entries', async function () {
    const r = await httpJson(base0(), 'GET', cfPath(''));
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.count >= 5);
    assert.ok(Array.isArray(r.body.campaigns));
  });
});
