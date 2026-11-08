'use strict';

/**
 * Hub sign-in with Fabric Passport (protocol v2). The Hub issues a
 * `PASSPORT_CHALLENGE` (`POST /sessions/challenges`), the page hands it to
 * Passport over a private `MessagePort`, Passport answers with a signed
 * `PASSPORT_ASSERTION`, and `POST /sessions` verifies it and sets the
 * HttpOnly session cookie. The page only ever sees the public session view.
 * Whether Passport is there is asked over a port too (`probePassport`), not
 * read from a page attribute any script could set.
 *
 * A Passport that opens peer sessions (v3, `probePassportPeer`) signs in to
 * the Hub by its identity key instead ({@link loginWithPassportPeer}): no
 * pinned origin, no cookie. Passport connects to the Hub WebSocket itself and
 * keeps the session; this page gets the public view and acts through Passport.
 */

const {
  PASSPORT_MARKER,
  probePassport,
  probePassportPeer,
  askPassport,
  signInWithPassport,
  connectPeer,
  callPeer,
  fetchAsPeer
} = require('@fabric/http/functions/passportPage');
const { getPassportSession, setPassportSession, watchIdentityFromSession } = require('./passportSession');

/**
 * Disclosures to ask Passport for: `wallet` when `params.wallet`, plus `params.request`.
 * @private
 */
