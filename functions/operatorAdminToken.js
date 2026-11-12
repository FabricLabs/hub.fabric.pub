'use strict';

/**
 * Hub operator admin tokens (Schnorr `OP_IDENTITY` / `sub=admin`).
 *
 * Tokens are signed by the Hub identity key — `m/44'/F'/0'/0/0` of
 * `FABRIC_XPRV` on the Hub's network, the Fabric Peer identity — never by the
 * master itself (`functions/hubAccount.js` `hubServerKeys`).
 */

const Token = require('@fabric/core/types/token');

/**
 * @param {string} token
 * @param {object|object[]} keys Fabric {@link Key} instances
 * @returns {object|null} Signed payload when the token is a valid operator admin token
 */
function tokenPayloadIfOperatorAdmin (token, keys) {
  const t = String(token || '').trim();
  if (!t) return null;
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!key) continue;
    const payload = Token.verifySigned(t, key);
    if (!payload || typeof payload !== 'object') continue;
    const cap = payload.cap || payload.capability;
    const sub = payload.sub || payload.subject;
    if (cap === 'OP_IDENTITY' && sub === 'admin') return payload;
  }
  return null;
}

/**
 * @param {string} token
 * @param {object|object[]} keys
 * @returns {boolean}
 */
function isOperatorAdminToken (token, keys) {
  return tokenPayloadIfOperatorAdmin(token, keys) != null;
}

module.exports = {
  tokenPayloadIfOperatorAdmin,
  isOperatorAdminToken
};
