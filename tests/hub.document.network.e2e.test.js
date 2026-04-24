'use strict';

/**
 * End-to-end document flow across a small Fabric mesh:
 *  - Hub A creates + publishes a document
 *  - P2P transfer A → B → C (multi-hop replication, no Bitcoin)
 *  - GetDocument on B and C matches original payload
 *  - EmitTombstone on A (admin): published catalog cleared on origin; backing file remains
 *  - Replicas on B/C still retrieve bytes (local copies; tombstone does not erase remote files)
 *
 * Requires HTTP JSON-RPC (`POST /services/rpc`) like other hub HTTP tests.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const { hubSettingsMerge } = require('../functions/hubSettingsMerge');
const Hub = require('../services/hub');
const settings = require('../settings/local');

/** Distinct identities — same pattern as tests/playnet.market.integration.js (indices 0–2). */
const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MNEMONIC_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

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

async function bootstrapAdminToken (baseUrl, nodeName) {
  const res = await httpJson(baseUrl, 'POST', '/settings', {
    NODE_NAME: nodeName,
    BITCOIN_MANAGED: false,
    BITCOIN_HOST: '127.0.0.1',
    BITCOIN_RPC_PORT: '18443',
    BITCOIN_USERNAME: '',
    BITCOIN_PASSWORD: ''
  });
  if (res.status !== 200 || !res.body || !res.body.token) {
    throw new Error(`bootstrap failed: HTTP ${res.status} ${res.raw && res.raw.slice(0, 200)}`);
  }
  return res.body.token;
}

async function sendPeerFileRobust (senderBase, senderHub, targetHub, targetP2pPort, docId) {
  const peerAddr = `127.0.0.1:${targetP2pPort}`;
  let out = await rpcResult(senderBase, 'SendPeerFile', [{ address: peerAddr }, { id: docId }]);
  if (!out || out.status !== 'success') {
    const fid = targetHub.agent && targetHub.agent.identity && targetHub.agent.identity.id;
    if (fid) {
      out = await rpcResult(senderBase, 'SendPeerFile', [{ id: String(fid) }, { id: docId }]);
    }
  }
  return out;
}

async function waitForDocumentPayload (baseUrl, docId, wantBase64, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastMsg = '';
  while (Date.now() < deadline) {
    const r = await rpc(baseUrl, 'GetDocument', [{ id: docId }]);
    const doc = r && r.document;
    if (doc && doc.contentBase64 === wantBase64) return doc;
    lastMsg = (doc && doc.contentBase64) ? 'payload mismatch' : (r && r.message) || 'no document';
    await sleep(400);
  }
  throw new Error(`GetDocument wait timeout (${docId.slice(0, 8)}…): ${lastMsg}`);
}

