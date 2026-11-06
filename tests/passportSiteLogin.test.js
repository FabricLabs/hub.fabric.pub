'use strict';

const assert = require('assert');
const { MessageChannel } = require('worker_threads');
const { describe, it, beforeEach } = require('mocha');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { signAssertion, readChallenge } = require('@fabric/core/functions/passport');
const { createPassportRelyingParty } = require('@fabric/http/functions/passportRelyingParty');
const { probePassport, loginWithPassport } = require('../functions/passportSiteLogin');
const {
  getPassportSession,
  setPassportSession,
  refreshPassportSession,
  endPassportSession,
  watchIdentityFromSession
} = require('../functions/passportSession');

const ORIGIN = 'https://hub.fabric.pub';
const MASTER = importSeed(FIXTURE_SEED);

/** A Hub on the other end of `fetch`, backed by a real relying party. */
function hubServer () {
  const rp = createPassportRelyingParty({ pinnedOrigins: [ORIGIN], network: 'regtest' });
  const jar = {};
  const calls = [];
  async function fetchImpl (url, init = {}) {
    const method = init.method || 'GET';
    calls.push({ url, method });
    const body = init.body ? JSON.parse(init.body) : {};
    const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
    if (url === '/sessions/challenges' && method === 'POST') {
      const issued = await rp.issueChallenge({ origin: ORIGIN, request: body.request });
      jar.binding = issued.bindingSecret;
      return reply(200, { challenge: issued.challenge, expiresAt: issued.expiresAt, network: issued.network });
    }
    if (url === '/sessions' && method === 'POST') {
      const verified = await rp.redeem(jar.binding, body.assertion);
      delete jar.binding;
      if (!verified.ok) return reply(verified.status, { error: verified.error });
      const { token, session } = await rp.issueSession(verified);
      jar.session = token;
      return reply(200, { session: rp.sessionView(session) });
    }
    if (url === '/sessions/current' && method === 'GET') {
      const session = await rp.readSession(jar.session);
      return session ? reply(200, { session: rp.sessionView(session) }) : reply(401, { error: 'not signed in' });
    }
    if (url === '/sessions/current' && method === 'DELETE') {
      await rp.revokeSession(jar.session);
      delete jar.session;
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'not found' });
  }
  return { fetch: fetchImpl, jar, calls };
}

/** A page window; `passport` answers on the transferred port the way the extension does. */
function pageWindow (passport) {
  return {
    MessageChannel,
    location: { origin: ORIGIN },
    posted: [],
    postMessage (data, targetOrigin, transfer) {
      this.posted.push({ data, targetOrigin });
      if (passport) setImmediate(() => passport(data, transfer && transfer[0]));
    }
  };
}

function passportSigning ({ account = 0, share = true } = {}) {
  return (data, port) => {
    assert.strictEqual(data.type, 'PASSPORT_CHALLENGE');
    const read = readChallenge(data.challenge);
    assert.strictEqual(read.ok, true, read.error);
    const derived = deriveAccount(MASTER, { account, network: read.challenge.network });
    const disclose = share ? read.challenge.request.filter((item) => item === 'wallet') : [];
    const signed = signAssertion({
      challenge: data.challenge,
      origin: ORIGIN,
      signer: 'passport',
      disclose,
      wallet: derived.wallet
    }, derived.identity.key);
    port.postMessage({ type: 'PASSPORT_ASSERTION', ok: true, assertion: signed.uri });
    port.close();
  };
}

describe('Passport site login (v2)', function () {
  beforeEach(function () {
    setPassportSession(null);
  });

  it('asks Passport over a port whether it is there', async function () {
    const page = (answer, marker = null) => Object.assign(pageWindow(answer), {
      document: { documentElement: { getAttribute: () => marker } }
    });
    const hello = (v) => (data, port) => {
      assert.strictEqual(data.type, 'PASSPORT_HELLO');
      port.postMessage({ type: 'PASSPORT_HELLO', v });
    };
    assert.strictEqual(await probePassport(page(hello(2))), 'ready');
    assert.strictEqual(await probePassport(page(hello(1))), 'outdated');
    assert.strictEqual(await probePassport(page(null), { timeoutMs: 20 }), 'missing');
    assert.strictEqual(await probePassport(page(null, '2'), { timeoutMs: 20 }), 'outdated', 'an older Passport only marks the page');
  });

  it('signs in with the identity only, and keeps the session view in memory', async function () {
    const hub = hubServer();
    const win = pageWindow(passportSigning());
    const result = await loginWithPassport({ window: win, fetch: hub.fetch });
    assert.strictEqual(result.ok, true, result.error);
    const expected = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    assert.strictEqual(result.session.identity.pubkey, expected.identity.pubkey);
    assert.strictEqual(result.session.wallet, undefined);
    assert.strictEqual(result.identity.wallet, null);
    assert.strictEqual(getPassportSession().identity.id, result.session.identity.id);
    assert.strictEqual(win.posted[0].targetOrigin, ORIGIN);
    assert.ok(hub.jar.session, 'the Hub holds the session token, not the page');
    assert.ok(!JSON.stringify(result).includes(hub.jar.session), 'the page never sees the token');
  });

  it('shares the wallet xpubs only when asked and agreed', async function () {
    const hub = hubServer();
    const shared = await loginWithPassport({ window: pageWindow(passportSigning()), fetch: hub.fetch, wallet: true });
    assert.strictEqual(shared.ok, true, shared.error);
    const expected = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    assert.strictEqual(shared.identity.wallet.segwit.xpub, expected.wallet.segwit.xpub);
    assert.strictEqual(shared.identity.wallet.receive, 'segwit');

    const declined = await loginWithPassport({ window: pageWindow(passportSigning({ share: false })), fetch: hub.fetch, wallet: true });
    assert.strictEqual(declined.ok, true, declined.error);
    assert.strictEqual(declined.identity.wallet, null);
  });

  it('passes on a refusal from Passport', async function () {
    const hub = hubServer();
    const win = pageWindow((data, port) => { port.postMessage({ ok: false, error: 'declined' }); port.close(); });
    const result = await loginWithPassport({ window: win, fetch: hub.fetch });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'declined');
    assert.strictEqual(getPassportSession(), null);
  });

  it('refreshes from /sessions/current and signs out with DELETE', async function () {
    const hub = hubServer();
    await loginWithPassport({ window: pageWindow(passportSigning({ account: 3 })), fetch: hub.fetch });
    setPassportSession(null);
    const view = await refreshPassportSession(hub.fetch);
    assert.ok(view && view.identity.id);
    await endPassportSession(hub.fetch);
    assert.strictEqual(getPassportSession(), null);
    assert.strictEqual(await refreshPassportSession(hub.fetch), null);
    assert.ok(hub.calls.some((c) => c.url === '/sessions/current' && c.method === 'DELETE'));
  });

  it('builds a watch identity without a wallet unless one was shared', function () {
    assert.strictEqual(watchIdentityFromSession(null), null);
    const watch = watchIdentityFromSession({ identity: { id: 'abc', pubkey: '02' + '1'.repeat(64) }, network: 'regtest', signer: 'hub' });
    assert.deepStrictEqual(watch, { id: 'abc', pubkey: '02' + '1'.repeat(64), network: 'regtest', signer: 'hub', passport: true, wallet: null });
  });
});
