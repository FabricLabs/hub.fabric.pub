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
 * on the Hub port. The `Host` header never adds one.
 */

const { createPassportRelyingParty } = require('@fabric/http/functions/passportRelyingParty');
const { createPassportHttp } = require('@fabric/http/functions/passportHttp');
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

module.exports = {
  hubLoopbackOrigins,
  hubPinnedOrigins,
  mountHubPassport
};
