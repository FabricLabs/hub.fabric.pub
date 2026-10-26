'use strict';

/**
 * Browser view of the Hub Passport session (`GET /sessions/current`).
 * The session itself is the HttpOnly `fabric.session` cookie; the page only
 * keeps the public view in memory and never stores a token.
 */

const PASSPORT_SESSION_EVENT = 'fabric:passportSessionChanged';

let current = null;

/** @private */
function notify () {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(PASSPORT_SESSION_EVENT, { detail: current }));
  } catch (_) {}
}

/** @returns {object|null} Public session view, or null when signed out. */
function getPassportSession () {
  if (current && current.expiresAt && current.expiresAt <= Date.now()) current = null;
  return current;
}

/** @returns {boolean} */
function hasPassportSession () {
  return !!getPassportSession();
}

/**
 * @param {object|null} view Session view from `/sessions` or `/sessions/current`.
 */
function setPassportSession (view) {
  current = view && view.identity && view.identity.id ? view : null;
  notify();
}

/** @private */
function fetchFor (fetchImpl) {
  if (typeof fetchImpl === 'function') return fetchImpl;
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
  return null;
}

/**
 * Read the session from the Hub (cookie) and remember its view.
 * @param {Function} [fetchImpl]
 * @returns {Promise<object|null>}
 */
async function refreshPassportSession (fetchImpl) {
  const f = fetchFor(fetchImpl);
  if (!f) return null;
  try {
    const res = await f('/sessions/current', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
      setPassportSession(null);
      return null;
    }
    const json = await res.json().catch(() => ({}));
    setPassportSession(json && json.session ? json.session : null);
  } catch (_) {
    return getPassportSession();
  }
  return getPassportSession();
}

/**
 * End the session on the Hub and forget it here.
 * @param {Function} [fetchImpl]
 * @returns {Promise<void>}
 */
async function endPassportSession (fetchImpl) {
  const f = fetchFor(fetchImpl);
  setPassportSession(null);
  if (!f) return;
  try {
    await f('/sessions/current', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' });
  } catch (_) {}
}

/**
 * Watch-only Hub identity for a session: the identity id always, the wallet
 * xpubs only when the user shared `wallet` with this sign-in.
 * @param {object|null} view
 * @returns {{ id: string, pubkey: string, network: string, signer: string, passport: true, wallet: (object|null) }|null}
 */
function watchIdentityFromSession (view) {
  if (!view || !view.identity || !view.identity.id) return null;
  return {
    id: view.identity.id,
    pubkey: view.identity.pubkey,
    network: view.network,
    signer: view.signer,
    passport: true,
    wallet: view.wallet && view.wallet.segwit ? view.wallet : null
  };
}

module.exports = {
  PASSPORT_SESSION_EVENT,
  getPassportSession,
  hasPassportSession,
  setPassportSession,
  refreshPassportSession,
  endPassportSession,
  watchIdentityFromSession
};
