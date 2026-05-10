'use strict';

const crypto = require('crypto');
const { getDelegationSessionById } = require('./fabricDelegation');
const { serveSpaShellIfHtmlNavigation } = require('./httpSpaShell');
const { DESKTOP_LOGIN_PREFIX } = require('./fabricDesktopLoginVerify');
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 256;

function randomSessionId () {
  return crypto.randomBytes(24).toString('hex');
}

function randomNonce () {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Canonical message signed by the Hub identity (Schnorr / BIP340) for browser ↔ desktop linking.
 * @param {string} sessionId
 * @param {string} origin - e.g. http://127.0.0.1:8080
 * @param {string} nonce
 */
function buildLoginMessage (sessionId, origin, nonce) {
  return `${DESKTOP_LOGIN_PREFIX}:${nonce}:${sessionId}:${origin}`;
}

function pruneSessions (hub) {
  if (!hub._desktopAuthSessions) return;
  const now = Date.now();
  for (const [id, s] of hub._desktopAuthSessions) {
    if (!s || now - s.createdAt > SESSION_TTL_MS) hub._desktopAuthSessions.delete(id);
  }
  while (hub._desktopAuthSessions.size > MAX_SESSIONS) {
    const first = hub._desktopAuthSessions.keys().next().value;
    hub._desktopAuthSessions.delete(first);
  }
}

function isLocalRequest (req) {
  const addr = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isLoopbackHostname (h) {
  if (typeof h !== 'string') return false;
  const x = h.toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

/**
 * Whether a browser Origin (or Referer-derived origin, or pseudo-origin from Host) matches
 * the session's declared origin. For loopback hosts, `localhost` and `127.0.0.1` (same port)
 * are equivalent so Electron (`http://127.0.0.1:…`) and a browser tab (`http://localhost:…`)
 * can complete the same login session. Non-loopback origins require an exact host match.
 */
function originsMatchForDesktopSession (clientOriginLike, sessionOrigin) {
  if (!clientOriginLike || !sessionOrigin) return false;
  if (clientOriginLike === sessionOrigin) return true;
  let clientUrl;
  let sessionUrl;
  try {
    clientUrl = new URL(clientOriginLike);
    sessionUrl = new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  if (clientUrl.protocol !== sessionUrl.protocol) return false;
  const cLoop = isLoopbackHostname(clientUrl.hostname);
  const sLoop = isLoopbackHostname(sessionUrl.hostname);
  if (cLoop && sLoop) {
    const cPort = clientUrl.port || (clientUrl.protocol === 'https:' ? '443' : '80');
    const sPort = sessionUrl.port || (sessionUrl.protocol === 'https:' ? '443' : '80');
    return cPort === sPort;
  }
  return clientUrl.host === sessionUrl.host;
}

function refererOriginMatchesSession (referer, sessionOrigin) {
  if (typeof referer !== 'string' || !referer) return false;
  try {
    const u = new URL(referer);
    return originsMatchForDesktopSession(`${u.protocol}//${u.host}`, sessionOrigin);
  } catch (_) {
    return false;
  }
}

function hostHeaderMatchesSessionOrigin (requestHost, sessionOrigin) {
  if (!requestHost || !sessionOrigin) return false;
  try {
    const sessionUrl = new URL(sessionOrigin);
    if (requestHost === sessionUrl.host) return true;
    const pseudo = `${sessionUrl.protocol}//${requestHost}`;
    return originsMatchForDesktopSession(pseudo, sessionOrigin);
  } catch (_) {
    return false;
  }
}

/**
 * For desktop-login polling (`GET /sessions/:id`), require Origin/Referer (or same-site
 * `Sec-Fetch-Site` + matching `Host`) when the client is not loopback so a leaked
 * ephemeral `sessionId` is not trivially replayed from an arbitrary host.
 */
function clientMayPollDesktopSession (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(sessionOrigin);
  } catch (_) {
    return false;
  }
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatchForDesktopSession(hdrOrigin, sessionOrigin)) return true;
  const ref = req.headers && req.headers.referer;
  if (refererOriginMatchesSession(ref, sessionOrigin)) return true;
  const sfs = req.headers && String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs === 'same-origin' || sfs === 'same-site') {
    const host = req.headers && req.headers.host;
    if (host && hostHeaderMatchesSessionOrigin(host, sessionOrigin)) return true;
  }
  return false;
}

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

function getBearerToken (req) {
  const auth = req.headers && req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function handleSessionCreate (hub, req, res) {
  try {
    pruneSessions(hub);
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    let origin = typeof body.origin === 'string' ? body.origin.trim() : '';
    if (!origin) {
      const ref = req.headers && req.headers.referer;
      if (typeof ref === 'string' && ref) {
        try {
          const u = new URL(ref);
          origin = `${u.protocol}//${u.host}`;
        } catch (e) {}
      }
    }
    if (!origin) {
      sendJson(res, 400, { ok: false, error: 'origin required (body.origin or Referer)' });
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(origin);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid origin' });
      return;
    }

    if (!isLocalRequest(req) && !clientMayPollDesktopSession(req, origin)) {
      sendJson(res, 403, {
        ok: false,
        error: 'declared origin does not match this request (Origin, Referer, or same-site Host)'
      });
      return;
    }

    const sessionId = randomSessionId();
    const nonce = randomNonce();
    const message = buildLoginMessage(sessionId, origin, nonce);

    hub._desktopAuthSessions.set(sessionId, {
      origin,
      nonce,
      message,
      createdAt: Date.now(),
      status: 'pending'
    });

    sendJson(res, 200, {
      ok: true,
      sessionId,
      message,
      nonce,
      protocolUrl: `fabric://login?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`
    });
  } catch (err) {
    console.error('[HUB:SESSIONS:CREATE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'session create failed' });
  }
}

function handleDesktopSign (hub, req, res) {
  try {
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required in path' });
      return;
    }

    pruneSessions(hub);
    const session = hub._desktopAuthSessions.get(sessionId);
    if (!session || session.status !== 'pending') {
      sendJson(res, 404, { ok: false, error: 'unknown or expired session' });
      return;
    }

    if (!isLocalRequest(req) && !clientMayPollDesktopSession(req, session.origin)) {
      sendJson(res, 403, {
        ok: false,
        error: 'POST .../signatures requires loopback or client Origin/Referer matching session origin'
      });
      return;
    }

    if (!hub._rootKey || !hub._rootKey.private) {
      sendJson(res, 503, { ok: false, error: 'Hub identity has no private key' });
      return;
    }

    const msgBuf = Buffer.from(session.message, 'utf8');
    const signature = hub._rootKey.signSchnorr(msgBuf);
    const pubkeyHex = typeof hub._rootKey.pubkey === 'string' ? hub._rootKey.pubkey : Buffer.from(hub._rootKey.pubkey || []).toString('hex');

    const identity = {
      id: (hub.identity && hub.identity.id != null)
        ? hub.identity.id
        : (hub.agent && hub.agent.identity && hub.agent.identity.id != null)
          ? hub.agent.identity.id
          : null,
      xpub: hub._rootKey.xpub || null
    };

    session.status = 'signed';
    session.signedAt = Date.now();
    session.signature = signature.toString('hex');
    session.pubkeyHex = pubkeyHex;
    session.identity = identity;

    sendJson(res, 200, {
      ok: true,
      sessionId,
      signature: session.signature,
      pubkeyHex,
      message: session.message,
      identity
    });
  } catch (err) {
    console.error('[HUB:SESSIONS:SIGN]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'sign failed' });
  }
}

function handleSessionGet (hub, req, res) {
  try {
    if (serveSpaShellIfHtmlNavigation(hub, req, res)) return;
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId ? String(req.params.sessionId).trim() : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }

    const session = hub._desktopAuthSessions.get(sessionId);
    if (!session) {
      if (!hub._delegationRegistry) hub._delegationRegistry = new Map();
      const delegationRow = hub._delegationRegistry.get(sessionId);
      const bearer = getBearerToken(req);
      if (delegationRow && bearer === sessionId) {
        sendJson(res, 200, {
          ok: true,
          session: {
            origin: delegationRow.origin,
            linkedAt: delegationRow.linkedAt,
            label: delegationRow.label || 'browser',
            identityId: delegationRow.identityId != null ? String(delegationRow.identityId) : null,
            externalSigning: true
          }
        });
        return;
      }
      const delegationView = getDelegationSessionById(hub, sessionId);
      if (delegationView) {
        const row = delegationRow || hub._delegationRegistry.get(sessionId);
        sendJson(res, 200, {
          ...delegationView,
          session: row
            ? {
              origin: row.origin,
              linkedAt: row.linkedAt,
              label: row.label || 'browser',
              identityId: row.identityId != null ? String(row.identityId) : null,
              externalSigning: true
            }
            : null
        });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'unknown or expired session' });
      return;
    }

    if (!clientMayPollDesktopSession(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    if (session.status === 'pending') {
      sendJson(res, 200, {
        ok: true,
        status: 'pending',
        kind: 'desktop_login',
        sessionId,
        origin: session.origin,
        message: session.message,
        nonce: session.nonce,
        createdAt: session.createdAt
      });
      return;
    }

    if (session.status === 'signed') {
      if (!hub._delegationRegistry) hub._delegationRegistry = new Map();
      let delegationToken = session.delegationToken;
      if (!delegationToken) {
        delegationToken = randomSessionId();
        session.delegationToken = delegationToken;
        hub._delegationRegistry.set(delegationToken, {
          origin: session.origin,
          identityId: session.identity && session.identity.id != null ? session.identity.id : null,
          xpub: session.identity && session.identity.xpub ? session.identity.xpub : null,
          linkedAt: Date.now(),
          label: 'browser',
          sessionId
        });
      }
      const payload = {
        ok: true,
        status: 'signed',
        identity: session.identity,
        delegationToken,
        signature: session.signature,
        pubkeyHex: session.pubkeyHex,
        message: session.message
      };
      hub._desktopAuthSessions.delete(sessionId);
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 200, { ok: true, status: session.status || 'unknown' });
  } catch (err) {
    console.error('[HUB:SESSIONS:GET]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'session get failed' });
  }
}

function mountFabricDesktopAuthHttp (hub) {
  // REST: `POST /sessions` create login session; `GET /sessions/:id` poll; desktop completes by creating a `signatures` subresource.
  hub.http._addRoute('POST', '/sessions/:sessionId/signatures', (req, res) => handleDesktopSign(hub, req, res));
  hub.http._addRoute('GET', '/sessions/:sessionId', (req, res) => handleSessionGet(hub, req, res));
  hub.http._addRoute('POST', '/sessions', (req, res) => handleSessionCreate(hub, req, res));
}

module.exports = {
  DESKTOP_LOGIN_PREFIX, // re-export for callers expecting fabricDesktopAuth
  SESSION_TTL_MS,
  buildLoginMessage,
  randomNonce,
  randomSessionId,
  originsMatchForDesktopSession,
  mountFabricDesktopAuthHttp
};
