'use strict';

/**
 * @fileoverview Passport v2 sign-in on the Hub (`@fabric/http` `passportHttp`):
 * `POST /sessions/challenges`, `POST /sessions`, `GET|DELETE /sessions/current`,
 * and, under the desktop shell only, `POST /sessions/self` (the Hub signs its
 * own operator in with its identity key, loopback only).
 *
 * Origins are pinned: loopback on the Hub port, `FABRIC_HUB_PUBLIC_ORIGIN`,
 * `payjoin.publicOrigin`, each origin in `FABRIC_HUB_PASSPORT_ORIGINS` (comma
 * list, e.g. a second public name), and each `FABRIC_HUB_ALLOWED_HOSTS` name
 * on the Hub port, and the Hub's onion origin while its Tor onion service is
 * on (only the onion key's holder can serve it). The `Host` header never adds one.
 *
 * Peer sessions (Passport v3, {@link mountHubPassportPeer}) pin nothing: the
 * user signs in to this Hub by its identity key, from any page, over the Hub
 * WebSocket or HTTP (`@fabric/http` `docs/PASSPORT_PEER.md`). The pinned
 * origins become the Hub's signed `homes`, which only soften Passport's "new
 * site" warning. {@link hubRequestSession} reads either kind of session for
 * a route.
 *
 * This is the reference integration: apps built on the Hub (Sensemaker,
 * GoonCitizen) call these same functions rather than mounting their own.
 */

const { createPassportRelyingParty } = require('@fabric/http/functions/passportRelyingParty');
const { createPassportHttp } = require('@fabric/http/functions/passportHttp');
const { createPassportPeer } = require('@fabric/http/functions/passportPeer');
const { PASSPORT_MAX_HOMES } = require('@fabric/core/functions/passport');
const { signAssertion } = require('@fabric/core/functions/passport');
const { serveSpaShellIfHtmlNavigation } = require('./httpSpaShell');
const { hubAccount, hubNetwork } = require('./hubAccount');

function hubHttpPort (hub) {
  return Number((hub.settings && hub.settings.http && hub.settings.http.port) || 8080);
}

/**
 * Loopback origins of this Hub.
 * @param {object} hub
 * @returns {string[]}
 */