function disclosures (params) {
  const out = params.wallet ? ['wallet'] : [];
  for (const name of Array.isArray(params.request) ? params.request : []) {
    if (typeof name === 'string' && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Sign in to this Hub with Passport.
 * @param {Object} params
 * @param {Window} params.window
 * @param {boolean} [params.wallet] Ask Passport to share the wallet xpubs too.
 * @param {string[]} [params.request] Further disclosures (`cosigner`).
 * @param {string} [params.purpose]
 * @param {function({ cancel: Function }): void} [params.onPending]
 * @returns {Promise<{ ok: true, session: object, identity: object }|{ ok: false, error: string }>}
 */
async function loginWithPassport (params = {}) {
  const result = await signInWithPassport({
    window: params.window,
    fetch: params.fetch,
    base: '/sessions',
    request: disclosures(params),
    purpose: params.purpose,
    onPending: params.onPending
  });
  if (!result.ok || !result.session) return { ok: false, error: result.error || 'sign-in failed' };
  setPassportSession(result.session);
  return { ok: true, session: result.session, identity: watchIdentityFromSession(result.session) };
}

/**
 * WebSocket endpoint of a Hub served at `origin`.
 * @param {string} origin
 * @returns {string|null}
 */
function hubWebSocketEndpoint (origin) {
  try {
    const url = new URL(String(origin));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/`;
  } catch (_) {
    return null;
  }
}

/**
 * The Hub's identity key and network, as this origin's Hub states them
 * (`GET /sessions/peer`). Passport still checks the key on the socket and
 * warns when it is new.
 * @param {Function} fetchImpl
 * @returns {Promise<{ peer: string, network: (string|null) }|null>}
 */
async function readHubPeer (fetchImpl) {
  try {
    const res = await fetchImpl('/sessions/peer', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json && /^0[23][0-9a-f]{64}$/.test(String(json.peer || '')) ? { peer: json.peer, network: json.network || null } : null;
  } catch (_) {
    return null;
  }
}

/**
 * The Hub's own view of a peer session: a `GetPassportSession` call over the
 * socket, or for an HTTP session a signed `GET /sessions/peer/current`.
 * @private
 */
async function confirmPeerSession (win, session, fetchImpl) {
  if (session.transport === 'http') {
    try {
      const res = await fetchAsPeer(win, { sessionId: session.sessionId, url: `${session.base}/sessions/peer/current`, init: { headers: { Accept: 'application/json' } }, fetch: fetchImpl });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.session && json.session.identity) return { view: json.session };
      return { error: (json && json.error) || `HTTP ${res.status}` };
    } catch (err) {
      return { error: (err && err.message) || 'request failed' };
    }
  }
  const confirmed = await callPeer(win, { sessionId: session.sessionId, method: 'GetPassportSession' });
  if (confirmed.ok && confirmed.result && confirmed.result.identity) return { view: confirmed.result };
  return { error: confirmed.ok ? 'no session on the socket' : confirmed.error };
}

/**
 * Sign in to a Hub with a Passport peer session (v3).
 * @param {Object} params
 * @param {Window} params.window
 * @param {Function} [params.fetch]
 * @param {string[]} [params.endpoints] Hub WebSocket URLs (default: this origin's Hub).
 * @param {string} [params.peer] The Hub's identity pubkey (default: `GET /sessions/peer` on this origin).
 * @param {boolean} [params.wallet] Ask Passport to share the wallet xpubs too.
 * @param {string[]} [params.request] Further disclosures (`cosigner`).
 * @param {string} [params.purpose]
 * @returns {Promise<{ ok: true, session: object, identity: object }|{ ok: false, error: string }>}
 */
async function loginWithPassportPeer (params = {}) {
  const win = params.window;
  const fetchImpl = params.fetch || (win && win.fetch && win.fetch.bind(win));
  if (!win) return { ok: false, error: 'unsupported' };
  // The WebSocket first; the HTTP handshake when Passport can't open it (a
  // loopback Hub admits only the Passport ids it was told about).
  const origin = win.location && win.location.origin;
  const endpoints = Array.isArray(params.endpoints) && params.endpoints.length
    ? params.endpoints
    : [hubWebSocketEndpoint(origin), origin].filter(Boolean);
  let peer = params.peer || null;
  if (!peer && fetchImpl && !(Array.isArray(params.endpoints) && params.endpoints.length)) {
    const found = await readHubPeer(fetchImpl);
    if (found) peer = found.peer;
  }
  const opened = await connectPeer(win, {
    endpoints,
    peer: peer || undefined,
    request: disclosures(params),
    purpose: params.purpose
  });
  if (!opened.ok) return { ok: false, error: opened.error || 'sign-in failed' };
  // What the Hub itself says this session is (signed for by the session key in Passport).
  const confirmed = await confirmPeerSession(win, opened.session, fetchImpl);
  const hubView = confirmed.view || null;
  if (!hubView || hubView.identity.pubkey !== opened.session.identity.pubkey) {
    return { ok: false, error: `the Hub did not confirm the session (${confirmed.error || 'another identity'})` };
  }
  const view = Object.assign({}, hubView, {
    wallet: opened.session.wallet || hubView.wallet || null,
    peerSessionId: opened.session.sessionId,
    peer: opened.session.peer
  });
  setPassportSession(view);
  return { ok: true, session: view, identity: watchIdentityFromSession(view) };
}

/**
 * Sign in with whichever protocol this Passport speaks (peer session when it
 * can, else v2), asking for `request` disclosures.
 * @param {Object} params Same as {@link loginWithPassport}
 * @returns {Promise<{ ok: true, session: object, identity: object }|{ ok: false, error: string }>}
 */
async function loginWithPassportAny (params = {}) {
  const win = params.window;
  if (!win) return { ok: false, error: 'unsupported' };
  const state = await probePassport(win).catch(() => 'missing');
  if (state !== 'ready') return { ok: false, error: state === 'outdated' ? 'passport_outdated' : 'passport_missing' };
  const peerCapable = await probePassportPeer(win).catch(() => false);
  return peerCapable ? loginWithPassportPeer(params) : loginWithPassport(params);
}

/**
 * `fetch` that reads as the current Passport session: a peer session has
 * Passport sign each request; a cookie session goes as is.
 * @param {Window} win
 * @returns {Function}
 */
function sessionFetch (win) {
  const plain = win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null;
  return (url, init = {}) => {
    const session = getPassportSession();
    if (session && session.peerSessionId) {
      return fetchAsPeer(win, { sessionId: session.peerSessionId, url, init, fetch: plain });
    }
    return plain(url, init);
  };
}

module.exports = {
  PASSPORT_MARKER,
  probePassport,
  probePassportPeer,
  askPassport,
  loginWithPassport,
  loginWithPassportPeer,
  loginWithPassportAny,
  sessionFetch,
  hubWebSocketEndpoint
};
