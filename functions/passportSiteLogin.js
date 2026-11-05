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
  callPeer
} = require('@fabric/http/functions/passportPage');
const { setPassportSession, watchIdentityFromSession } = require('./passportSession');

/**
 * Sign in to this Hub with Passport.
 * @param {Object} params
 * @param {Window} params.window
 * @param {boolean} [params.wallet] Ask Passport to share the wallet xpubs too.
 * @param {string} [params.purpose]
 * @param {function({ cancel: Function }): void} [params.onPending]
 * @returns {Promise<{ ok: true, session: object, identity: object }|{ ok: false, error: string }>}
 */
async function loginWithPassport (params = {}) {
  const result = await signInWithPassport({
    window: params.window,
    fetch: params.fetch,
    base: '/sessions',
    request: params.wallet ? ['wallet'] : [],
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
 * Sign in to a Hub with a Passport peer session (v3).
 * @param {Object} params
 * @param {Window} params.window
 * @param {Function} [params.fetch]
 * @param {string[]} [params.endpoints] Hub WebSocket URLs (default: this origin's Hub).
 * @param {string} [params.peer] The Hub's identity pubkey (default: `GET /sessions/peer` on this origin).
 * @param {boolean} [params.wallet] Ask Passport to share the wallet xpubs too.
 * @param {string} [params.purpose]
 * @returns {Promise<{ ok: true, session: object, identity: object }|{ ok: false, error: string }>}
 */
async function loginWithPassportPeer (params = {}) {
  const win = params.window;
  const fetchImpl = params.fetch || (win && win.fetch && win.fetch.bind(win));
  if (!win) return { ok: false, error: 'unsupported' };
  const endpoints = Array.isArray(params.endpoints) && params.endpoints.length
    ? params.endpoints
    : [hubWebSocketEndpoint(win.location && win.location.origin)].filter(Boolean);
  let peer = params.peer || null;
  if (!peer && fetchImpl && !(Array.isArray(params.endpoints) && params.endpoints.length)) {
    const found = await readHubPeer(fetchImpl);
    if (found) peer = found.peer;
  }
  const opened = await connectPeer(win, {
    endpoints,
    peer: peer || undefined,
    request: params.wallet ? ['wallet'] : [],
    purpose: params.purpose
  });
  if (!opened.ok) return { ok: false, error: opened.error || 'sign-in failed' };
  // What the Hub itself says this session is (signed for by the session key in Passport).
  const confirmed = await callPeer(win, { sessionId: opened.session.sessionId, method: 'GetPassportSession' });
  const hubView = confirmed.ok && confirmed.result && confirmed.result.identity ? confirmed.result : null;
  if (!hubView || hubView.identity.pubkey !== opened.session.identity.pubkey) {
    return { ok: false, error: 'the Hub did not confirm the session' };
  }
  const view = Object.assign({}, hubView, {
    wallet: opened.session.wallet || hubView.wallet || null,
    peerSessionId: opened.session.sessionId,
    peer: opened.session.peer
  });
  setPassportSession(view);
  return { ok: true, session: view, identity: watchIdentityFromSession(view) };
}

module.exports = {
  PASSPORT_MARKER,
  probePassport,
  probePassportPeer,
  askPassport,
  loginWithPassport,
  loginWithPassportPeer,
  hubWebSocketEndpoint
};