function hubLoopbackOrigins (hub) {
  const port = hubHttpPort(hub);
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

/**
 * Every origin the Hub issues challenges for.
 * @param {object} hub
 * @param {object} [env]
 * @returns {string[]}
 */
function hubPinnedOrigins (hub, env = process.env) {
  const port = hubHttpPort(hub);
  const out = new Set(hubLoopbackOrigins(hub));
  const extra = [
    env.FABRIC_HUB_PUBLIC_ORIGIN,
    hub.settings && hub.settings.payjoin && hub.settings.payjoin.publicOrigin,
    ...String(env.FABRIC_HUB_PASSPORT_ORIGINS || '').split(',').map((o) => o.trim())
  ];
  if (typeof hub.torOrigin === 'function') extra.push(hub.torOrigin());
  for (const raw of extra) {
    try {
      if (raw) out.add(new URL(String(raw)).origin);
    } catch (_) {}
  }
  for (const host of String(env.FABRIC_HUB_ALLOWED_HOSTS || '').split(',')) {
    const name = host.trim().toLowerCase();
    if (!name || /[^a-z0-9.\-[\]:]/.test(name)) continue;
    try {
      out.add(new URL(`http://${name}:${port}`).origin);
    } catch (_) {}
  }
  return [...out];
}

/**
 * Mount Passport sign-in on the Hub HTTP server.
 * @param {object} hub
 * @param {Object} [opts]
 * @param {boolean} [opts.desktop] Allow `/sessions/self` (default: running under the desktop shell)
 * @param {object} [opts.env]
 * @returns {object} `{ relyingParty, http }`
 */
function mountHubPassport (hub, opts = {}) {
  const env = opts.env || process.env;
  const desktop = opts.desktop != null ? !!opts.desktop : !!process.parentPort;
  const network = hubNetwork(hub);
  const relyingParty = createPassportRelyingParty({
    pinnedOrigins: hubPinnedOrigins(hub, env),
    network,
    purpose: `Sign in to ${(hub.settings && hub.settings.alias) || 'Fabric Hub'}`
  });

  const selfSign = desktop
    ? async ({ challenge, origin }) => {
      const account = hubAccount(hub, { network });
      if (!account) {
        const err = new Error('this Hub has no identity key');
        err.status = 409;
        throw err;
      }
      return signAssertion({ challenge, origin, signer: 'hub', network }, account.identity.key);
    }
    : undefined;

  const passportHttp = createPassportHttp({
    relyingParty,
    selfSign,
    selfOrigins: hubLoopbackOrigins(hub)
  });

  for (const route of passportHttp.routes) {
    const handler = route.method === 'GET'
      ? (req, res) => (serveSpaShellIfHtmlNavigation(hub, req, res) ? undefined : route.handler(req, res))
      : route.handler;
    hub.http._addRoute(route.method, route.path, handler);
  }
  hub._passport = { relyingParty, http: passportHttp };
  return hub._passport;
}

/**
 * Answer Passport peer sign-ins (v3) on the Hub: a user signs in to this Hub
 * by its identity key, from any origin.
 * - WebSocket: calls signed with the session key reach methods registered
 *   `withContext` as `context.passport` (`GetPassportSession` answers it).
 * - HTTP: `GET /sessions/peer` (the key and network a page names to
 *   Passport), `POST /sessions/peer` (the handshake), `GET
 *   /sessions/peer/current` (the session a signed request speaks for), and
 *   any request with an `X-Fabric-Request` signed by the session key gets
 *   `req.passportSession`.
 * @param {object} hub A Hub, or an app built on one (`http`, `settings`, `_rootKey`).
 * @param {Object} [opts]
 * @param {object} [opts.env]
 * @param {function(object, object): Promise<(object|void)>} [opts.onSession] Extra
 *   session fields for a verified sign-in (an app's member id), or throw to refuse.
 * @returns {object|null} The Passport peer, or null when the Hub has no identity key yet.
 */
function mountHubPassportPeer (hub, opts = {}) {
  const env = opts.env || process.env;
  const network = hubNetwork(hub);
  const account = hubAccount(hub, { network });
  if (!account || !hub.http || typeof hub.http.attachPassportPeer !== 'function') return null;
  const peer = createPassportPeer({
    key: account.identity.key,
    network,
    purpose: `Sign in to ${(hub.settings && hub.settings.alias) || 'Fabric Hub'}`,
    homes: () => hubPinnedOrigins(hub, env).slice(0, PASSPORT_MAX_HOMES),
    onSession: opts.onSession
  });
  hub.http.attachPassportPeer(peer, { routes: false });
  for (const route of hub.http._passportPeerHttp.routes) {
    const handler = route.method === 'GET'
      ? (req, res) => (serveSpaShellIfHtmlNavigation(hub, req, res) ? undefined : route.handler(req, res))
      : route.handler;
    hub.http._addRoute(route.method, route.path, handler);
  }
  hub.http._addRoute('GET', '/sessions/peer/current', (req, res) => {
    if (serveSpaShellIfHtmlNavigation(hub, req, res)) return undefined;
    const session = req.passportSession || null;
    res.statusCode = session ? 200 : 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(session ? { session } : { error: 'not signed in' }));
    return undefined;
  });
  hub.http._registerMethod('GetPassportSession', (context) => (context && context.passport) || null, { withContext: true });
  hub._passportPeer = peer;
  return peer;
}

/**
 * The Passport session a request carries: a peer session (`X-Fabric-Request`,
 * already checked by the HTTP server) or a v2 cookie / Bearer session, as one
 * shape `{ kind, identityId, pubkey, network, signer, origin, session }`.
 * Null when there is none.
 * @param {object} hub
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<(object|null)>}
 */
async function hubRequestSession (hub, req) {
  const peer = req && req.passportSession;
  if (peer && peer.identity) {
    return {
      kind: 'peer',
      identityId: peer.identity.id,
      pubkey: peer.identity.pubkey,
      network: peer.network || null,
      signer: peer.signer || null,
      origin: peer.origin || null,
      session: peer
    };
  }
  const http = hub && hub._passport && hub._passport.http;
  if (!http || typeof http.readRequestSession !== 'function') return null;
  const site = await http.readRequestSession(req).catch(() => null);
  if (!site || !site.pubkey) return null;
  return {
    kind: 'site',
    identityId: site.identityId,
    pubkey: site.pubkey,
    network: site.network || null,
    signer: site.signer || null,
    origin: site.origin || null,
    session: site
  };
}

module.exports = {
  hubLoopbackOrigins,
  hubPinnedOrigins,
  mountHubPassport,
  mountHubPassportPeer,
  hubRequestSession
};
