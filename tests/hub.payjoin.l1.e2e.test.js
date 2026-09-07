'use strict';

/**
 * Payjoin deposit session on L1 (optional; not run in default `npm test`).
 *
 * Isolated managed regtest Hub: POST /settings starts bitcoind, miner wallet
 * funds a Hub-allocated Payjoin deposit address, L1 verify sees the output,
 * then a BIP78-shaped proposal is accepted on that session.
 *
 * Session/proposal-only (no coins) remains `npm run test:e2e-payjoin` /
 * `ci:e2e-payjoin` (Bitcoin off).
 *
 * Prerequisites: `bitcoind` on PATH.
 *
 *   npm run test:e2e-payjoin-l1
 *
 * Env:
 *   FABRIC_PAYJOIN_L1_E2E=1  — required to run (otherwise skipped).
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

const RUN = process.env.FABRIC_PAYJOIN_L1_E2E === '1'
  || process.env.FABRIC_PAYJOIN_L1_E2E === 'true';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const extraBtcParams = ['-maxtxfee=10', '-incrementalrelayfee=0'];
const AMOUNT_SATS = 25000;

/** Minimal PSBT accepted by Hub proposal ingest (same fixture as verify-payjoin-e2e.js). */
const DEMO_PSBT =
  'cHNidP8BAHECAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AQAAAAAAAAAAIgAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

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

function bearer (token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
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

async function waitPayjoinHttp (httpBase, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await httpJson(httpBase, 'GET', '/services/payjoin');
    if (st.status === 200 && st.body && st.body.available) return st.body;
    await sleep(300);
  }
  throw new Error(`Payjoin not available on ${httpBase}`);
}

