'use strict';

/**
 * Hub as a local signing authority for Passport (`@fabric/http` local signer):
 * `GET /services/fabric/identity`, `POST /services/fabric/sign`, and
 * `POST /services/fabric/link` on loopback only.
 *
 * The desktop identity is the Fabric key of the Hub operator key (`_rootKey`),
 * the same key the Hub cross-signs with. A device may ask only once it is in
 * that key's identity cluster, and every sign-in or link waits for a native
 * dialog in the Electron main process (`scripts/desktop.js`, over parentPort).
 * The web UI is never the approver: any script on the Hub origin could drive it.
 * A CLI Hub has no dialog, so it does not mount these routes.
 */

const crypto = require('crypto');
const Identity = require('@fabric/core/types/identity');
const { ensureCluster, ingestIdentityCrossSign } = require('./identityClusterHttp');
const { signCrossSign } = require('./identityCrossSignVerify');
const { pubkeysMatch } = require('./fabricPubkey');
const { APPROVAL_REQUEST, APPROVAL_RESULT } = require('./fabricSignApprovalDialog');

const MAX_APPROVAL_MS = 2 * 60 * 1000;

function loadLocalSigner () {
  try {
    return require('@fabric/http/functions/fabricLocalSigner');
  } catch (_) {
    return null;
  }
}

/**
 * Ask the Electron main process to show the approval dialog.
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
        kind: prompt.kind === 'link' ? 'link' : 'sign',
        origin: prompt.origin || null,
        purpose: prompt.purpose || null,
        device: prompt.device || null,
        expiresAt: prompt.expiresAt || null
      });
    });
  };
}

function hubHttpPort (hub) {
  return Number((hub.settings && hub.settings.http && hub.settings.http.port) || 8080);
}

/**
 * Origins that are this Hub: Passport may hand them the Hub xpub with a login.
 * @param {object} hub
 * @returns {Set<string>}
 */
function hubOwnOrigins (hub) {
  const port = hubHttpPort(hub);
  const out = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`
  ]);
  const extra = [
    process.env.FABRIC_HUB_PUBLIC_ORIGIN,
    hub.settings && hub.settings.payjoin && hub.settings.payjoin.publicOrigin
  ];
  for (const raw of extra) {
    try {
      if (raw) out.add(new URL(String(raw)).origin);
    } catch (_) {}
  }
  return out;
}

/**
 * The Hub's Fabric identity (derived from `_rootKey`), or null without a private key.
 * @param {object} hub
 * @returns {object|null}
 */
function hubFabricIdentity (hub) {
  if (!hub._rootKey || !hub._rootKey.private) return null;
  if (!hub._fabricSigningIdentity || hub._fabricSigningIdentityRoot !== hub._rootKey) {
    hub._fabricSigningIdentity = new Identity(hub._rootKey);
    hub._fabricSigningIdentityRoot = hub._rootKey;
  }
  return hub._fabricSigningIdentity;
}

/**
 * Mount the local signer on the Hub HTTP server.
 * @param {object} hub
 * @param {object} [opts]
 * @param {Function} [opts.approve] Override the approval prompt (tests)
 * @param {object} [opts.port] parentPort override
 * @returns {object|null} the signer, or null when not mounted
 */
function mountFabricLocalSignerHub (hub, opts = {}) {
  const lib = loadLocalSigner();
  if (!lib) {
    console.warn('[HUB] Passport local signer off: installed @fabric/http has no functions/fabricLocalSigner (npm run link:fabric)');
    return null;
  }
  const approve = opts.approve || createParentPortApprover(opts.port);
  if (!approve) return null;
  const ownOrigins = hubOwnOrigins(hub);
  const port = hubHttpPort(hub);
  // Accepting a link without publishing our half of the cross-sign would leave it half done.
  const canLink = typeof signCrossSign === 'function';

  const signer = lib.createFabricLocalSigner({
    signer: 'hub',
    name: (hub.settings && hub.settings.alias) || 'Fabric Hub',
    getKey: () => {
      const identity = hubFabricIdentity(hub);
      return identity ? identity.fabricKey : null;
    },
    isLinkedDevice: (pubkey) => {
      const identity = hubFabricIdentity(hub);
      if (!identity) return false;
      const own = identity.fabricKey.pubkey;
      if (pubkeysMatch(own, pubkey)) return false;
      return ensureCluster(hub).clusterEquals(own, pubkey);
    },
    approve,
    includeXpub: (origin) => ownOrigins.has(origin),
    linkBase: canLink ? () => `http://127.0.0.1:${port}` : null,
    onLinkAccepted: ({ peerPubkey, nonce }) => {
      const identity = hubFabricIdentity(hub);
      if (!identity) return;
      const object = signCrossSign(identity, { peerPubkey, nonce });
      ingestIdentityCrossSign(hub, object, object.pubkeyHex, { relay: true });
    }
  });

  const paths = [lib.FABRIC_IDENTITY_PATH, lib.FABRIC_SIGN_PATH];
  hub.http._addRoute('GET', lib.FABRIC_IDENTITY_PATH, (req, res) => signer.handle(req, res, lib.FABRIC_IDENTITY_PATH));
  hub.http._addRoute('POST', lib.FABRIC_SIGN_PATH, (req, res) => signer.handle(req, res, lib.FABRIC_SIGN_PATH));
  if (canLink && lib.FABRIC_LINK_PATH) {
    paths.push(lib.FABRIC_LINK_PATH);
    hub.http._addRoute('POST', lib.FABRIC_LINK_PATH, (req, res) => signer.handle(req, res, lib.FABRIC_LINK_PATH));
  }
  hub._fabricLocalSigner = signer;
  console.log('[HUB] Passport local signer on', paths.join(', '));
  return signer;
}

module.exports = {
  createParentPortApprover,
  hubOwnOrigins,
  hubFabricIdentity,
  mountFabricLocalSignerHub
};
