'use strict';

/**
 * @fileoverview Mount the Hub's delegation (`services/delegation.js`) on its HTTP server.
 *
 * Public (any caller):
 * - `/delegations…` pairing rendezvous (`@fabric/http` fabricDelegationHttp)
 * - `/services/delegation/mailbox` (`@fabric/http` fabricDelegationMailbox)
 *
 * Loopback, Passport's extension origin only (`@fabric/http` fabricDelegate):
 * - `GET /services/delegation`, `POST /services/delegation/links`,
 *   `POST /services/delegation/requests`, `GET /services/delegation/requests/:hash`
 *
 * Operator (`Authorization: Bearer <admin token>`):
 * - `GET /services/delegation/requests` waiting requests
 * - `POST /services/delegation/requests/:hash/sign|decline`
 * - `GET|PUT /services/delegation/rules`, `GET /services/delegation/decisions`
 * - `GET /services/delegation/signers`, `POST /services/delegation/grants/:hash/revoke`
 *
 * Pairing needs the native dialog of the desktop shell (`scripts/desktop.js`,
 * over parentPort): a CLI Hub answers no pairing, so it gives no grants, but
 * keeps the rendezvous, the mailbox, and requests from signers paired before.
 */

const crypto = require('crypto');
const HubDelegation = require('../services/delegation');
const { APPROVAL_REQUEST, APPROVAL_RESULT } = require('./fabricSignApprovalDialog');
const { hubAccount, hubNetwork } = require('./hubAccount');
const { hubPinnedOrigins } = require('./hubPassport');

const MAX_APPROVAL_MS = 2 * 60 * 1000;
const MAX_BODY = 256 * 1024;
const HASH = /^[0-9a-f]{64}$/;

/**
 * Ask the Electron main process to show the approval dialog. The dialog
 * closes when the request expires.
 * @param {object} [port] `process.parentPort`
 * @returns {Function|null} `(prompt) => Promise<boolean>`
 */
function createParentPortApprover (port = process.parentPort) {
  if (!port || typeof port.postMessage !== 'function') return null;
  const waiting = new Map();
  port.on('message', (event) => {
    const msg = event && event.data;
    if (!msg || msg.type !== APPROVAL_RESULT) return;
    const done = waiting.get(msg.id);
    if (done) done(msg.approved === true);
  });
  return function approve (prompt) {
    const id = crypto.randomBytes(16).toString('hex');
    const ms = Math.max(1000, Math.min(MAX_APPROVAL_MS, Number(prompt.expiresAt || 0) - Date.now()));
    const expiresAt = Date.now() + ms;
    return new Promise((resolve) => {
      const finish = (approved) => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(approved);
      };
      const timer = setTimeout(() => finish(false), ms);
      waiting.set(id, finish);
      port.postMessage({
        type: APPROVAL_REQUEST,
        id,
        kind: ['link', 'request'].includes(prompt.kind) ? prompt.kind : 'sign',
        origin: prompt.origin || null,
        purpose: prompt.purpose || null,
        title: prompt.title || null,
        summary: prompt.summary || null,
        label: prompt.label || null,
        from: prompt.from || null,
        network: prompt.network || null,
        account: prompt.account != null ? prompt.account : null,
        shares: Array.isArray(prompt.shares) ? prompt.shares : null,
        code: prompt.code || null,
        expiresAt
      });
    });
  };
}

/**
 * Chrome extension ids of Passport builds this Hub answers.
 * @param {object} hub
 * @param {object} [env]
 * @returns {string[]}
 */
function passportExtensionIds (hub, env = process.env) {
  const fromSettings = (hub.settings && hub.settings.passport && hub.settings.passport.extensionIds) || [];
  const fromEnv = String(env.FABRIC_PASSPORT_EXTENSION_IDS || '').split(',');
  return [...new Set([].concat(fromSettings, fromEnv).map((id) => String(id || '').trim()).filter(Boolean))];
}

