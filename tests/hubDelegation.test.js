'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const Message = require('@fabric/core/types/message');
const Delegation = require('@fabric/core/types/delegation');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { createChallenge, verifyAssertion } = require('@fabric/core/functions/passport');
const HubDelegation = require('../services/delegation');

const MASTER = importSeed(FIXTURE_SEED);
const PASSPORT = deriveAccount(MASTER, { account: 0, network: 'regtest' });
const HUB = deriveAccount(MASTER, { account: 1, network: 'regtest' });
const SITE = 'https://goon.vc';
const EXTENSION = 'moz-extension://0b5c2a4e-1111-2222-3333-444455556666';
const FED = 'aa'.repeat(32);
const ADDRESS = 'bcrt1qexampleexampleexampleexample0';

function serve (handle) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (!handle(req, res)) { res.statusCode = 404; res.end('{}'); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function send (origin, method, urlPath, body) {
  const url = new URL(urlPath, origin);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'Content-Type': 'application/json', origin: EXTENSION } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function withdrawalFrame (extra = {}) {
  const body = Object.assign({
    contract: FED,
    type: 'FederationWithdrawalRequest',
    federationId: FED,
    requestId: 'r1',
    destinationAddress: ADDRESS,
    amountSats: 5000,
    feeSats: 200
  }, extra);
  return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]).signWithKey(PASSPORT.cosigner.key);
}

function fakeFederations () {
  const federations = new EventEmitter();
  federations.settings = { maxWithdrawalSats: 50000 };
  federations.answered = [];
  federations.approved = [];
  federations.responded = [];
  federations.networkOf = () => 'regtest';
  federations.answerDelegated = async (body, author) => {
    federations.answered.push({ body, author });
    const reply = { contract: FED, type: 'FederationWithdrawalSignature', federationId: FED, requestId: body.requestId, signatures: [] };
    return Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(reply)]).signWithKey(HUB.cosigner.key);
  };
  federations.approveWithdrawal = async (id, requestId) => { federations.approved.push({ id, requestId }); };
  federations.respond = async (id, accept) => { federations.responded.push({ id, accept }); };
  return federations;
}