describe('Hub document network (multi-hop P2P + tombstone)', function () {
  this.timeout(180000);

  let prevDefaultMaxListeners;
  before(function () {
    prevDefaultMaxListeners = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = Math.max(Number(prevDefaultMaxListeners) || 10, 32);
  });
  after(function () {
    EventEmitter.defaultMaxListeners = prevDefaultMaxListeners;
  });

  let hubs = [];
  let fsRoots = [];
  const httpBases = [];
  let p2pPorts = [];
  let adminTokenA = null;

  afterEach(async function () {
    this.timeout(60000);
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
    p2pPorts = [];
    adminTokenA = null;
  });

  it('exchanges document across three peers, then tombstone clears publish on origin', async function () {
    p2pPorts = [
      await getFreePort(),
      await getFreePort(),
      await getFreePort()
    ];
    const httpPorts = [await getFreePort(), await getFreePort(), await getFreePort()];
    const mnemonics = [MNEMONIC_A, MNEMONIC_B, MNEMONIC_C];

    hubs = [];
    fsRoots = [];

    for (let i = 0; i < 3; i++) {
      const root = path.join(
        __dirname,
        '..',
        'stores',
        `hub-doc-net-${process.pid}-${Date.now()}-${i}`
      );
      fs.mkdirSync(root, { recursive: true });
      fsRoots.push(root);

      const h = new Hub(hubSettingsMerge(settings, {
        port: p2pPorts[i],
        peers: [],
        fs: { path: root },
        key: { mnemonic: mnemonics[i], seed: null },
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
      await sleep(250);
    }

    const rpcProbe = await httpJson(httpBases[0], 'POST', '/services/rpc', {
      jsonrpc: '2.0',
      id: 1,
      method: 'GetSetupStatus',
      params: []
    });
    if (rpcProbe.status !== 200 || !(rpcProbe.body && rpcProbe.body.jsonrpc === '2.0')) {
      return this.skip();
    }

    // Fully-connected triangle so A→B→C relay path exists
    const add = async (fromIdx, toIdx) => {
      const addr = `127.0.0.1:${p2pPorts[toIdx]}`;
      const r = await rpc(httpBases[fromIdx], 'AddPeer', [addr]);
      assert.strictEqual(r.status, 'success', `AddPeer ${fromIdx}→${toIdx}`);
    };
    await add(0, 1);
    await add(0, 2);
    await add(1, 0);
    await add(1, 2);
    await add(2, 0);
    await add(2, 1);
    await sleep(3500);

    for (let i = 0; i < 3; i++) {
      const st = await rpc(httpBases[i], 'GetNetworkStatus', []);
      const n = st && st.peers && typeof st.peers === 'object' ? Object.keys(st.peers).length : 0;
      assert.ok(n >= 1, `hub ${i} should see at least one Fabric peer (got ${n})`);
    }

    adminTokenA = await bootstrapAdminToken(httpBases[0], `doc-net-a-${Date.now()}`);

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const wantText = `network-doc-e2e ${runId}\n`;
    const contentBase64 = Buffer.from(wantText, 'utf8').toString('base64');

    const created = await rpc(httpBases[0], 'CreateDocument', [{
      name: `e2e-net-${runId}.txt`,
      mime: 'text/plain',
      contentBase64
    }]);
    const docId = created && created.document && created.document.id;
    assert.ok(docId, 'CreateDocument returns id');

    const pub = await rpc(httpBases[0], 'PublishDocument', [{ id: docId }]);
    assert.ok(pub && pub.document && pub.document.published, 'PublishDocument sets published on origin');

    const sendAB = await sendPeerFileRobust(httpBases[0], hubs[0], hubs[1], p2pPorts[1], docId);
    assert.strictEqual(sendAB && sendAB.status, 'success', `A→B SendPeerFile: ${JSON.stringify(sendAB)}`);

    await waitForDocumentPayload(httpBases[1], docId, contentBase64, 45000);

    const sendBC = await sendPeerFileRobust(httpBases[1], hubs[1], hubs[2], p2pPorts[2], docId);
    assert.strictEqual(sendBC && sendBC.status, 'success', `B→C SendPeerFile: ${JSON.stringify(sendBC)}`);

    await waitForDocumentPayload(httpBases[2], docId, contentBase64, 45000);

    const gotA = await rpc(httpBases[0], 'GetDocument', [{ id: docId }]);
    assert.strictEqual(
      gotA.document && gotA.document.contentBase64,
      contentBase64,
      'origin GetDocument before tombstone'
    );

    const tomb = await rpc(httpBases[0], 'EmitTombstone', [{
      documentId: docId,
      adminToken: adminTokenA
    }]);
    assert.strictEqual(tomb.status, 'success', JSON.stringify(tomb));

    const listAfter = await rpc(httpBases[0], 'ListDocuments', []);
    const rows = (listAfter && listAfter.documents) || [];
    const pubRow = rows.find((d) => d && (d.id === docId || d.sha256 === docId) && d.published);
    assert.ok(!pubRow, 'origin ListDocuments should not show document as published after tombstone');

    const gotAfterTomb = await rpc(httpBases[0], 'GetDocument', [{ id: docId }]);
    assert.strictEqual(
      gotAfterTomb.document && gotAfterTomb.document.contentBase64,
      contentBase64,
      'origin GetDocument still returns file bytes after tombstone (catalog unpublish only)'
    );

    const replicaB = await rpc(httpBases[1], 'GetDocument', [{ id: docId }]);
    const replicaC = await rpc(httpBases[2], 'GetDocument', [{ id: docId }]);
    assert.strictEqual(replicaB.document && replicaB.document.contentBase64, contentBase64, 'B replica payload');
    assert.strictEqual(replicaC.document && replicaC.document.contentBase64, contentBase64, 'C replica payload');
  });
});
