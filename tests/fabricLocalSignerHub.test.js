'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  createParentPortApprover,
  hubOwnOrigins,
  hubFabricIdentity,
  mountFabricLocalSignerHub
} = require('../functions/fabricLocalSignerHub');
const {
  APPROVAL_REQUEST,
  APPROVAL_RESULT,
  fabricSignApprovalDialog
} = require('../functions/fabricSignApprovalDialog');
const { signCrossSign } = require('../functions/identityCrossSignVerify');
const { ingestIdentityCrossSign } = require('../functions/identityClusterHttp');

function load (name) {
  try {
    return require(name);
  } catch (_) {
    return null;
  }
}

const siteLogin = load('@fabric/core/functions/fabricSiteLogin');
const siteLoginVerify = load('@fabric/http/functions/fabricSiteLoginVerify');
const localSigner = load('@fabric/http/functions/fabricLocalSigner');

const SITE = 'https://shop.example';

function mockRes () {
  const out = { statusCode: 0, body: null };
  return {
    out,
    setHeader () {},
    writeHead (code) { out.statusCode = code; },
    end (body) { out.body = body; out.done = true; },
    status (code) { out.statusCode = code; return this; },
    send (body) { out.body = body; out.done = true; return this; },
    json (body) { out.body = JSON.stringify(body); out.done = true; return this; }
  };
}

function bodyOf (res) {
  return typeof res.out.body === 'string' ? JSON.parse(res.out.body) : res.out.body;
}

function localReq (extra = {}) {
  return Object.assign({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8080' }
  }, extra);
}

async function waitFor (res) {
  for (let i = 0; i < 100 && !res.out.done; i++) await new Promise((resolve) => setImmediate(resolve));
}

function fakeHub () {
  const routes = {};
  return {
    routes,
    settings: { alias: 'Test Hub', http: { port: 8080 } },
    _rootKey: new Key(),
    http: { _addRoute (method, path, fn) { routes[`${method} ${path}`] = fn; } }
  };
}

function link (hub, device) {
  const own = hubFabricIdentity(hub);
  const nonce = crypto.randomBytes(32).toString('hex');
  const mine = signCrossSign(own, { peerPubkey: device.fabricKey.pubkey, nonce });
  const theirs = signCrossSign(device, { peerPubkey: own.fabricKey.pubkey, nonce });
  assert.strictEqual(ingestIdentityCrossSign(hub, mine, mine.pubkeyHex).ok, true);
  assert.strictEqual(ingestIdentityCrossSign(hub, theirs, theirs.pubkeyHex).ok, true);
}

