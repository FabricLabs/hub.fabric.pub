'use strict';

/**
 * Mutual device-link attestations (Passport ↔ Hub ↔ GoonCitizen).
 *
 * Challenge (both parties BIP340-sign the same UTF-8 string):
 *   fabric:device-link:1:<64-hex nonce>:<initiatorId>:<responderId>:<label>
 *
 * Flow (Hub rendezvous under `/device-links`):
 * 1. Initiator POST /device-links with identity + Schnorr over an *offer* preamble
 *    (or create unsigned pending + sign later — we require initiator offer signature).
 * 2. Responder GET pending, POST …/signatures { role:'responder', … }.
 * 3. Initiator POST …/signatures { role:'initiator', … } countersigns the link message.
 * 4. GET returns status `linked` with both attestations (ephemeral session may retire).
 */

const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const {
  originsMatchForDesktopSession
} = require('./fabricDesktopAuth');
const {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage
} = require('./fabricDeviceLinkMessages');

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 256;

function randomSessionId () {
  return crypto.randomBytes(24).toString('hex');
}

function randomNonce () {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verify Schnorr + identity.id matches xpub (same rules as desktop login verify).
 * @returns {{ ok: true, key: import('@fabric/core/types/key'), identityId: string }|{ ok: false, error: string }}
 */
function verifyIdentitySchnorr (message, signatureHex, pubkeyHex, identity) {
  if (typeof message !== 'string' || !message) {
    return { ok: false, error: 'Missing signed message' };
  }
  if (typeof signatureHex !== 'string' || !/^[a-f0-9]{128}$/i.test(signatureHex)) {
    return { ok: false, error: 'Missing or invalid signature' };
  }
  if (typeof pubkeyHex !== 'string' || !/^[a-f0-9]{66}$/i.test(pubkeyHex)) {
    return { ok: false, error: 'Missing or invalid pubkey' };
  }
  if (!identity || typeof identity !== 'object' || typeof identity.xpub !== 'string' || !identity.xpub) {
    return { ok: false, error: 'Missing identity xpub' };
  }
  let key;
  try {
    key = new Key({ xpub: identity.xpub });
  } catch (e) {
    return { ok: false, error: 'Invalid xpub' };
  }
  const msgBuf = Buffer.from(message, 'utf8');
  let sigBuf;
  try {
    sigBuf = Buffer.from(signatureHex, 'hex');
  } catch (e) {
    return { ok: false, error: 'Invalid signature encoding' };
  }
  if (!key.verifySchnorr(msgBuf, sigBuf)) {
    return { ok: false, error: 'Signature verification failed' };
  }
  const compressedPub = String(key.pubkey || '').toLowerCase();
  if (compressedPub !== String(pubkeyHex).toLowerCase()) {
    return { ok: false, error: 'Public key does not match xpub' };
  }
  let ident;
  try {
    ident = new Identity(key);
  } catch (e) {
    return { ok: false, error: 'Could not derive identity from xpub' };
  }
  const claimedId = identity.id != null ? String(identity.id).trim() : '';
  if (!claimedId || String(ident.id) !== claimedId) {
    return { ok: false, error: 'Identity id does not match xpub' };
  }
  return { ok: true, key, identityId: claimedId };
}

function isLocalRequest (req) {
  const addr = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function clientMayAccessDeviceLink (req, sessionOrigin) {
  if (isLocalRequest(req)) return true;
  if (!sessionOrigin || typeof sessionOrigin !== 'string') return false;
  const hdrOrigin = req.headers && req.headers.origin;
  if (typeof hdrOrigin === 'string' && originsMatchForDesktopSession(hdrOrigin, sessionOrigin)) return true;
  const ref = req.headers && req.headers.referer;
  if (typeof ref === 'string' && ref) {
    try {
      const u = new URL(ref);
      if (originsMatchForDesktopSession(`${u.protocol}//${u.host}`, sessionOrigin)) return true;
    } catch (_) {}
  }
  return false;
}

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

function pruneSessions (hub) {
  if (!hub._deviceLinkSessions) return;
  const now = Date.now();
  for (const [id, s] of hub._deviceLinkSessions) {
    if (!s || now - s.createdAt > SESSION_TTL_MS) hub._deviceLinkSessions.delete(id);
  }
  while (hub._deviceLinkSessions.size > MAX_SESSIONS) {
    const first = hub._deviceLinkSessions.keys().next().value;
    hub._deviceLinkSessions.delete(first);
  }
}

function handleDeviceLinkCreate (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
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
      sendJson(res, 400, { ok: false, error: 'origin required' });
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(origin);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid origin' });
      return;
    }
    if (!isLocalRequest(req) && !clientMayAccessDeviceLink(req, origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this request' });
      return;
    }

    const label = typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : 'device';
    const identity = body.identity;
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const pubkeyHex = typeof body.pubkeyHex === 'string' ? body.pubkeyHex.trim() : '';
    if (!identity || typeof identity !== 'object' || !identity.xpub || !signature || !pubkeyHex) {
      sendJson(res, 400, { ok: false, error: 'identity.xpub, pubkeyHex, and signature required' });
      return;
    }

    let initiatorKey;
    let initiatorIdent;
    try {
      initiatorKey = new Key({ xpub: identity.xpub });
      initiatorIdent = new Identity(initiatorKey);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: 'invalid initiator xpub' });
      return;
    }
    const initiatorId = String(initiatorIdent.id);
    if (identity.id != null && String(identity.id).trim() && String(identity.id).trim() !== initiatorId) {
      sendJson(res, 400, { ok: false, error: 'Identity id does not match xpub' });
      return;
    }
    if (String(initiatorKey.pubkey || '').toLowerCase() !== pubkeyHex.toLowerCase()) {
      sendJson(res, 400, { ok: false, error: 'Public key does not match xpub' });
      return;
    }

    let nonce = typeof body.nonce === 'string' ? body.nonce.trim().toLowerCase() : '';
    if (nonce) {
      if (!/^[a-f0-9]{64}$/.test(nonce)) {
        sendJson(res, 400, { ok: false, error: 'nonce must be 64 hex chars when provided' });
        return;
      }
    } else {
      nonce = randomNonce();
    }
    const sessionId = randomSessionId();
    const offerMessage = buildDeviceLinkOfferMessage(nonce, initiatorId, label, origin);
    const offerVerify = verifyIdentitySchnorr(offerMessage, signature, pubkeyHex, {
      id: initiatorId,
      xpub: identity.xpub
    });
    if (!offerVerify.ok) {
      sendJson(res, 400, { ok: false, error: offerVerify.error || 'invalid offer signature' });
      return;
    }

    hub._deviceLinkSessions.set(sessionId, {
      origin,
      nonce,
      label,
      createdAt: Date.now(),
      status: 'pending',
      initiator: {
        id: initiatorId,
        xpub: identity.xpub,
        pubkeyHex: pubkeyHex.toLowerCase(),
        offerSignature: signature.toLowerCase(),
        offerMessage
      },
      responder: null,
      initiatorCountersignature: null,
      linkMessage: null
    });

    sendJson(res, 200, {
      ok: true,
      sessionId,
      nonce,
      label,
      offerMessage,
      initiatorId,
      protocolUrl: `fabric://link?sessionId=${encodeURIComponent(sessionId)}&hub=${encodeURIComponent(origin)}`
    });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:CREATE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link create failed' });
  }
}

