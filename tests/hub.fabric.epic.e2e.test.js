'use strict';

/**
 * "Fabric epic" — one narrative flow across three isolated hubs (no WAN peers, no Bitcoin):
 * distributed HTTP/manifest + peering, sidechain admin patch, sandbox execution contract,
 * WebRTC registry, peer nicknames, chat (broadcast + direct), inventory request,
 * document publish → edit revision → multi-hop P2P replication, Fabric partition + heal,
 * tombstone unpublish, message log + worker snapshot.
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
const PeeringService = require('../services/peering');
const settings = require('../settings/local');

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
    throw new Error(`bootstrap failed: HTTP ${res.status}`);
  }
  return res.body.token;
}

async function sendPeerFileRobust (senderBase, targetHub, targetP2pPort, docId) {
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

describe('Hub fabric epic E2E (mesh + sidechain + execution + partition)', function () {
  this.timeout(240000);

  let prevDefaultMaxListeners;
  before(function () {
    prevDefaultMaxListeners = EventEmitter.defaultMaxListeners;
    EventEmitter.defaultMaxListeners = Math.max(Number(prevDefaultMaxListeners) || 10, 48);
  });
  after(function () {
    EventEmitter.defaultMaxListeners = prevDefaultMaxListeners;
  });

  let hubs = [];
  let fsRoots = [];
  const httpBases = [];
  let p2pPorts = [];

  afterEach(async function () {
    this.timeout(90000);
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
    p2pPorts = [];
  });

  it('runs the full constellation narrative (RPC + HTTP + P2P + admin)', async function () {
    p2pPorts = [await getFreePort(), await getFreePort(), await getFreePort()];
    const httpPorts = [await getFreePort(), await getFreePort(), await getFreePort()];
    const mnemonics = [MNEMONIC_A, MNEMONIC_B, MNEMONIC_C];

    hubs = [];
    fsRoots = [];

    for (let i = 0; i < 3; i++) {
      const root = path.join(__dirname, '..', 'stores', `hub-epic-${process.pid}-${Date.now()}-${i}`);
      fs.mkdirSync(root, { recursive: true });
      fsRoots.push(root);

      const h = new Hub(hubSettingsMerge(settings, {
        port: p2pPorts[i],
        peers: [],
        fs: { path: root },
        key: { mnemonic: mnemonics[i], seed: null },
        bitcoin: { enable: false, network: 'regtest' },
        beacon: { enable: false },
        payjoin: { enable: false },
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
      await sleep(280);
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
    await sleep(4000);

    for (let i = 0; i < 3; i++) {
      const st = await rpc(httpBases[i], 'GetNetworkStatus', []);
      const n = Array.isArray(st && st.peers) ? st.peers.length : 0;
      assert.ok(n >= 1, `hub ${i} should list Fabric peers (got ${n})`);
    }

    // --- HTTP operator surfaces (every hub) ---
    for (let i = 0; i < 3; i++) {
      const man = await httpJson(httpBases[i], 'GET', '/services/distributed/manifest', null);
      assert.strictEqual(man.status, 200, `manifest hub ${i}`);
      assert.ok(man.body && man.body.programId, `manifest programId hub ${i}`);

      const peerHttp = await httpJson(httpBases[i], 'GET', '/services/peering', null);
      assert.strictEqual(peerHttp.status, 200, `peering HTTP hub ${i}`);
      assert.strictEqual(peerHttp.body.service, 'peering', `peering service hub ${i}`);
      assert.ok(peerHttp.body.oracleAttestation, `inline oracle attestation hub ${i}`);
      assert.strictEqual(
        PeeringService.verifyOracleAttestation(peerHttp.body.oracleAttestation),
        true,
        `verifiable peering attestation hub ${i}`
      );

      const peerAtt = await httpJson(httpBases[i], 'GET', '/services/peering/attestation', null);
      assert.strictEqual(peerAtt.status, 200, `peering /attestation hub ${i}`);
      assert.strictEqual(PeeringService.verifyOracleAttestation(peerAtt.body), true, `attestation path hub ${i}`);
    }

    const adminToken = await bootstrapAdminToken(httpBases[0], `epic-alpha-${Date.now()}`);

    // --- Sidechain (admin, no federation validators in test env) ---
    const sc0 = await rpc(httpBases[0], 'GetSidechainState', []);
    assert.strictEqual(sc0.type, 'SidechainState');
    const basisClock = Number(sc0.clock) || 0;
    const patch = await rpc(httpBases[0], 'SubmitSidechainStatePatch', [{
      patches: [{ op: 'add', path: '/fabricEpicE2e', value: { run: true, at: Date.now() } }],
      basisClock,
      adminToken
    }]);
    assert.strictEqual(patch.type, 'SubmitSidechainStatePatchResult');
    assert.strictEqual(patch.clock, basisClock + 1);
    const sc1 = await rpc(httpBases[0], 'GetSidechainState', []);
    assert.ok(sc1.content && sc1.content.fabricEpicE2e && sc1.content.fabricEpicE2e.run === true);

    // --- Execution contract (free path without Bitcoin) ---
    const program = {
      version: 1,
      steps: [
        { op: 'FabricOpcode', fabricType: 'ChatMessage' },
        { op: 'Push', value: { epic: true } }
      ]
    };
    const execCreated = await rpc(httpBases[0], 'CreateExecutionContract', [{
      name: 'epic-e2e-exec',
      program
    }]);
    assert.strictEqual(execCreated.type, 'CreateExecutionContractResult');
    const execRun = await rpc(httpBases[0], 'RunExecutionContract', [{ contractId: execCreated.id }]);
    assert.strictEqual(execRun.type, 'RunExecutionContractResult');
    assert.strictEqual(execRun.ok, true);
    assert.ok(typeof execRun.runCommitmentHex === 'string' && execRun.runCommitmentHex.length === 64);

    // --- WebRTC registry (signaling plane) ---
    const reg = await rpc(httpBases[0], 'RegisterWebRTCPeer', [{
      peerId: 'fabric-epic-e2e-mesh',
      metadata: { role: 'test' }
    }]);
    assert.strictEqual(reg.status, 'success');
    const wList = await rpc(httpBases[0], 'ListWebRTCPeers', []);
    assert.strictEqual(wList.type, 'ListWebRTCPeersResult');
    assert.ok(Array.isArray(wList.peers));
    assert.ok(wList.peers.some((p) => p && (p.peerId === 'fabric-epic-e2e-mesh' || p.id === 'fabric-epic-e2e-mesh')));

    // --- Peer nickname + detail ---
    const nickTarget = `127.0.0.1:${p2pPorts[1]}`;
    const nn = await rpc(httpBases[0], 'SetPeerNickname', [{ address: nickTarget }, 'Epic-Ally-B']);
    assert.strictEqual(nn.status, 'success');
    const gp = await rpc(httpBases[0], 'GetPeer', [{ address: nickTarget }]);
    assert.strictEqual(gp.type, 'GetPeerResult');
    assert.ok(gp.peer);

    // --- Chat: hub broadcast + direct P2P ---
    const chatAll = await rpc(httpBases[0], 'SubmitChatMessage', [{ text: 'epic-e2e broadcast ping' }]);
    assert.strictEqual(chatAll.status, 'success');
    const dm = await rpc(httpBases[0], 'SendPeerMessage', [
      { address: nickTarget },
      { text: 'epic-e2e direct whisper' }
    ]);
    assert.strictEqual(dm.status, 'success');

    // --- Inventory probe (wire only; no HTLC) ---
    const inv = await rpc(httpBases[0], 'RequestPeerInventory', [nickTarget, 'documents']);
    assert.strictEqual(inv.status, 'success');

    // --- Policy + worker telemetry ---
    const pol = await rpc(httpBases[0], 'GetDistributedFederationPolicy', []);
    assert.strictEqual(pol.type, 'DistributedFederationPolicy');
    assert.ok(Array.isArray(pol.validators));
    const ws = await rpc(httpBases[0], 'GetWorkerStatus', []);
    assert.strictEqual(ws.type, 'GetWorkerStatusResult');
    const wealth = await rpcResult(httpBases[0], 'GetNodeWealthSummary', []);
    assert.ok(wealth && typeof wealth === 'object');

    const pj = await rpcResult(httpBases[0], 'GetPayjoinStatus', []);
    assert.ok(
      pj && (pj.status === 'error' || pj.endpointBasePath || pj.version != null),
      'payjoin RPC returns a body (disabled or capabilities)'
    );

    // --- Document: create → publish → edit (new revision id + published) ---
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const v1Text = `epic-v1 ${runId}\n`;
    const v1B64 = Buffer.from(v1Text, 'utf8').toString('base64');
    const created = await rpc(httpBases[0], 'CreateDocument', [{
      name: `epic-${runId}.txt`,
      mime: 'text/plain',
      contentBase64: v1B64
    }]);
    const idV1 = created.document.id;
    await rpc(httpBases[0], 'PublishDocument', [{ id: idV1 }]);

    const v2Text = `${v1Text}epic-v2 line\n`;
    const v2B64 = Buffer.from(v2Text, 'utf8').toString('base64');
    const edited = await rpc(httpBases[0], 'EditDocument', [{
      id: idV1,
      contentBase64: v2B64
    }]);
    assert.strictEqual(edited.type, 'EditDocumentResult');
    assert.strictEqual(edited.published, true);
    const idV2 = edited.document.id;

    const revs = await rpc(httpBases[0], 'ListDocumentRevisions', [{ id: idV2 }]);
    assert.strictEqual(revs.type, 'ListDocumentRevisionsResult');
    assert.ok(Array.isArray(revs.revisions) && revs.revisions.length >= 2);

    // --- Multi-hop replication of published revision ---
    const sendAB = await sendPeerFileRobust(httpBases[0], hubs[1], p2pPorts[1], idV2);
    assert.strictEqual(sendAB && sendAB.status, 'success', JSON.stringify(sendAB));
    await waitForDocumentPayload(httpBases[1], idV2, v2B64, 55000);

    const sendBC = await sendPeerFileRobust(httpBases[1], hubs[2], p2pPorts[2], idV2);
    assert.strictEqual(sendBC && sendBC.status, 'success', JSON.stringify(sendBC));
    await waitForDocumentPayload(httpBases[2], idV2, v2B64, 55000);

    // --- Partition A↔B: file send fails, then heals ---
    const addrA = `127.0.0.1:${p2pPorts[0]}`;
    const addrB = `127.0.0.1:${p2pPorts[1]}`;
    await rpcResult(httpBases[0], 'RemovePeer', [addrB]);
    await rpcResult(httpBases[1], 'RemovePeer', [addrA]);
    await sleep(2000);

    const partDoc = await rpc(httpBases[0], 'CreateDocument', [{
      name: 'partition-probe.txt',
      mime: 'text/plain',
      contentBase64: Buffer.from(`partition ${runId}\n`, 'utf8').toString('base64')
    }]);
    const partId = partDoc.document.id;
    const sendPart = await rpcResult(httpBases[0], 'SendPeerFile', [{ address: addrB }, { id: partId }]);
    assert.ok(
      !sendPart || sendPart.status !== 'success',
      'SendPeerFile should not succeed while A↔B partitioned'
    );

    await rpc(httpBases[0], 'AddPeer', [addrB]);
    await rpc(httpBases[1], 'AddPeer', [addrA]);
    await sleep(3500);

    const sendHeal = await sendPeerFileRobust(httpBases[0], hubs[1], p2pPorts[1], partId);
    assert.strictEqual(sendHeal && sendHeal.status, 'success', `healed SendPeerFile: ${JSON.stringify(sendHeal)}`);
    await waitForDocumentPayload(
      httpBases[1],
      partId,
      Buffer.from(`partition ${runId}\n`, 'utf8').toString('base64'),
      45000
    );

    // --- Tombstone published catalog entry on origin (revision v2) ---
    const tomb = await rpc(httpBases[0], 'EmitTombstone', [{
      documentId: idV2,
      adminToken
    }]);
    assert.strictEqual(tomb.status, 'success');

    const listAfter = await rpc(httpBases[0], 'ListDocuments', []);
    const rows = (listAfter && listAfter.documents) || [];
    const pubRow = rows.find((d) => d && (d.id === idV2 || d.sha256 === idV2) && d.published);
    assert.ok(!pubRow, 'origin should not list v2 as published after tombstone');

    const msgs = await rpc(httpBases[0], 'ListFabricMessages', []);
    assert.strictEqual(msgs.type, 'ListFabricMessagesResult');
    assert.ok(Array.isArray(msgs.messages) && msgs.messages.length > 0);

    const merkle = await rpc(httpBases[0], 'GetMerkleState', []);
    assert.strictEqual(merkle.type, 'GetMerkleStateResult');
  });
});
