'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const Federation = require('@fabric/core/types/federation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const Hub = require('../services/hub');
const FederationsService = require('../services/federations');
const ROUTES = require('../routes');
const { HUB_START_PHASES } = require('../functions/hubLifecycle');
const { ZERO_PARENT } = require('../functions/fabricMessageView');

const SHELL = '<!DOCTYPE html><html><body>shell</body></html>';
const CONTRACT = 'c0'.repeat(32);

function newKey () {
  return new Key({ private: crypto.randomBytes(32).toString('hex') });
}

function frame (key, body) {
  const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
  msg.signWithKey(key);
  return encodeFabricUri(msg);
}

/** Express-like request for a viewer: operator (admin Bearer), member (cosigner), signedIn, anonymous. */
function request (viewer, opts = {}) {
  const headers = { accept: opts.html ? 'text/html' : 'application/json' };
  const req = { headers, params: opts.params || {}, query: opts.query || {}, ip: crypto.randomBytes(4).toString('hex') };
  if (viewer === 'operator') headers.authorization = 'Bearer admin-token';
  if (viewer && viewer.member) {
    req.passportSession = { identity: { id: 'member', pubkey: viewer.member.pubkey }, cosigner: { pubkey: viewer.member.pubkey } };
  }
  if (viewer === 'signedIn') req.passportSession = { identity: { id: 'reader', pubkey: newKey().pubkey } };
  return req;
}

/** Runs a handler and resolves with `{ status, body, html }` once it answers. */
function call (handler, hub, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status (code) { this.statusCode = code; return this; },
      setHeader () {},
      json (body) { resolve({ status: this.statusCode, body }); return this; },
      send (html) { resolve({ status: this.statusCode, html }); return this; },
      format (handlers) {
        const html = /text\/html/.test(req.headers.accept);
        const fn = html ? (handlers.html || handlers['text/html']) : (handlers.json || handlers['application/json']);
        return fn();
      }
    };
    Promise.resolve(handler.call(hub, req, res)).catch(reject);
  });
}

