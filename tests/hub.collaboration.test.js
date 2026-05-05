'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const url = require('url');
const merge = require('lodash.merge');
const Hub = require('../services/hub');
const settings = require('../settings/local');
const hubCollaboration = require('../functions/hubCollaboration');

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

async function hubRpc (baseUrl, method, params) {
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

function httpJson (baseUrl, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const requestUrl = url.parse(`${baseUrl}${path}`);
    const opts = {
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.path,
      method,
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers)
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let bodyOut = raw;
        try {
          bodyOut = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        resolve({ status: res.statusCode, body: bodyOut, raw });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('hubCollaboration', function () {
  it('normalizeSecpPublicKey accepts compressed secp256k1 generator', function () {
    const g = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const n = hubCollaboration.normalizeSecpPublicKey(g);
    assert.strictEqual(n.ok, true);
    assert.strictEqual(n.xOnlyHex, '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  });

  it('flattenGroupPubkeys resolves nested group and pubkey', function () {
    const pk = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const n = hubCollaboration.normalizeSecpPublicKey(pk);
    assert.strictEqual(n.ok, true);
    // Must match GROUP_ID_RE in functions/hubCollaboration.js: grp_ + 32 hex chars
    const grpInner = 'grp_' + '1'.repeat(32);
    const grpOuter = 'grp_' + '2'.repeat(32);
    const store = hubCollaboration.emptyStore();
    store.groups[grpInner] = {
      id: grpInner,
      name: 'inner',
      threshold: 1,
      members: [{ type: 'pubkey', publicKeyHex: n.xOnlyHex }],
      createdAt: 1,
      updatedAt: 1
    };
    store.groups[grpOuter] = {
      id: grpOuter,
      name: 'outer',
      threshold: 1,
      members: [{ type: 'group', groupId: grpInner }],
      createdAt: 1,
      updatedAt: 1
    };
    const flat = hubCollaboration.flattenGroupPubkeys(store, grpOuter);
    assert.deepStrictEqual(flat.missing, []);
    assert.strictEqual(flat.xOnlyHexList.length, 1);
    assert.strictEqual(flat.xOnlyHexList[0], n.xOnlyHex);
  });

  describe('HTTP', function () {
    let hub;
    let baseUrl;
    let testFsPath;
    let adminToken;

    before(async function () {
      this.timeout(30000);
      const [p2pPort, httpPort] = await Promise.all([getFreePort(), getFreePort()]);
      testFsPath = path.join(__dirname, '..', 'stores', `hub-collab-test-${process.pid}-${Date.now()}`);
      fs.mkdirSync(testFsPath, { recursive: true });

      hub = new Hub(merge({}, settings, {
        port: p2pPort,
        fs: { path: testFsPath },
        bitcoin: { enable: false, network: 'regtest' },
        http: { hostname: '127.0.0.1', listen: true, port: httpPort },
        debug: false
      }));
      await hub.start();
      baseUrl = `http://127.0.0.1:${httpPort}`;

      const boot = await httpJson(baseUrl, 'POST', '/settings', {
        NODE_NAME: 'CollabTestHub',
        BITCOIN_MANAGED: false,
        BITCOIN_HOST: '127.0.0.1',
        BITCOIN_RPC_PORT: '18443',
        BITCOIN_USERNAME: '',
        BITCOIN_PASSWORD: ''
      }, {});
      if (boot.status !== 200 || !boot.body || !boot.body.token) {
        throw new Error(`bootstrap failed: ${boot.status} ${boot.raw && boot.raw.slice(0, 200)}`);
      }
      adminToken = boot.body.token;
      await new Promise((r) => setTimeout(r, 300));
    });

    after(async function () {
      this.timeout(10000);
      if (hub) {
        await Promise.race([
          hub.stop(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('stop timeout')), 8000))
        ]).catch(() => {});
      }
      if (testFsPath) {
        try {
          fs.rmSync(testFsPath, { recursive: true, force: true });
        } catch (_) {}
      }
    });

    it('returns 401 for contacts without admin token', async function () {
      const r = await httpJson(baseUrl, 'GET', '/services/collaboration/contacts', null, {});
      assert.strictEqual(r.status, 401);
    });

    it('creates contact, group, member, multisig preview', async function () {
      const auth = { Authorization: `Bearer ${adminToken}` };
      const pk = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const c = await httpJson(baseUrl, 'POST', '/services/collaboration/contacts', {
        email: 'collab-test@example.com',
        publicKeyHex: pk,
        label: 'Test'
      }, auth);
      assert.strictEqual(c.status, 200, JSON.stringify(c.body));
      assert.strictEqual(c.body.status, 'success');
      const contactId = c.body.contact && c.body.contact.id;
      assert.ok(contactId && contactId.startsWith('cnt_'));

      const g = await httpJson(baseUrl, 'POST', '/services/collaboration/groups', {
        name: 'Signers',
        threshold: 1
      }, auth);
      assert.strictEqual(g.status, 200);
      const groupId = g.body.group && g.body.group.id;
      assert.ok(groupId && groupId.startsWith('grp_'));

      const m = await httpJson(
        baseUrl,
        'POST',
        `/services/collaboration/groups/${encodeURIComponent(groupId)}/members`,
        { type: 'pubkey', publicKeyHex: pk },
        auth
      );
      assert.strictEqual(m.status, 200);

      const prev = await httpJson(
        baseUrl,
        'GET',
        `/services/collaboration/groups/${encodeURIComponent(groupId)}/multisig-preview`,
        null,
        auth
      );
      assert.strictEqual(prev.status, 200);
      assert.strictEqual(prev.body.preview.uniquePubkeys, 1);
      assert.strictEqual(prev.body.preview.receiveReady, true);
      assert.ok(/^bcrt1p/i.test(String(prev.body.preview.receiveAddress || '')));
      assert.ok(String(prev.body.preview.receiveDescriptor || '').startsWith('tr('));
      assert.ok(prev.body.preview.federationPolicy && prev.body.preview.federationPolicy.ready, 'group preview should include ready federation policy');
      assert.ok(/^bcrt1p/i.test(String(prev.body.preview.federationPolicy.vaultAddress || '')));
      assert.strictEqual(Number(prev.body.preview.federationPolicy.threshold || 0), 1);
      assert.ok(Array.isArray(prev.body.preview.federationPolicy.validatorsCompressedSorted));
      assert.strictEqual(prev.body.preview.federationPolicy.validatorsCompressedSorted.length, 1);
      assert.ok(prev.body.preview.policyFingerprint && prev.body.preview.policyFingerprint.length === 64);

      const inv = await httpJson(baseUrl, 'POST', '/services/collaboration/invitations', {
        email: 'invitee@example.com'
      }, auth);
      assert.strictEqual(inv.status, 200);
      assert.ok(inv.body.invitation && inv.body.invitation.id);
    });

    it('UpsertCollaborationGroupFromFederationValidators creates and updates a pubkey-only group', async function () {
      const pk = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const r1 = await hubRpc(baseUrl, 'UpsertCollaborationGroupFromFederationValidators', [{
        adminToken,
        validators: [pk],
        threshold: 1,
        name: 'FromFederationRpc'
      }]);
      assert.strictEqual(r1.status, 'success');
      assert.strictEqual(r1.updated, false);
      const gid = r1.groupId;
      assert.ok(gid && String(gid).startsWith('grp_'));
      assert.strictEqual(r1.group && r1.group.members && r1.group.members.length, 1);

      const r2 = await hubRpc(baseUrl, 'UpsertCollaborationGroupFromFederationValidators', [{
        adminToken,
        validators: [pk],
        threshold: 1,
        groupId: gid,
        name: 'RenamedFedCollab'
      }]);
      assert.strictEqual(r2.status, 'success');
      assert.strictEqual(r2.updated, true);
      assert.strictEqual(r2.groupId, gid);
      assert.strictEqual(r2.group && r2.group.name, 'RenamedFedCollab');
      assert.strictEqual(r2.group && r2.group.members && r2.group.members.length, 1);
    });
  });
});