describe('Hub delegation (HubDelegation)', function () {
  this.timeout(30000);
  let dir;
  let server;

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-delegation-'));
  });
  afterEach(function () {
    if (server) server.close();
    server = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function setup () {
    const prompts = [];
    const waiting = [];
    const federations = fakeFederations();
    const service = new HubDelegation({
      key: HUB.identity.key,
      cosignerKey: HUB.cosigner.key,
      network: 'regtest',
      dir,
      name: 'Test Hub',
      getAccount: () => HUB,
      federations,
      approve: (p) => {
        prompts.push(p);
        if (p.kind === 'link') return Promise.resolve(true);
        return new Promise((resolve) => waiting.push(resolve));
      }
    });
    const served = await serve((req, res) => service.delegate.handle(req, res));
    server = served.server;
    return { service, federations, prompts, waiting, origin: served.origin };
  }

  async function pair (origin, passport) {
    const offer = await passport.offer({ origin, label: 'Passport' });
    const answered = await send(origin, 'POST', '/services/delegation/links', { frame: offer.uri });
    assert.strictEqual(answered.status, 201, answered.body.error);
    const revealed = await passport.receive(answered.body.frame);
    const confirmed = await send(origin, 'POST', '/services/delegation/links', { frame: revealed.reveal });
    assert.strictEqual(confirmed.status, 200, confirmed.body.error);
    const link = await passport.confirmLink(offer.linkId);
    const mine = await passport.grant({
      grantee: HUB.identity.pubkey,
      scopes: ['identity', 'federation'],
      link: link.revealHash,
      extensionOrigin: EXTENSION,
      cosignerKey: PASSPORT.cosigner.key
    });
    const granted = await send(origin, 'POST', '/services/delegation/links', { frame: mine.uri });
    assert.strictEqual(granted.status, 200, granted.body.error);
    for (const g of granted.body.grants) assert.strictEqual((await passport.receive(g)).ok, true);
    return granted.body.grants;
  }

  it('pairs with the code shown in the Hub dialog, and lists the linked signer', async function () {
    const { service, prompts, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    assert.strictEqual(prompts[0].kind, 'link');
    assert.match(prompts[0].code, /^[0-9]{6}$/);
    const signers = await service.signers();
    assert.strictEqual(signers.given.length, 1);
    assert.deepStrictEqual(signers.given[0].scopes, ['identity', 'passport', 'federation']);
    assert.strictEqual(signers.given[0].cosigner, HUB.cosigner.pubkey);
    assert.strictEqual(signers.received[0].cosigner, PASSPORT.cosigner.pubkey);
    assert.deepStrictEqual(signers.identityPeers, [PASSPORT.identity.pubkey]);
  });

  it('holds a sign-in no rule covers for the operator, then signs it when told', async function () {
    const { service, prompts, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    const notified = new Promise((resolve) => service.once('notification', resolve));
    const c = createChallenge({ origin: SITE, network: 'regtest' });
    const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE });
    const held = await send(origin, 'POST', '/services/delegation/requests', { frame: req.uri });
    assert.strictEqual(held.status, 202);
    assert.strictEqual((await notified).hash, req.hash);
    assert.strictEqual(prompts[prompts.length - 1].kind, 'sign');
    assert.strictEqual(prompts[prompts.length - 1].origin, SITE);
    const pending = await service.pending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].kind, 'DelegationRequest');

    const out = await service.answer(req.hash, 'sign');
    assert.strictEqual(out.json.status, 'signed');
    const got = await passport.receive(out.json.result);
    assert.strictEqual(got.ok, true, got.error);
    const verified = verifyAssertion(got.result.answer.uri, { origin: SITE, nonce: c.nonce, challengeHash: c.hash, network: 'regtest', allow: c.request, challengeExpiresAt: c.expiresAt });
    assert.strictEqual(verified.ok, true, verified.error);
    await service.answer(req.hash, 'decline');
    const decisions = service.rules.decisions();
    assert.strictEqual(decisions.length, 1, 'answering a settled request records nothing');
    assert.strictEqual(decisions[0].action, 'sign');
    assert.strictEqual(decisions[0].rule, null);
  });

  it('signs a sign-in a rule covers without asking, and declines what a rule declines', async function () {
    const { service, prompts, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    service.rules.set([
      { id: 'sites', action: 'sign', scope: 'passport', from: 'identity-linked', origins: [SITE] },
      { id: 'no-evil', action: 'decline', scope: 'passport', origins: ['https://evil.example'] }
    ]);
    const asked = prompts.length;
    const c = createChallenge({ origin: SITE, network: 'regtest' });
    const req = await passport.request({ target: HUB.identity.pubkey, request: c.uri, origin: SITE });
    const out = await send(origin, 'POST', '/services/delegation/requests', { frame: req.uri });
    assert.strictEqual(out.body.status, 'signed');
    const evil = createChallenge({ origin: 'https://evil.example', network: 'regtest' });
    const req2 = await passport.request({ target: HUB.identity.pubkey, request: evil.uri, origin: 'https://evil.example' });
    assert.strictEqual((await send(origin, 'POST', '/services/delegation/requests', { frame: req2.uri })).body.status, 'declined');
    assert.strictEqual(prompts.length, asked, 'no dialog for decided requests');
    assert.deepStrictEqual(service.rules.decisions().map((d) => d.rule), ['no-evil', 'sites']);
  });

  it('co-signs a shared-wallet spend under a rule, as the Hub cosigner', async function () {
    const { service, federations, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    service.rules.set([{ id: 'spend', action: 'sign', scope: 'federation', from: 'identity-linked', maxAmountSats: 10000, destinations: [ADDRESS] }]);
    const req = await passport.request({ target: HUB.identity.pubkey, request: withdrawalFrame() });
    const out = await send(origin, 'POST', '/services/delegation/requests', { frame: req.uri });
    assert.strictEqual(out.body.status, 'signed', out.body.error);
    assert.strictEqual(federations.answered.length, 1);
    assert.strictEqual(federations.answered[0].body.requestId, 'r1');
    const got = await passport.receive(out.body.result);
    assert.strictEqual(got.ok, true, got.error);

    const big = await passport.request({ target: HUB.identity.pubkey, request: withdrawalFrame({ requestId: 'r2', amountSats: 20000 }) });
    assert.strictEqual((await send(origin, 'POST', '/services/delegation/requests', { frame: big.uri })).status, 202, 'over the rule: asks');
    assert.strictEqual(federations.answered.length, 1);
  });

  it('applies the rules to shared-wallet frames from the mesh, by the identity behind the key', async function () {
    const { service, federations, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    service.rules.set([
      { id: 'spend', action: 'sign', scope: 'federation', from: 'identity-linked', maxAmountSats: 10000, destinations: [ADDRESS] }
    ]);
    const decided = new Promise((resolve) => service.once('decided', resolve));
    federations.emit('withdrawal', { federationId: FED, requestId: 'm1', requester: PASSPORT.cosigner.pubkey.slice(2), amountSats: 4000, destinationAddress: ADDRESS, network: 'regtest' });
    assert.strictEqual((await decided).rule, 'spend');
    assert.deepStrictEqual(federations.approved, [{ id: FED, requestId: 'm1' }]);

    federations.emit('withdrawal', { federationId: FED, requestId: 'm2', requester: PASSPORT.cosigner.pubkey.slice(2), amountSats: 4000, destinationAddress: ADDRESS, network: 'regtest', delegated: true });
    federations.emit('withdrawal', { federationId: FED, requestId: 'm3', requester: 'cd'.repeat(32), amountSats: 4000, destinationAddress: ADDRESS, network: 'regtest' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(federations.approved.length, 1, 'delegated frames and strangers are not co-signed here');
  });

  it('revokes a grant it gave', async function () {
    const { service, origin } = await setup();
    const passport = new Delegation({ key: PASSPORT.identity.key });
    await pair(origin, passport);
    const { given } = await service.signers();
    await service.revoke(given[0].hash);
    const after = await service.signers();
    assert.strictEqual(after.given[0].revoked, true);
    await assert.rejects(() => service.revoke('ab'.repeat(32)), /unknown grant/);
  });
});