describe('Hub federation, message, and contract pages', function () {
  this.timeout(60000);

  let hub;
  let routes;
  let member;
  let created;
  let relayedId;

  before(async function () {
    hub = new Hub({
      debug: false,
      persistent: false,
      skipStartPhases: HUB_START_PHASES.slice(),
      fs: { path: './stores/hub-test-federation-routes-' + crypto.randomBytes(6).toString('hex') },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0, listen: false },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });
    hub.setup = { verifyAdminToken: (token) => token === 'admin-token' };
    hub.http.jsonOrShell = (req, res, onJSON) => res.format({
      html: () => res.send(SHELL),
      json: () => onJSON()
    });
    routes = new Map();
    hub.http._addRoute = (method, path, handler) => routes.set(`${method} ${path}`, handler);
    await hub._startPhase_routes();

    const hubKey = newKey();
    const federations = new FederationsService({ network: 'regtest', tickMs: 0, resendMinMs: 0 });
    federations.attach({
      key: hubKey,
      rpc: async (method) => {
        if (method === 'scantxoutset') return { unspents: [] };
        throw new Error(`unexpected rpc ${method}`);
      },
      publish: (body) => {
        const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
        msg.signWithKey(hubKey);
        return msg;
      },
      relay: () => {}
    });
    await federations.start();
    hub.federations = federations;
    member = newKey();
    created = await federations.create({ name: 'Ops', threshold: 2, members: [{ pubkey: member.pubkey, url: 'https://member.example' }] });
    const other = newKey();
    const descriptor = Federation.buildDescriptor({ validators: [member.pubkey, other.pubkey], threshold: 2, network: 'regtest', publisher: other.pubkey });
    await federations.submitFrame(frame(other, Federation.inviteMessage({ descriptor })));
    relayedId = Federation.descriptorId(descriptor);

    const f = (n) => String(n).repeat(64);
    const log = [
      { id: 'm1', seq: 1, type: 'CONTRACT_PUBLISH', created: '2026-01-01T00:00:00.000Z', parent: ZERO_PARENT, frameId: f(1), payload: { contractId: CONTRACT } },
      { id: 'm2', seq: 2, type: 'ChatMessage', created: '2026-01-02T00:00:00.000Z', parent: f(1), frameId: f(2), payload: { content: 'hi' } },
      { id: 'm3', seq: 3, type: 'FederationContractInvite', created: '2026-01-03T00:00:00.000Z', parent: f(2), frameId: f(3), payload: { fabric: frame(other, { hello: 'world' }) } }
    ];
    hub._getFabricMessages = () => log;
    hub._getTrackedContractsSummary = () => ({ accepted: [{ contractId: CONTRACT, status: 'accepted', name: 'Goon' }], pending: [] });
    hub._getContractSidechainStateJson = () => ({ type: 'ContractSidechainState', clock: 2, stateDigest: 'd'.repeat(64), parentSealPath: `/namespaces/${CONTRACT}` });
    hub._ensureContractMessageQueueStore = () => null;
    hub.fs = { readFile: () => null, publish: async () => {} };
  });

  const xonly = () => member.pubkey.slice(2);

  describe('GET /federations', function () {
    it('lists every federation for the operator', async function () {
      const r = await call(routes.get('GET /federations'), hub, request('operator'));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.viewer.role, 'operator');
      assert.deepStrictEqual(r.body.federations.map((x) => x.id).sort(), [created.id, relayedId].sort());
    });

    it('lists only a member\'s federations, without member URLs', async function () {
      const r = await call(routes.get('GET /federations'), hub, request({ member }));
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body.viewer, { role: 'member', key: xonly() });
      assert.strictEqual(r.body.federations.length, 2);
      assert.ok(r.body.federations.every((x) => x.members.every((m) => m.url === null)));
    });

    it('answers a reader without a cosigner key with an empty list, and a stranger with 404', async function () {
      const signedIn = await call(routes.get('GET /federations'), hub, request('signedIn'));
      assert.deepStrictEqual([signedIn.status, signedIn.body.viewer.role, signedIn.body.federations], [200, 'signedIn', []]);
      const anonymous = await call(routes.get('GET /federations'), hub, request(null));
      assert.strictEqual(anonymous.status, 404);
    });

    it('serves the application shell to a browser refresh', async function () {
      const r = await call(routes.get('GET /federations'), hub, request(null, { html: true }));
      assert.strictEqual(r.html, SHELL);
    });
  });

  describe('GET /federations/:id', function () {
    const get = (viewer, id, html) => call(routes.get('GET /federations/:federationId'), hub, request(viewer, { params: { federationId: id }, html }));

    it('shows a federation to the operator and its members, by id or prefix', async function () {
      const asOperator = await get('operator', created.id);
      assert.strictEqual(asOperator.status, 200);
      assert.strictEqual(asOperator.body.federation.members.find((m) => m.pubkey === member.pubkey).url, 'https://member.example');
      const asMember = await get({ member }, created.id.slice(0, 12));
      assert.strictEqual(asMember.body.federation.id, created.id);
      assert.strictEqual(asMember.body.federation.members.find((m) => m.self).url, null);
      const relayed = await get({ member }, relayedId);
      assert.strictEqual(relayed.body.federation.status, 'relayed');
    });

    it('is 404 for everyone else', async function () {
      for (const viewer of [{ member: newKey() }, 'signedIn', null]) {
        const r = await get(viewer, created.id);
        assert.strictEqual(r.status, 404, JSON.stringify(viewer));
      }
      assert.strictEqual((await get('operator', 'ab'.repeat(32))).status, 404);
    });

    it('serves the application shell to a browser refresh, whoever asks', async function () {
      assert.strictEqual((await get(null, created.id, true)).html, SHELL);
    });
  });

  describe('GET /federations/:id/messages', function () {
    const get = (viewer, id, query) => call(routes.get('GET /federations/:federationId/messages'), hub, request(viewer, { params: { federationId: id }, query }));

    it('pages the mailbox frames of a federation its members may see', async function () {
      const r = await get({ member }, created.id, { limit: 1 });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.federationId, created.id);
      assert.strictEqual(r.body.messages.length, 1);
      assert.strictEqual(r.body.messages[0].federationId, created.id);
      assert.strictEqual((await get('operator', relayedId)).body.messages.length, 1);
    });

    it('is 404 for anyone who may not see the federation', async function () {
      assert.strictEqual((await get({ member: newKey() }, created.id)).status, 404);
      assert.strictEqual((await get(null, created.id)).status, 404);
    });
  });

  describe('GET /messages', function () {
    it('lists the log with filters and paging', async function () {
      const all = await call(ROUTES.messages.list, hub, request(null));
      assert.strictEqual(all.body.type, 'FabricMessages');
      assert.deepStrictEqual(all.body.messages.map((m) => m.seq), [3, 2, 1]);
      const filtered = await call(ROUTES.messages.list, hub, request(null, { query: { contract: CONTRACT.slice(0, 12) } }));
      assert.deepStrictEqual(filtered.body.messages.map((m) => m.seq), [1]);
      const page = await call(ROUTES.messages.list, hub, request(null, { query: { limit: '1', before: '3' } }));
      assert.deepStrictEqual([page.body.messages.map((m) => m.seq), page.body.more, page.body.next], [[2], true, 2]);
    });

    it('serves the application shell to a browser', async function () {
      assert.strictEqual((await call(ROUTES.messages.list, hub, request(null, { html: true }))).html, SHELL);
    });
  });

  describe('GET /messages/:id', function () {
    const get = (viewer, id) => call(ROUTES.messages.view, hub, request(viewer, { params: { id } }));

    it('returns a log entry with its parent, children, and decoded frame', async function () {
      const r = await get(null, '2'.repeat(64));
      assert.strictEqual(r.status, 200);
      const m = r.body.message;
      assert.deepStrictEqual([m.source, m.parentMessage.seq, m.children.map((c) => c.seq)], ['log', 1, [3]]);
      const withFrame = (await get(null, 'm3')).body.message;
      assert.strictEqual(withFrame.frame.ok, true);
      assert.strictEqual(withFrame.frame.signed, true);
      assert.ok(withFrame.fabric.startsWith('fabric:'));
    });

    it('finds a federation mailbox frame only for readers who may see the federation', async function () {
      const frameId = hub.federations.framesForFederation(created.id).messages[0].id;
      const asMember = await get({ member }, frameId);
      assert.strictEqual(asMember.status, 200);
      assert.deepStrictEqual([asMember.body.message.source, asMember.body.message.federationId], ['federation-mailbox', created.id]);
      assert.strictEqual((await get('operator', frameId)).status, 200);
      assert.strictEqual((await get({ member: newKey() }, frameId)).status, 404);
      assert.strictEqual((await get(null, frameId)).status, 404);
    });

    it('is 404 for an unknown id', async function () {
      const r = await get('operator', 'nope');
      assert.deepStrictEqual([r.status, r.body.message], [404, 'message not found']);
    });
  });

  describe('GET /contracts/:id', function () {
    const get = (id) => call(ROUTES.contracts.view, hub, request(null, { params: { id } }));

    it('adds the application contract for a tracked contract with no stored record', async function () {
      const r = await get(CONTRACT);
      assert.strictEqual(r.body.status, 'ok');
      assert.strictEqual(r.body.contract, null);
      const app = r.body.application;
      assert.deepStrictEqual([app.contractId, app.status, app.sidechain.clock, app.queue.count], [CONTRACT, 'accepted', 2, 0]);
      assert.deepStrictEqual(app.messages.map((m) => m.seq), [1]);
    });

    it('is not found when neither a record nor a tracked contract exists', async function () {
      const r = await get('ff'.repeat(32));
      assert.deepStrictEqual([r.body.status, r.body.message], ['error', 'contract not found']);
    });
  });
});