function handleDeviceLinkSign (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    const session = hub._deviceLinkSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'unknown or expired device link' });
      return;
    }
    if (!clientMayAccessDeviceLink(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const role = typeof body.role === 'string' ? body.role.trim() : '';
    const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
    const pubkeyHex = typeof body.pubkeyHex === 'string' ? body.pubkeyHex.trim() : '';
    const identity = body.identity;

    if (role === 'responder') {
      if (session.status !== 'pending' || session.responder) {
        sendJson(res, 409, { ok: false, error: 'responder already set or session not pending' });
        return;
      }
      let responderKey;
      let responderIdent;
      try {
        responderKey = new Key({ xpub: identity && identity.xpub });
        responderIdent = new Identity(responderKey);
      } catch (e) {
        sendJson(res, 400, { ok: false, error: 'invalid responder xpub' });
        return;
      }
      const responderId = String(responderIdent.id);
      if (responderId === session.initiator.id) {
        sendJson(res, 400, { ok: false, error: 'responder must be a different identity' });
        return;
      }
      const linkMessage = buildDeviceLinkMessage(
        session.nonce,
        session.initiator.id,
        responderId,
        session.label
      );
      const verified = verifyIdentitySchnorr(linkMessage, signature, pubkeyHex, {
        id: responderId,
        xpub: identity.xpub
      });
      if (!verified.ok) {
        sendJson(res, 400, { ok: false, error: verified.error || 'invalid responder signature' });
        return;
      }
      session.responder = {
        id: responderId,
        xpub: identity.xpub,
        pubkeyHex: pubkeyHex.toLowerCase(),
        signature: signature.toLowerCase()
      };
      session.linkMessage = linkMessage;
      session.status = 'accepted';
      session.acceptedAt = Date.now();
      sendJson(res, 200, {
        ok: true,
        sessionId,
        status: 'accepted',
        linkMessage,
        responder: { id: responderId, xpub: identity.xpub }
      });
      return;
    }

    if (role === 'initiator') {
      if (session.status !== 'accepted' || !session.responder || !session.linkMessage) {
        sendJson(res, 409, { ok: false, error: 'waiting for responder before initiator countersign' });
        return;
      }
      const verified = verifyIdentitySchnorr(session.linkMessage, signature, pubkeyHex, {
        id: session.initiator.id,
        xpub: session.initiator.xpub
      });
      if (!verified.ok) {
        sendJson(res, 400, { ok: false, error: verified.error || 'invalid initiator countersignature' });
        return;
      }
      if (pubkeyHex.toLowerCase() !== session.initiator.pubkeyHex) {
        sendJson(res, 400, { ok: false, error: 'countersign pubkey must match offer initiator' });
        return;
      }
      session.initiatorCountersignature = signature.toLowerCase();
      session.status = 'linked';
      session.linkedAt = Date.now();
      sendJson(res, 200, {
        ok: true,
        sessionId,
        status: 'linked',
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: { id: session.initiator.id, xpub: session.initiator.xpub },
        responder: { id: session.responder.id, xpub: session.responder.xpub }
      });
      return;
    }

    sendJson(res, 400, { ok: false, error: 'role must be responder or initiator' });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:SIGN]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link sign failed' });
  }
}

