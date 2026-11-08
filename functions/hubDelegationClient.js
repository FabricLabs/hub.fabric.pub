'use strict';

/**
 * @fileoverview Browser client for the Hub operator's delegation routes
 * (`functions/fabricDelegateHub.js`): requests waiting on the operator,
 * signer rules, recent decisions, linked signers. Every call needs the admin token.
 */

const BASE = '/services/delegation';

/** @private */
async function call (adminToken, method, path, body) {
  const token = String(adminToken || '').trim();
  if (!token) throw new Error('admin token required');
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: Object.assign(
      { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body !== undefined ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status, body: json });
  }
  return json;
}

/**
 * Requests from linked signers waiting on the operator.
 * @param {string} adminToken
 * @returns {Promise<Array<Object>>}
 */
async function listDelegationRequests (adminToken) {
  return (await call(adminToken, 'GET', '/requests')).requests || [];
}

/**
 * Sign or decline a waiting request.
 * @param {string} adminToken
 * @param {string} hash Request frame hash.
 * @param {string} action `sign` or `decline`.
 * @returns {Promise<Object>}
 */
async function answerDelegationRequest (adminToken, hash, action) {
  if (action !== 'sign' && action !== 'decline') throw new Error('sign or decline');
  return call(adminToken, 'POST', `/requests/${encodeURIComponent(hash)}/${action}`, {});
}

/**
 * Signer rules: `{ rules, valid, invalid }`.
 * @param {string} adminToken
 * @returns {Promise<Object>}
 */
async function getSignerRules (adminToken) {
  return call(adminToken, 'GET', '/rules');
}

/**
 * Replace the signer rules.
 * @param {string} adminToken
 * @param {Array<Object>} rules
 * @returns {Promise<Object>} `{ rules, valid, invalid }`
 */
async function putSignerRules (adminToken, rules) {
  return call(adminToken, 'PUT', '/rules', { rules });
}

/**
 * Recent decisions, newest first.
 * @param {string} adminToken
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
async function listSignerDecisions (adminToken, limit = 50) {
  return (await call(adminToken, 'GET', `/decisions?limit=${Number(limit) || 50}`)).decisions || [];
}

/**
 * Linked signers: pairings and grants both ways.
 * @param {string} adminToken
 * @returns {Promise<Object>}
 */
async function getLinkedSigners (adminToken) {
  return call(adminToken, 'GET', '/signers');
}

/**
 * Revoke a grant this Hub gave.
 * @param {string} adminToken
 * @param {string} hash
 * @returns {Promise<Object>}
 */
async function revokeSignerGrant (adminToken, hash) {
  return call(adminToken, 'POST', `/grants/${encodeURIComponent(hash)}/revoke`, {});
}

module.exports = {
  listDelegationRequests,
  answerDelegationRequest,
  getSignerRules,
  putSignerRules,
  listSignerDecisions,
  getLinkedSigners,
  revokeSignerGrant
};
