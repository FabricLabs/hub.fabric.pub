'use strict';

/**
 * Thin re-export — invite JSON parse/build lives in `@fabric/http`.
 * Keep JSON bridges out of `@fabric/core`; Hub and applications share one shape.
 *
 * Stamps `expiresAt` (default 7 days) when the http pin's builder does not yet
 * know the field. Current pins already stamp; this wrapper probes and collapses
 * to the bare http module (same pattern as `fabricChatNormalize.js`).
 *
 * @see @fabric/http/functions/federationContractInvite
 */

const http = require('@fabric/http/functions/federationContractInvite');

const DEFAULT_FEDERATION_INVITE_TTL_MS = http.DEFAULT_FEDERATION_INVITE_TTL_MS
  || (7 * 24 * 60 * 60 * 1000);

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function positiveEpochMs (value) {
  if (typeof http.positiveEpochMs === 'function') return http.positiveEpochMs(value);
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stampExpiresAt (doc, fields) {
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.expiresAt != null && doc.expiresAt !== '') return doc;
  // Match http: Number(null)/''/0 are finite but not positive timestamps.
  const invitedAt = positiveEpochMs(doc.invitedAt) ?? Date.now();
  if (fields && fields.expiresAt != null && fields.expiresAt !== '') {
    const n = typeof fields.expiresAt === 'number'
      ? fields.expiresAt
      : Date.parse(fields.expiresAt);
    if (Number.isFinite(n) && n > 0) {
      doc.expiresAt = Math.floor(n);
      return doc;
    }
  }
  let ttl = DEFAULT_FEDERATION_INVITE_TTL_MS;
  if (fields && fields.ttlMs != null && Number.isFinite(Number(fields.ttlMs))) {
    ttl = Math.max(1, Math.floor(Number(fields.ttlMs)));
  }
  doc.expiresAt = invitedAt + ttl;
  return doc;
}

function buildFederationContractInviteJson (fields) {
  const json = http.buildFederationContractInviteJson(fields);
  const doc = JSON.parse(json);
  stampExpiresAt(doc, fields);
  return JSON.stringify(doc);
}

function buildFederationContractInvite (fields) {
  return JSON.parse(buildFederationContractInviteJson(fields));
}

function pinStampsExpiresAt () {
  try {
    const json = http.buildFederationContractInviteJson({
      inviteId: 'probe-expires',
      inviterHubId: 'deadbeef',
      invitedAt: 99
    });
    const doc = JSON.parse(json);
    return !!(doc && Number.isFinite(doc.expiresAt) && doc.expiresAt > 0);
  } catch (_) {
    return false;
  }
}

module.exports = pinStampsExpiresAt()
  ? http
  : Object.assign({}, http, {
    DEFAULT_FEDERATION_INVITE_TTL_MS,
    positiveEpochMs,
    buildFederationContractInviteJson,
    buildFederationContractInvite
  });