describe('@fabric/hub Passport local signer', function () {
  it('builds a native approval dialog that defaults to Decline', function () {
    const sign = fabricSignApprovalDialog({ kind: 'sign', origin: SITE, purpose: 'Sign in', device: 'ab'.repeat(32) });
    assert.match(sign.message, /shop\.example/);
    assert.strictEqual(sign.defaultId, 1);
    assert.strictEqual(sign.cancelId, 1);
    assert.strictEqual(sign.buttons.length, 2);
    const linkDialog = fabricSignApprovalDialog({ kind: 'link', purpose: 'Laptop\u202e' });
    assert.match(linkDialog.message, /Link/);
    assert.ok(!linkDialog.message.includes('\u202e'));
    assert.strictEqual(APPROVAL_REQUEST, 'fabric-sign-request');
    assert.strictEqual(APPROVAL_RESULT, 'fabric-sign-result');
  });

  it('asks the Electron main process over parentPort and matches the answer by id', async function () {
    const port = new EventEmitter();
    const sent = [];
    port.postMessage = (msg) => sent.push(msg);
    const approve = createParentPortApprover(port);
    const pending = approve({ kind: 'link', purpose: 'Laptop', expiresAt: Date.now() + 5000 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, APPROVAL_REQUEST);
    assert.strictEqual(sent[0].kind, 'link');
    port.emit('message', { data: { type: APPROVAL_RESULT, id: 'someone-else', approved: true } });
    port.emit('message', { data: { type: APPROVAL_RESULT, id: sent[0].id, approved: true } });
    assert.strictEqual(await pending, true);
    assert.strictEqual(createParentPortApprover(null), null);
  });

  it('treats the loopback port and configured public origin as the Hub itself', function () {
    const hub = fakeHub();
    hub.settings.payjoin = { publicOrigin: 'https://hub.example/pay' };
    const own = hubOwnOrigins(hub);
    assert.ok(own.has('http://127.0.0.1:8080'));
    assert.ok(own.has('http://localhost:8080'));
    assert.ok(own.has('https://hub.example'));
    assert.ok(!own.has(SITE));
  });

  it('does not mount without an approver (CLI Hub)', function () {
    const hub = fakeHub();
    assert.strictEqual(mountFabricLocalSignerHub(hub, { port: null }), null);
    assert.deepStrictEqual(Object.keys(hub.routes), []);
  });

  describe('with the local signer installed', function () {
    before(function () {
      if (!localSigner || !siteLogin || !siteLoginVerify || typeof signCrossSign !== 'function') this.skip();
    });

    it('signs a site login for a device in the Hub identity cluster after approval', async function () {
      const hub = fakeHub();
      const prompts = [];
      const signer = mountFabricLocalSignerHub(hub, { approve: (p) => { prompts.push(p); return true; } });
      assert.ok(signer);
      assert.ok(hub.routes['GET /services/fabric/identity']);
      assert.ok(hub.routes['POST /services/fabric/sign']);
      assert.ok(hub.routes['POST /services/fabric/link']);

      const device = new Identity(new Key());
      const request = siteLogin.createSiteLoginRequest({ origin: SITE });
      const ask = siteLogin.createFabricSignRequest({ request: request.uri, origin: SITE }, device.fabricKey);

      const refused = mockRes();
      await hub.routes['POST /services/fabric/sign'](localReq({ body: ask.uri }), refused);
      await waitFor(refused);
      assert.strictEqual(refused.out.statusCode, 403, 'unlinked devices are refused');
      assert.strictEqual(prompts.length, 0);

      link(hub, device);
      const signed = mockRes();
      await hub.routes['POST /services/fabric/sign'](localReq({ body: ask.uri }), signed);
      await waitFor(signed);
      const body = bodyOf(signed);
      assert.strictEqual(signed.out.statusCode, 200, body && body.error);
      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].origin, SITE);
      const verified = siteLoginVerify.verifyFabricSiteLogin(body.fabric, { origin: SITE, nonce: request.nonce });
      assert.strictEqual(verified.ok, true, verified.error);
      assert.strictEqual(verified.signer, 'hub');
      assert.strictEqual(verified.pubkeyHex, hubFabricIdentity(hub).fabricKey.pubkey);
      assert.strictEqual(verified.identity.xpub, null, 'other sites never get the Hub xpub');
    });

    it('hands the Hub xpub only to its own origin', async function () {
      const hub = fakeHub();
      mountFabricLocalSignerHub(hub, { approve: () => true });
      const device = new Identity(new Key());
      link(hub, device);
      const origin = 'http://127.0.0.1:8080';
      const request = siteLogin.createSiteLoginRequest({ origin });
      const ask = siteLogin.createFabricSignRequest({ request: request.uri, origin }, device.fabricKey);
      const res = mockRes();
      await hub.routes['POST /services/fabric/sign'](localReq({ body: ask.uri }), res);
      await waitFor(res);
      const verified = siteLoginVerify.verifyFabricSiteLogin(bodyOf(res).fabric, { origin, nonce: request.nonce });
      assert.strictEqual(verified.ok, true, verified.error);
      assert.ok(verified.identity.xpub);
    });

    it('refuses callers that carry a page Origin', async function () {
      const hub = fakeHub();
      mountFabricLocalSignerHub(hub, { approve: () => true });
      const res = mockRes();
      await hub.routes['GET /services/fabric/identity'](localReq({
        method: 'GET',
        url: '/services/fabric/identity',
        headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' }
      }), res);
      await waitFor(res);
      assert.strictEqual(res.out.statusCode, 403);
    });
  });
});
