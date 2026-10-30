'use strict';

/**
 * Hub sign-in with Fabric Passport (protocol v2). The Hub issues a
 * `PASSPORT_CHALLENGE` (`POST /sessions/challenges`), the page hands it to
 * Passport over a private `MessagePort`, Passport answers with a signed
 * `PASSPORT_ASSERTION`, and `POST /sessions` verifies it and sets the
 * HttpOnly session cookie. The page only ever sees the public session view.
 * Whether Passport is there is asked over a port too (`probePassport`), not
 * read from a page attribute any script could set.
 */

const {
  PASSPORT_MARKER,
  probePassport,
  askPassport,
  signInWithPassport
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

module.exports = {
  PASSPORT_MARKER,
  probePassport,
  askPassport,
  loginWithPassport
};
