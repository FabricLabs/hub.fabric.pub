'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { createChallenge, createSignRequest, verifyAssertion } = require('@fabric/core/functions/passport');
const {
  createParentPortApprover,
  passportExtensionIds,
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

const SITE = 'https://shop.example';
const CHROME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PASSPORT_ORIGIN = `chrome-extension://${CHROME_ID}`;
const MASTER = importSeed(FIXTURE_SEED);

function mockRes () {
  const out = { statusCode: 0, body: null };
  return {
    out,
    setHeader () {},
    end (body) { out.body = body; out.done = true; },
    set statusCode (code) { out.statusCode = code; },
    get statusCode () { return out.statusCode; }
  };
}

function bodyOf (res) {
  return typeof res.out.body === 'string' ? JSON.parse(res.out.body) : res.out.body;
}

function localReq (extra = {}) {
  return Object.assign({
    method: 'POST',
    url: '/services/fabric/sign',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:8080', origin: PASSPORT_ORIGIN }
  }, extra);
}

async function waitFor (res) {
  for (let i = 0; i < 200 && !res.out.done; i++) await new Promise((resolve) => setImmediate(resolve));
}

function fakeHub () {
  const routes = {};
  return {
    routes,
    settings: {
      alias: 'Test Hub',
      http: { port: 8080 },
      bitcoin: { network: 'regtest' },
      passport: { extensionIds: [CHROME_ID] }
    },
    _rootKey: new Key({ xprv: MASTER }),
    http: { _addRoute (method, path, fn) { routes[`${method} ${path}`] = fn; } }
  };
}

function link (hub, device) {
  const own = hubFabricIdentity(hub);
  const binding = {
    nonce: crypto.randomBytes(32).toString('hex'),
    sessionId: crypto.randomBytes(24).toString('hex'),
    origin: 'http://127.0.0.1:8080'
  };
  const mine = signCrossSign(own, Object.assign({ peerPubkey: device.fabricKey.pubkey }, binding));
  const theirs = signCrossSign(device, Object.assign({ peerPubkey: own.fabricKey.pubkey }, binding));
  assert.strictEqual(ingestIdentityCrossSign(hub, mine, mine.pubkeyHex).ok, true);
  assert.strictEqual(ingestIdentityCrossSign(hub, theirs, theirs.pubkeyHex).ok, true);
}

function signRequestFor (device, params = {}) {
  const challenge = createChallenge({ origin: SITE, network: params.network || 'regtest', request: params.request });
  const sign = createSignRequest({ challenge: challenge.uri, origin: SITE, account: params.account, disclose: params.disclose }, device.fabricKey);
  return { challenge, sign };
}

describe('@fabric/hub Passport local signer', function () {
  it('builds a native approval dialog that defaults to Decline', function () {
    const sign = fabricSignApprovalDialog({ kind: 'sign', origin: SITE, purpose: 'Sign in', device: 'ab'.repeat(32), network: 'regtest', account: 0, shares: ['identity'] });
    assert.match(sign.message, /shop\.example/);
    assert.strictEqual(sign.defaultId, 1);
    assert.strictEqual(sign.cancelId, 1);
    assert.strictEqual(sign.buttons.length, 2);
    const wallet = fabricSignApprovalDialog({ kind: 'sign', origin: SITE, shares: ['identity', 'wallet'] });
    assert.match(wallet.detail, /wallet/i);
    const linkDialog = fabricSignApprovalDialog({ kind: 'link', label: 'Laptop\u202e', code: '012345' });
    assert.match(linkDialog.message, /Link/);
    assert.match(linkDialog.detail, /012345/);
    assert.ok(!linkDialog.message.includes('\u202e'));
    assert.strictEqual(APPROVAL_REQUEST, 'fabric-sign-request');
    assert.strictEqual(APPROVAL_RESULT, 'fabric-sign-result');
  });

  it('asks the Electron main process over parentPort and matches the answer by id', async function () {
    const port = new EventEmitter();
    const sent = [];
    port.postMessage = (msg) => sent.push(msg);
    const approve = createParentPortApprover(port);
    const pending = approve({ kind: 'link', label: 'Laptop', code: '123456', expiresAt: Date.now() + 5000 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, APPROVAL_REQUEST);
    assert.strictEqual(sent[0].kind, 'link');
    assert.strictEqual(sent[0].code, '123456');
    assert.ok(sent[0].expiresAt <= Date.now() + 5000, 'the dialog closes when the request expires');
    port.emit('message', { data: { type: APPROVAL_RESULT, id: 'someone-else', approved: true } });
    port.emit('message', { data: { type: APPROVAL_RESULT, id: sent[0].id, approved: true } });
    assert.strictEqual(await pending, true);
    assert.strictEqual(createParentPortApprover(null), null);
  });

  it('pins Chrome Passport builds from settings and env', function () {
    const hub = fakeHub();
    const ids = passportExtensionIds(hub, { FABRIC_PASSPORT_EXTENSION_IDS: ` ${'b'.repeat(32)} ,` });
    assert.deepStrictEqual(ids, [CHROME_ID, 'b'.repeat(32)]);
  });

  it('signs with the account identity key, not the master key', function () {
    const hub = fakeHub();
    const identity = hubFabricIdentity(hub);
    const expected = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    assert.strictEqual(identity.fabricKey.pubkey, expected.identity.pubkey);
    assert.notStrictEqual(identity.fabricKey.pubkey, hub._rootKey.pubkey);
  });

  it('does not mount without an approver (CLI Hub)', function () {
    const hub = fakeHub();
    assert.strictEqual(mountFabricLocalSignerHub(hub, { port: null }), null);
    assert.deepStrictEqual(Object.keys(hub.routes), []);
  });

  it('signs a Passport assertion for a device in the Hub identity cluster after approval', async function () {
    const hub = fakeHub();
    const prompts = [];
    const signer = mountFabricLocalSignerHub(hub, { approve: (p) => { prompts.push(p); return true; }, env: {} });
    assert.ok(signer);
    assert.ok(hub.routes['GET /services/fabric/identity']);
    assert.ok(hub.routes['POST /services/fabric/sign']);
    assert.ok(hub.routes['POST /services/fabric/link']);

    const device = new Identity(new Key());
    const { challenge, sign } = signRequestFor(device);

    const refused = mockRes();
    hub.routes['POST /services/fabric/sign'](localReq({ body: sign.uri }), refused);
    await waitFor(refused);
    assert.strictEqual(refused.out.statusCode, 403, 'unlinked devices are refused');
    assert.strictEqual(prompts.length, 0);

    link(hub, device);
    const signed = mockRes();
    hub.routes['POST /services/fabric/sign'](localReq({ body: sign.uri }), signed);
    await waitFor(signed);
    const body = bodyOf(signed);
    assert.strictEqual(signed.out.statusCode, 200, body && body.error);
    assert.strictEqual(prompts.length, 1);
    assert.strictEqual(prompts[0].origin, SITE);
    assert.deepStrictEqual(prompts[0].shares, ['identity']);
    const verified = verifyAssertion(body.fabric, {
      origin: SITE,
      nonce: challenge.nonce,
      challengeHash: challenge.hash,
      network: 'regtest',
      allow: challenge.request,
      challengeExpiresAt: challenge.expiresAt
    });
    assert.strictEqual(verified.ok, true, verified.error);
    assert.strictEqual(verified.signer, 'hub');
    assert.strictEqual(verified.identity.pubkey, hubFabricIdentity(hub).fabricKey.pubkey);
    assert.strictEqual(verified.wallet, null, 'nothing beyond the identity without consent');
  });

  it('refuses callers that carry a page Origin', async function () {
    const hub = fakeHub();
    mountFabricLocalSignerHub(hub, { approve: () => true, env: {} });
    const res = mockRes();
    hub.routes['GET /services/fabric/identity'](localReq({
      method: 'GET',
      url: '/services/fabric/identity',
      headers: { host: '127.0.0.1:8080', origin: 'https://evil.example' }
    }), res);
    await waitFor(res);
    assert.strictEqual(res.out.statusCode, 403);
  });
});