/** @private */
function sendJson (res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** @private */
function readJson (req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** @private */
function bearer (req) {
  const header = String((req.headers && req.headers.authorization) || '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

/** @private */
function param (req, name, pattern) {
  const value = req.params && req.params[name] != null ? String(req.params[name]).toLowerCase() : '';
  return pattern.test(value) ? value : null;
}

/**
 * Mount delegation on the Hub.
 * @param {object} hub
 * @param {Object} [opts]
 * @param {Function} [opts.approve] Override the native dialog (tests).
 * @param {object} [opts.port] parentPort override.
 * @param {object} [opts.env]
 * @param {string} [opts.dir] Store directory (`stores/hub`); in memory when omitted.
 * @returns {HubDelegation|null} null when the Hub has no private identity key.
 */
function mountFabricDelegateHub (hub, opts = {}) {
  const network = hubNetwork(hub);
  const account = hubAccount(hub, { network });
  const key = (account && account.identity && account.identity.key) || hub._fabricKey;
  if (!key || !key.private) {
    console.warn('[HUB] delegation off: the Hub has no private identity key');
    return null;
  }
  const cosignerKey = hub._cosignerKey || (account && account.cosigner && account.cosigner.key) || null;
  const env = opts.env || process.env;
  const approve = opts.approve || createParentPortApprover(opts.port);
  const dir = opts.dir || null;
  const service = new HubDelegation({
    key,
    cosignerKey,
    network,
    dir,
    name: (hub.settings && hub.settings.alias) || 'Fabric Hub',
    getAccount: ({ network: asked, account: index }) => hubAccount(hub, { network: asked, account: index }),
    federations: hub.federations && !(hub.settings && hub.settings.namedFederations && hub.settings.namedFederations.enable === false) ? hub.federations : null,
    approve,
    origins: hubPinnedOrigins(hub, env),
    extensionIds: passportExtensionIds(hub, env)
  });
  service.on('warning', (msg) => console.warn('[HUB]', msg));
  service.on('notification', (n) => console.log(`[HUB:DELEGATION] ${n.title} — waiting for the operator (${String(n.hash).slice(0, 12)}…)`));
  service.on('decided', (d) => console.log(`[HUB:DELEGATION] rule ${d.rule || '-'} ${d.action === 'sign' ? 'signed' : 'declined'}: ${d.title || d.scope}`));

  service.rendezvous.mountOnHub(hub);
  service.mailbox.mountOnHub(hub);

  const delegateRoute = (req, res) => {
    if (!service.delegate.handle(req, res, req.path || undefined)) sendJson(res, 404, { ok: false, error: 'not found' });
  };
  hub.http._addRoute('GET', '/services/delegation', delegateRoute);
  hub.http._addRoute('POST', '/services/delegation/links', delegateRoute);

  const admin = (fn) => (req, res) => {
    if (!hub._verifyOperatorAdminToken(bearer(req))) return sendJson(res, 401, { ok: false, error: 'admin token required' });
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => { if (out) sendJson(res, out.status || 200, out.json || out); })
      .catch((err) => sendJson(res, err.status || 500, { ok: false, error: err.message || 'failed' }));
  };

  hub.http._addRoute('GET', '/services/delegation/requests', admin(async () => ({ json: { ok: true, requests: await service.pending() } })));
  hub.http._addRoute('POST', '/services/delegation/requests', delegateRoute);
  hub.http._addRoute('GET', '/services/delegation/requests/:hash', delegateRoute);
  for (const action of ['sign', 'decline']) {
    hub.http._addRoute('POST', `/services/delegation/requests/:hash/${action}`, admin(async (req) => {
      const hash = param(req, 'hash', HASH);
      if (!hash) return { status: 400, json: { ok: false, error: 'request hash required' } };
      const body = await readJson(req);
      const reason = action === 'decline' && typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'declined by the operator';
      return service.answer(hash, action, { reason });
    }));
  }
  hub.http._addRoute('GET', '/services/delegation/rules', admin(() => ({ json: Object.assign({ ok: true }, service.rules.list()) })));
  hub.http._addRoute('PUT', '/services/delegation/rules', admin(async (req) => {
    const body = await readJson(req);
    if (!Array.isArray(body.rules)) return { status: 400, json: { ok: false, error: 'rules must be a list' } };
    return { json: Object.assign({ ok: true }, service.rules.set(body.rules)) };
  }));
  hub.http._addRoute('GET', '/services/delegation/decisions', admin((req) => ({
    json: { ok: true, decisions: service.rules.decisions(req.query && req.query.limit) }
  })));
  hub.http._addRoute('GET', '/services/delegation/signers', admin(async () => ({ json: Object.assign({ ok: true }, await service.signers()) })));
  hub.http._addRoute('POST', '/services/delegation/grants/:hash/revoke', admin(async (req) => {
    const hash = param(req, 'hash', HASH);
    if (!hash) return { status: 400, json: { ok: false, error: 'grant hash required' } };
    return { json: await service.revoke(hash) };
  }));

  hub.delegation = service;
  console.log(`[HUB] delegation on: rendezvous, mailbox, and ${approve ? 'the local delegate with pairing' : 'the local delegate (pairing needs the desktop app)'}`);
  return service;
}

module.exports = {
  createParentPortApprover,
  passportExtensionIds,
  mountFabricDelegateHub
};