(RUN ? describe : describe.skip)('Payjoin L1 (managed regtest)', function () {
  this.timeout(240000);

  /** @type {import('../services/hub')} */
  let hub = null;
  let fsRoot = '';
  let httpBase = '';
  let adminToken = '';
  let btc = null;
  let prevDefaultMaxListeners;

  before(async function () {
    if (!bitcoindOnPath()) {
      this.skip();
      return;
    }

    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
    prevDefaultMaxListeners = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = Math.max(Number(prevDefaultMaxListeners) || 10, 32);

    const fabricPort = await getFreePort();
    const httpPort = await getFreePort();
    const btcP2p = await getFreePort();
    const btcRpc = await getFreePort();
    const zmq = await getFreePort();

    fsRoot = path.join(
      __dirname,
      '..',
      'stores',
      `payjoin-l1-e2e-${process.pid}-${Date.now()}`
    );
    fs.mkdirSync(fsRoot, { recursive: true });

    hub = new Hub(hubSettingsMerge(settings, {
      port: fabricPort,
      peers: [],
      fs: { path: fsRoot },
      key: { mnemonic: MNEMONIC, seed: null },
      bitcoin: {
        enable: true,
        network: 'regtest',
        managed: true,
        listen: false,
        enforceIsolatedRegtest: true,
        port: btcP2p,
        rpcport: btcRpc,
        zmqPort: zmq,
        datadir: path.join(fsRoot, 'bitcoin-datadir'),
        p2pAddNodes: [],
        bitcoinExtraParams: ['-dnsseed=0'].concat(extraBtcParams),
        documentBlocks: false,
        federationRegistryScan: { enable: false }
      },
      beacon: { enable: false },
      payjoin: { enable: true },
      lightning: { managed: false, stub: true },
      http: { hostname: '127.0.0.1', listen: true, port: httpPort },
      debug: false
    }));
    await hub.start();
    httpBase = `http://127.0.0.1:${httpPort}`;
    await sleep(800);

    const boot = await httpJson(httpBase, 'POST', '/settings', {
      NODE_NAME: 'PayjoinL1',
      LIGHTNING_MANAGED: false,
      bitcoinManaged: true,
      BITCOIN_NETWORK: 'regtest',
      BITCOIN_LISTEN: false,
      BITCOIN_TXINDEX: true,
      BITCOIN_TXRELAY: true
    });
    assert.strictEqual(boot.status, 200, boot.raw);
    adminToken = boot.body && boot.body.token ? String(boot.body.token) : '';
    assert.ok(adminToken, 'admin token');

    await waitBitcoinHttp(httpBase, 120000);
    await waitPayjoinHttp(httpBase, 30000);
    btc = hub._getBitcoinService();
    assert.ok(btc, 'Bitcoin service');
    if (typeof btc.on === 'function') {
      btc.on('error', () => {});
    }

    const miningAddr = await btc.getUnusedAddress();
    for (let g = 0; g < 12; g++) {
      await btc._makeRPCRequest('generatetoaddress', [10, miningAddr]);
    }
  });

  after(async function () {
    this.timeout(120000);
    if (prevDefaultMaxListeners != null) {
      EventEmitter.defaultMaxListeners = prevDefaultMaxListeners;
    }
    if (hub) {
      try {
        await Promise.race([
          hub.stop(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 25000))
        ]);
      } catch (_) {}
      hub = null;
    }
    if (fsRoot) {
      try {
        fs.rmSync(fsRoot, { recursive: true, force: true });
      } catch (_) {}
      fsRoot = '';
    }
  });

  it('allocates a Hub wallet deposit, funds it on L1, then accepts a BIP78 proposal', async function () {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const created = await httpJson(httpBase, 'POST', '/services/payjoin/sessions', {
      amountSats: AMOUNT_SATS,
      label: `payjoin-l1-${runId}`,
      memo: `verify-payjoin-l1:${runId}`,
      autoAcpBoost: false
    }, bearer(adminToken));
    assert.strictEqual(created.status, 200, created.raw);
    const session = created.body && created.body.session;
    assert.ok(session && session.id, 'createDepositSession id');
    assert.ok(session.address, 'Hub-allocated deposit address');
    assert.ok(session.bip21Uri, 'BIP21 URI');
    assert.ok(String(session.bip21Uri).includes('pj='), 'BIP21 includes pj=');
    assert.strictEqual(Number(session.amountSats), AMOUNT_SATS);

    if (typeof btc._loadWallet === 'function') {
      await btc._loadWallet(btc.walletName);
    }
    const amountBtc = AMOUNT_SATS / 1e8;
    let txid;
    if (btc.walletName && typeof btc._makeWalletRequest === 'function') {
      txid = await btc._makeWalletRequest(
        'sendtoaddress',
        [session.address, amountBtc],
        btc.walletName
      );
    } else {
      txid = await btc._makeRPCRequest('sendtoaddress', [session.address, amountBtc]);
    }
    assert.ok(txid && String(txid).length === 64, 'funding txid');

    const miningAddr = await btc.getUnusedAddress();
    await btc._makeRPCRequest('generatetoaddress', [1, miningAddr]);

    const fundedAt = Date.now();
    let verified = false;
    while (Date.now() - fundedAt < 20000) {
      const d = await hub._l1PaymentVerificationDetail(btc, String(txid).trim(), session.address, AMOUNT_SATS);
      if (d && d.verified && Number(d.confirmations || 0) >= 1) {
        verified = true;
        assert.ok(Number(d.matchedSats) >= AMOUNT_SATS, 'matched sats cover invoice');
        break;
      }
      await sleep(250);
    }
    assert.ok(verified, 'L1 verify sees Payjoin deposit output');

    const listed = await httpJson(httpBase, 'GET', `/services/payjoin/sessions/${encodeURIComponent(session.id)}`);
    assert.strictEqual(listed.status, 200, listed.raw);
    const live = listed.body && listed.body.session ? listed.body.session : listed.body;
    assert.strictEqual(live && live.address, session.address);

    const proposal = await httpJson(
      httpBase,
      'POST',
      `/services/payjoin/sessions/${encodeURIComponent(session.id)}/proposals`,
      { psbt: DEMO_PSBT }
    );
    assert.ok(proposal.status === 200 || proposal.status === 201, proposal.raw);

    const after = await httpJson(httpBase, 'GET', `/services/payjoin/sessions/${encodeURIComponent(session.id)}`);
    const fetched = after.body && after.body.session ? after.body.session : after.body;
    const proposalCount = Number(fetched && fetched.proposalCount ? fetched.proposalCount : 0)
      || (fetched && fetched.proposals && typeof fetched.proposals === 'object'
        ? Object.keys(fetched.proposals).length
        : 0);
    assert.ok(
      fetched && (fetched.status === 'proposal-received' || proposalCount >= 1),
      `expected proposal-received; got ${JSON.stringify(fetched && fetched.status)} count=${proposalCount}`
    );
  });
});
