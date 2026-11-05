'use strict';

const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { MessageChannel } = require('worker_threads');
const { describe, it, before, after } = require('mocha');

const Key = require('@fabric/core/types/key');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const HTTPServer = require('@fabric/http/types/server');
const {
  webSocketTransport,
  httpTransport,
  openWebSocket,
  openPeerSession,
  signWithKey
} = require('@fabric/http/functions/passportPeerClient');

const { mountHubPassportPeer, hubRequestSession } = require('../functions/hubPassport');
const { loginWithPassportPeer, hubWebSocketEndpoint } = require('../functions/passportSiteLogin');
const { getPassportSession, setPassportSession, refreshPassportSession } = require('../functions/passportSession');

const MASTER = importSeed(FIXTURE_SEED);
const USER = deriveAccount(MASTER, { account: 5, network: 'regtest' });

function ephemeralPort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

/**
 * A page window whose Passport does what the extension does: open the Hub
 * socket itself, sign with the user's key, keep the session, and answer calls
 * for the page on private ports.
 */
function pageWindow (origin) {
  const sessions = new Map();
  const seen = [];
  const win = {
    MessageChannel,
    location: { origin },
    seen,
    postMessage (data, targetOrigin, transfer) {
      const port = transfer && transfer[0];
      seen.push(data.type);
      setImmediate(async () => {
        try {
          if (data.type === 'PASSPORT_PEER_CONNECT') {
            const ws = await openWebSocket(data.endpoints[0], WebSocket);
            const session = await openPeerSession({
              transport: webSocketTransport(ws),
              peer: data.peer,
              origin,
              request: data.request,
              sign: signWithKey(USER.identity.key, { disclose: data.request, wallet: USER.wallet, origin })
            });
            sessions.set(session.sessionId, { session, origin });
            port.postMessage({
              type: 'PASSPORT_PEER_SESSION',
              ok: true,
              session: { sessionId: session.sessionId, peer: session.peer, identity: session.identity, expiresAt: session.expiresAt }
            });
          } else if (data.type === 'PASSPORT_PEER_CALL') {
            const held = sessions.get(data.sessionId);
            if (!held || held.origin !== origin) port.postMessage({ ok: false, error: 'not_your_session' });
            else port.postMessage({ type: 'PASSPORT_PEER_RESULT', ok: true, result: await held.session.call(data.method, data.params) });
          } else if (data.type === 'PASSPORT_PEER_CLOSE') {
            const held = sessions.get(data.sessionId);
            if (held) held.session.close();
            sessions.delete(data.sessionId);
            port.postMessage({ type: 'PASSPORT_PEER_CLOSED', ok: true });
          }
        } catch (err) {
          port.postMessage({ ok: false, error: err.message });
        }
        port.close();
      });
    }
  };
  return { win, sessions };
}

describe('Hub Passport peer sessions', function () {
  this.timeout(120000);

  let port;
  let hub;

  before(async function () {
    port = await ephemeralPort();
    hub = {
      settings: { alias: 'Test Hub', network: 'regtest', http: { port } },
      _rootKey: new Key({ xprv: MASTER })
    };
    hub.http = new HTTPServer({
      port,
      host: '127.0.0.1',
      interface: '127.0.0.1',
      hostname: '127.0.0.1',
      listen: true,
      accessLog: path.join(os.tmpdir(), `hub-passport-peer-${port}.log`)
    });
    assert.ok(mountHubPassportPeer(hub, { env: { FABRIC_HUB_PUBLIC_ORIGIN: 'https://hub.example' } }));
    hub.http._addRoute('POST', '/services/whoami', async (req, res) => res.json({ session: await hubRequestSession(hub, req) }));
    await hub.http.start();
  });

  after(async function () {
    if (hub && hub.http) await hub.http.stop();
  });

  it('serves its identity key for pages to name', async function () {
    const res = await fetch(`http://127.0.0.1:${port}/sessions/peer`, { headers: { Accept: 'application/json' } });
    const body = await res.json();
    assert.strictEqual(body.peer, hub._passportPeer.peer);
    assert.strictEqual(body.network, 'regtest');
  });

  it('signs a user in from an origin the Hub never pinned', async function () {
    const ws = await openWebSocket(`ws://127.0.0.1:${port}/`, WebSocket);
    try {
      const session = await openPeerSession({
        transport: webSocketTransport(ws),
        peer: hub._passportPeer.peer,
        origin: 'http://localhost:3000',
        sign: signWithKey(USER.identity.key)
      });
      assert.ok(session.challenge.homes.includes('https://hub.example'));
      const view = await session.call('GetPassportSession');
      assert.strictEqual(view.identity.pubkey, USER.identity.pubkey);
      assert.strictEqual(view.origin, 'http://localhost:3000');
    } finally {
      ws.close();
    }
  });

  it('a Hub page signs in through Passport and keeps the view across refreshes', async function () {
    const { win } = pageWindow('http://localhost:3000');
    const body = { peer: hub._passportPeer.peer, network: 'regtest' };
    const fetchImpl = async (url) => {
      assert.strictEqual(url, '/sessions/peer');
      return { ok: true, status: 200, json: async () => body };
    };
    const result = await loginWithPassportPeer({
      window: win,
      fetch: fetchImpl,
      endpoints: [hubWebSocketEndpoint(`http://127.0.0.1:${port}`)],
      peer: body.peer,
      wallet: true
    });
    assert.strictEqual(result.ok, true, result.error);
    assert.strictEqual(result.identity.pubkey, USER.identity.pubkey);
    assert.ok(result.identity.wallet, 'the wallet the user shared');
    assert.strictEqual(getPassportSession().peerSessionId, result.session.peerSessionId);
    const kept = await refreshPassportSession(async () => { throw new Error('no cookie request for a peer session'); });
    assert.strictEqual(kept.peerSessionId, result.session.peerSessionId);
    setPassportSession(null);
  });

  it('signs in over HTTP and reads the session on any Hub route', async function () {
    const base = `http://127.0.0.1:${port}`;
    const session = await openPeerSession({
      transport: httpTransport(base),
      peer: hub._passportPeer.peer,
      sign: signWithKey(USER.identity.key, { signer: 'gooncitizen' })
    });
    const body = JSON.stringify({ hello: 'hub' });
    const res = await session.fetch(`${base}/services/whoami`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.strictEqual(json.session.kind, 'peer');
    assert.strictEqual(json.session.pubkey, USER.identity.pubkey);
    assert.strictEqual(json.session.signer, 'gooncitizen');
    const anonymous = await (await fetch(`${base}/services/whoami`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
    assert.strictEqual(anonymous.session, null);
  });

  it('maps a page origin to its Hub WebSocket', function () {
    assert.strictEqual(hubWebSocketEndpoint('https://hub.fabric.pub'), 'wss://hub.fabric.pub/');
    assert.strictEqual(hubWebSocketEndpoint('http://127.0.0.1:8080'), 'ws://127.0.0.1:8080/');
    assert.strictEqual(hubWebSocketEndpoint('file:///x'), null);
  });
});
