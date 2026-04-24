'use strict';

/**
 * Browser ↔ Hub desktop **delegation** uses Fabric **message log** types (not HTTP “sign-request” resources):
 * - `DELEGATION_SIGNATURE_REQUEST` — appended when the browser asks the Hub identity to sign bytes.
 * - `DELEGATION_SIGNATURE_RESOLUTION` — appended when the desktop approves or rejects (audit trail).
 *
 * RPC: `PostDelegationSignatureMessage`, `GetDelegationSignatureMessage`, `ResolveDelegationSignatureMessage`.
 * Ephemeral state (full plaintext, Schnorr output) lives in `hub._delegationSignatureMessages` keyed by Fabric message id.
 */

const { serveSpaShellIfHtmlNavigation } = require('./httpSpaShell');

const SIGNATURE_MESSAGE_TTL_MS = 10 * 60 * 1000;
const MAX_SIGNATURE_MESSAGES = 512;

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(obj));
}

function isLocalRequest (req) {
  const addr = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function getBearerToken (req) {
  const auth = req.headers && req.headers.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function pruneDelegationMessages (hub) {
  if (!hub._delegationSignatureMessages) return;
  const now = Date.now();
  for (const [id, r] of hub._delegationSignatureMessages) {
    if (!r || now - r.createdAt > SIGNATURE_MESSAGE_TTL_MS) hub._delegationSignatureMessages.delete(id);
  }
  while (hub._delegationSignatureMessages.size > MAX_SIGNATURE_MESSAGES) {
    const first = hub._delegationSignatureMessages.keys().next().value;
    hub._delegationSignatureMessages.delete(first);
  }
}

function resolveRegistry (hub) {
  if (!hub._delegationRegistry) hub._delegationRegistry = new Map();
  if (!hub._delegationSignatureMessages) hub._delegationSignatureMessages = new Map();
}

/**
 * GET /sessions/:id — when :id is a persisted delegation token (not a desktop-login session).
 */
function getDelegationSessionById (hub, id) {
  resolveRegistry(hub);
  const row = hub._delegationRegistry.get(id);
  if (!row) return null;
  return {
    ok: true,
    kind: 'delegation',
    id,
    origin: row.origin,
    linkedAt: row.linkedAt,
    label: row.label || 'browser',
    identityId: row.identityId != null ? String(row.identityId) : null,
    externalSigning: true
  };
}

function handleSessionsList (hub, req, res) {
  try {
    if (serveSpaShellIfHtmlNavigation(hub, req, res)) return;
    resolveRegistry(hub);
    pruneDelegationMessages(hub);
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { ok: false, error: 'session list is loopback-only' });
      return;
    }
    const list = [];
    for (const [token, row] of hub._delegationRegistry) {
      const pendingDelegationMessages = [];
      for (const [mid, r] of hub._delegationSignatureMessages) {
        if (r && r.token === token && r.status === 'pending') {
          pendingDelegationMessages.push({
            messageId: mid,
            preview: r.preview,
            purpose: r.purpose,
            createdAt: r.createdAt,
            origin: row.origin
          });
        }
      }
      list.push({
        token: token.slice(0, 12) + '…',
        tokenId: token,
        origin: row.origin,
        linkedAt: row.linkedAt,
        label: row.label || 'browser',
        identityId: row.identityId != null ? String(row.identityId) : null,
        pendingDelegationMessages
      });
    }
    sendJson(res, 200, { ok: true, sessions: list });
  } catch (err) {
    console.error('[HUB:SESSION:LIST]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'list failed' });
  }
}

function deleteTokenAndRequests (hub, token) {
  hub._delegationRegistry.delete(token);
  for (const [mid, r] of hub._delegationSignatureMessages) {
    if (r && r.token === token) hub._delegationSignatureMessages.delete(mid);
  }
}

function handleSessionByIdDestroy (hub, req, res) {
  try {
    resolveRegistry(hub);
    const sessionId = req && req.params && req.params.sessionId ? String(req.params.sessionId).trim() : '';
    if (isLocalRequest(req) && sessionId) {
      if (!hub._delegationRegistry.has(sessionId)) {
        sendJson(res, 404, { ok: false, error: 'unknown session' });
        return;
      }
      deleteTokenAndRequests(hub, sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    const token = getBearerToken(req) || sessionId;
    if (!token) {
      sendJson(res, 400, { ok: false, error: 'session token required' });
      return;
    }
    if (!hub._delegationRegistry.has(token)) {
      sendJson(res, 404, { ok: false, error: 'unknown session' });
      return;
    }
    deleteTokenAndRequests(hub, token);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('[HUB:SESSIONS:DELETE]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'delete failed' });
  }
}

/**
 * @param {import('../services/hub')} hub
 * @param {object} p
 * @returns {Promise<object>}
 */
async function postDelegationSignatureMessage (hub, p) {
  resolveRegistry(hub);
  pruneDelegationMessages(hub);
  const sessionToken = p && typeof p.sessionToken === 'string' ? p.sessionToken.trim() : '';
  const message = p && typeof p.message === 'string' ? p.message : '';
  const purpose = p && typeof p.purpose === 'string' ? p.purpose.trim() : 'sign';
  if (!sessionToken || !hub._delegationRegistry.has(sessionToken)) {
    throw new Error('unknown or missing delegation session');
  }
  if (!message) {
    throw new Error('message required');
  }
  if (typeof hub._appendFabricMessage !== 'function') {
    throw new Error('Hub message log unavailable');
  }
  const preview = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const row = hub._delegationRegistry.get(sessionToken);
  const entry = await hub._appendFabricMessage('DELEGATION_SIGNATURE_REQUEST', {
    delegationSessionId: sessionToken,
    origin: row && row.origin ? row.origin : null,
    preview,
    purpose,
    status: 'pending'
  });
  const messageId = entry && entry.id ? String(entry.id) : '';
  if (!messageId) throw new Error('failed to record delegation message');
  hub._delegationSignatureMessages.set(messageId, {
    token: sessionToken,
    message,
    purpose,
    preview,
    status: 'pending',
    createdAt: Date.now()
  });
  return {
    type: 'PostDelegationSignatureMessageResult',
    ok: true,
    messageId,
    preview,
    purpose
  };
}

/**
 * @param {import('../services/hub')} hub
 * @param {object} p
 */
function getDelegationSignatureMessage (hub, p) {
  resolveRegistry(hub);
  pruneDelegationMessages(hub);
  const sessionToken = p && typeof p.sessionToken === 'string' ? p.sessionToken.trim() : '';
  const messageId = p && typeof p.messageId === 'string' ? p.messageId.trim() : '';
  if (!sessionToken || !messageId) {
    throw new Error('sessionToken and messageId required');
  }
  const row = hub._delegationSignatureMessages.get(messageId);
  if (!row) {
    return { type: 'GetDelegationSignatureMessageResult', ok: false, error: 'unknown or expired message' };
  }
  if (row.token !== sessionToken) {
    throw new Error('message does not belong to this delegation session');
  }
  if (row.status === 'pending') {
    return { type: 'GetDelegationSignatureMessageResult', ok: true, status: 'pending' };
  }
  if (row.status === 'rejected') {
    return { type: 'GetDelegationSignatureMessageResult', ok: true, status: 'rejected' };
  }
  if (row.status === 'approved') {
    return {
      type: 'GetDelegationSignatureMessageResult',
      ok: true,
      status: 'approved',
      signature: row.signature,
      pubkeyHex: row.pubkeyHex,
      message: row.message
    };
  }
  return { type: 'GetDelegationSignatureMessageResult', ok: true, status: row.status || 'unknown' };
}

/**
 * Completes delegation signing. Caller must know `sessionId` (delegation token); the Hub verifies it
 * matches the pending message row. Same-origin browsers and Electron use POST /services/rpc; loopback
 * is not required — possession of the token is the capability.
 * @param {import('../services/hub')} hub
 * @param {object} p
 */
async function resolveDelegationSignatureMessage (hub, p) {
  resolveRegistry(hub);
  pruneDelegationMessages(hub);
  const sessionId = p && typeof p.sessionId === 'string' ? p.sessionId.trim() : '';
  const messageId = p && typeof p.messageId === 'string' ? p.messageId.trim() : '';
  const status = p && typeof p.status === 'string' ? p.status.trim().toLowerCase() : '';
  if (!sessionId || !messageId) {
    throw new Error('sessionId and messageId required');
  }
  if (status !== 'approved' && status !== 'rejected') {
    throw new Error('status must be approved or rejected');
  }
  const row = hub._delegationSignatureMessages.get(messageId);
  if (!row || row.status !== 'pending') {
    throw new Error('unknown or stale delegation message');
  }
  if (row.token !== sessionId) {
    throw new Error('message does not belong to this session');
  }
  if (status === 'rejected') {
    row.status = 'rejected';
    row.resolvedAt = Date.now();
    if (typeof hub._appendFabricMessage === 'function') {
      await hub._appendFabricMessage('DELEGATION_SIGNATURE_RESOLUTION', {
        parentMessageId: messageId,
        delegationSessionId: sessionId,
        status: 'rejected'
      });
    }
    return { type: 'ResolveDelegationSignatureMessageResult', ok: true, messageId, status: 'rejected' };
  }
  if (!hub._rootKey || !hub._rootKey.private) {
    throw new Error('Hub identity has no private key');
  }
  const msgBuf = Buffer.from(row.message, 'utf8');
  const signature = hub._rootKey.signSchnorr(msgBuf);
  const pubkeyHex = typeof hub._rootKey.pubkey === 'string'
    ? hub._rootKey.pubkey
    : Buffer.from(hub._rootKey.pubkey || []).toString('hex');
  row.status = 'approved';
  row.signature = signature.toString('hex');
  row.pubkeyHex = pubkeyHex;
  row.resolvedAt = Date.now();
  if (typeof hub._appendFabricMessage === 'function') {
    await hub._appendFabricMessage('DELEGATION_SIGNATURE_RESOLUTION', {
      parentMessageId: messageId,
      delegationSessionId: sessionId,
      status: 'approved',
      signatureHex: row.signature,
      pubkeyHex
    });
  }
  return {
    type: 'ResolveDelegationSignatureMessageResult',
    ok: true,
    messageId,
    status: 'approved',
    signature: row.signature,
    pubkeyHex,
    message: row.message
  };
}

function summarizeFabricPayload (type, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (type === 'DELEGATION_SIGNATURE_REQUEST') {
    return {
      preview: typeof p.preview === 'string' ? p.preview : null,
      purpose: typeof p.purpose === 'string' ? p.purpose : null,
      status: typeof p.status === 'string' ? p.status : null,
      origin: p.origin != null ? String(p.origin) : null
    };
  }
  if (type === 'DELEGATION_SIGNATURE_RESOLUTION') {
    const sig = typeof p.signatureHex === 'string' ? p.signatureHex : '';
    return {
      parentMessageId: typeof p.parentMessageId === 'string' ? p.parentMessageId : null,
      status: typeof p.status === 'string' ? p.status : null,
      pubkeyHex: typeof p.pubkeyHex === 'string' ? p.pubkeyHex : null,
      signatureHex: sig ? `${sig.slice(0, 16)}…${sig.slice(-8)}` : null
    };
  }
  return {};
}

/**
 * GET /sessions/:sessionId/delegation/audit — Bearer must equal sessionId (delegation token).
 * Returns session row, pending queue, filtered Fabric log entries, Hub public key for verification UX.
 */
function handleDelegationAudit (hub, req, res) {
  try {
    if (serveSpaShellIfHtmlNavigation(hub, req, res)) return;
    resolveRegistry(hub);
    pruneDelegationMessages(hub);
    const sessionId = req && req.params && req.params.sessionId ? String(req.params.sessionId).trim() : '';
    const bearer = getBearerToken(req);
    if (!sessionId || bearer !== sessionId) {
      sendJson(res, 403, { ok: false, error: 'Authorization: Bearer <sessionToken> required' });
      return;
    }
    if (!hub._delegationRegistry.has(sessionId)) {
      sendJson(res, 404, { ok: false, error: 'unknown session' });
      return;
    }
    const row = hub._delegationRegistry.get(sessionId);
    const pending = [];
    for (const [mid, r] of hub._delegationSignatureMessages) {
      if (r && r.token === sessionId && r.status === 'pending') {
        pending.push({
          messageId: mid,
          preview: r.preview,
          purpose: r.purpose,
          createdAt: r.createdAt
        });
      }
    }
    const fabricLog = [];
    const msgs = typeof hub._getFabricMessages === 'function' ? hub._getFabricMessages() : [];
    for (const m of msgs) {
      const t = m && m.type;
      if (t !== 'DELEGATION_SIGNATURE_REQUEST' && t !== 'DELEGATION_SIGNATURE_RESOLUTION') continue;
      const p = m.payload || {};
      const ds = p.delegationSessionId != null ? String(p.delegationSessionId) : '';
      if (ds !== sessionId) continue;
      fabricLog.push({
        id: m.id,
        seq: m.seq,
        type: t,
        created: m.created,
        summary: summarizeFabricPayload(t, p)
      });
    }
    let hubPubkeyHex = null;
    let hubIdentityId = null;
    try {
      if (hub._rootKey) {
        hubPubkeyHex = typeof hub._rootKey.pubkey === 'string'
          ? hub._rootKey.pubkey
          : Buffer.from(hub._rootKey.pubkey || []).toString('hex');
      }
      if (hub.identity && hub.identity.id != null) hubIdentityId = String(hub.identity.id);
      else if (hub.agent && hub.agent.identity && hub.agent.identity.id != null) hubIdentityId = String(hub.agent.identity.id);
    } catch (_) {}
    sendJson(res, 200, {
      ok: true,
      session: {
        id: sessionId.slice(0, 12) + '…',
        origin: row.origin,
        linkedAt: row.linkedAt,
        label: row.label || 'browser',
        identityId: row.identityId != null ? String(row.identityId) : null,
        externalSigning: true
      },
      pending,
      fabricLog,
      hubIdentityId,
      hubPubkeyHex
    });
  } catch (err) {
    console.error('[HUB:DELEGATION:AUDIT]', err && err.stack ? err.stack : err);
    sendJson(res, 500, { ok: false, error: 'audit failed' });
  }
}

function mountFabricDelegationHttp (hub) {
  hub.http._addRoute('GET', '/sessions/:sessionId/delegation/audit', (req, res) => handleDelegationAudit(hub, req, res));
  hub.http._addRoute('GET', '/sessions', (req, res) => handleSessionsList(hub, req, res));
  hub.http._addRoute('DELETE', '/sessions/:sessionId', (req, res) => handleSessionByIdDestroy(hub, req, res));
}

module.exports = {
  SIGNATURE_MESSAGE_TTL_MS,
  getDelegationSessionById,
  mountFabricDelegationHttp,
  postDelegationSignatureMessage,
  getDelegationSignatureMessage,
  resolveDelegationSignatureMessage,
  handleDelegationAudit
};