function handleDeviceLinkGet (hub, req, res) {
  try {
    if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
    pruneSessions(hub);
    const sessionId = req && req.params && req.params.sessionId
      ? String(req.params.sessionId).trim()
      : '';
    if (!sessionId) {
      sendJson(res, 400, { ok: false, error: 'sessionId required' });
      return;
    }
    const session = hub._deviceLinkSessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'unknown or expired device link' });
      return;
    }
    if (!clientMayAccessDeviceLink(req, session.origin)) {
      sendJson(res, 403, { ok: false, error: 'origin does not match this session' });
      return;
    }

    if (session.status === 'pending') {
      sendJson(res, 200, {
        ok: true,
        status: 'pending',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex
        },
        offerMessage: session.initiator.offerMessage,
        createdAt: session.createdAt
      });
      return;
    }

    if (session.status === 'accepted') {
      sendJson(res, 200, {
        ok: true,
        status: 'accepted',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex
        },
        responder: {
          id: session.responder.id,
          xpub: session.responder.xpub,
          pubkeyHex: session.responder.pubkeyHex,
          signature: session.responder.signature
        },
        createdAt: session.createdAt,
        acceptedAt: session.acceptedAt
      });
      return;
    }

    if (session.status === 'linked') {
      const payload = {
        ok: true,
        status: 'linked',
        kind: 'device_link',
        sessionId,
        origin: session.origin,
        nonce: session.nonce,
        label: session.label,
        linkMessage: session.linkMessage,
        initiator: {
          id: session.initiator.id,
          xpub: session.initiator.xpub,
          pubkeyHex: session.initiator.pubkeyHex,
          offerSignature: session.initiator.offerSignature,
          countersignature: session.initiatorCountersignature
        },
        responder: {
          id: session.responder.id,
          xpub: session.responder.xpub,
          pubkeyHex: session.responder.pubkeyHex,
          signature: session.responder.signature
        },
        linkedAt: session.linkedAt
      };
      hub._deviceLinkSessions.delete(sessionId);
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 200, { ok: true, status: session.status || 'unknown' });
  } catch (err) {
    console.error('[HUB:DEVICE-LINK:GET]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'device link get failed' });
  }
}

function mountFabricDeviceLinkHttp (hub) {
  if (!hub._deviceLinkSessions) hub._deviceLinkSessions = new Map();
  hub.http._addRoute('POST', '/device-links/:sessionId/signatures', (req, res) => handleDeviceLinkSign(hub, req, res));
  hub.http._addRoute('GET', '/device-links/:sessionId', (req, res) => handleDeviceLinkGet(hub, req, res));
  hub.http._addRoute('POST', '/device-links', (req, res) => handleDeviceLinkCreate(hub, req, res));
}

module.exports = {
  DEVICE_LINK_PREFIX,
  SESSION_TTL_MS,
  buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage,
  verifyIdentitySchnorr,
  mountFabricDeviceLinkHttp,
  randomNonce,
  randomSessionId
};
