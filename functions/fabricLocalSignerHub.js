'use strict';

/**
 * Hub as a local signing authority for Passport v2 (`@fabric/http` local signer):
 * `GET /services/fabric/identity`, `POST /services/fabric/sign`, and
 * `POST /services/fabric/link` on loopback, for Passport's extension origin only.
 *
 * The desktop identity is the identity key of the Hub operator's account for the
 * challenge's network (`functions/hubAccount.js`), the same key the Hub
 * cross-signs device links with. A device may ask only once it is in that key's
 * identity cluster, and every sign-in or link waits for a native dialog in the
 * Electron main process (`scripts/desktop.js`, over parentPort). The web UI is
 * never the approver: any script on the Hub origin could drive it. A CLI Hub
 * has no dialog, so it does not mount these routes.
 *
 * Chrome builds of Passport are pinned by id (`FABRIC_PASSPORT_EXTENSION_IDS`
 * or `settings.passport.extensionIds`); any Firefox build may ask.
 */

const crypto = require('crypto');
const Identity = require('@fabric/core/types/identity');
const { ensureCluster, ingestIdentityCrossSign } = require('./identityClusterHttp');
const { signCrossSign } = require('./identityCrossSignVerify');
const { pubkeysMatch } = require('./fabricPubkey');
const { APPROVAL_REQUEST, APPROVAL_RESULT } = require('./fabricSignApprovalDialog');
const { hubAccount, hubNetwork } = require('./hubAccount');

const MAX_APPROVAL_MS = 2 * 60 * 1000;

function loadLocalSigner () {
  try {
    return require('@fabric/http/functions/fabricLocalSigner');
  } catch (_) {
    return null;
  }
}

/**
 * Ask the Electron main process to show the approval dialog. The dialog closes
 * when the request expires.
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
        kind: prompt.kind === 'link' ? 'link' : 'sign',
        origin: prompt.origin || null,
        purpose: prompt.purpose || null,
        label: prompt.label || null,
        device: prompt.device || null,
        network: prompt.network || null,
        account: prompt.account != null ? prompt.account : null,
        shares: Array.isArray(prompt.shares) ? prompt.shares : null,
        code: prompt.code || null,
        expiresAt
      });
    });
  };
}

function hubHttpPort (hub) {
  return Number((hub.settings && hub.settings.http && hub.settings.http.port) || 8080);
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

/**
 * The Hub's Fabric identity for one network (account 0), or null without a private master key.
 * @param {object} hub
 * @param {string} [network]
 * @returns {object|null}
 */
function hubFabricIdentity (hub, network) {
  const account = hubAccount(hub, { network: network || hubNetwork(hub) });
  if (!account) return null;
  if (!hub._fabricSigningIdentities) hub._fabricSigningIdentities = new Map();
  const cached = hub._fabricSigningIdentities.get(account.identity.pubkey);
  if (cached) return cached;
  const identity = new Identity(account.identity.key);
  hub._fabricSigningIdentities.set(account.identity.pubkey, identity);
  return identity;
}

/**
 * Mount the local signer on the Hub HTTP server.
 * @param {object} hub
 * @param {object} [opts]
 * @param {Function} [opts.approve] Override the approval prompt (tests)
 * @param {object} [opts.port] parentPort override
 * @param {object} [opts.env]
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
  const port = hubHttpPort(hub);
  const network = hubNetwork(hub);
  // Accepting a link without publishing our half of the cross-sign would leave it half done.
  const canLink = typeof signCrossSign === 'function';

  const signer = lib.createFabricLocalSigner({
    signer: 'hub',
    name: (hub.settings && hub.settings.alias) || 'Fabric Hub',
    network,
    extensionIds: passportExtensionIds(hub, opts.env),
    getAccount: ({ network: asked, account }) => hubAccount(hub, { network: asked, account }),
    linkedDevice: (xOnly) => {
      const identity = hubFabricIdentity(hub, network);
      if (!identity) return null;
      const own = identity.fabricKey.pubkey;
      if (pubkeysMatch(own, xOnly)) return null;
      const cluster = ensureCluster(hub);
      if (!cluster.clusterEquals(own, xOnly)) return null;
      return cluster.compressedOf(xOnly);
    },
    approve,
    linkBase: canLink ? () => `http://127.0.0.1:${port}` : null,
    onLinkAccepted: ({ peerPubkey, nonce, sessionId, origin }) => {
      const identity = hubFabricIdentity(hub, network);
      if (!identity) return;
      const object = signCrossSign(identity, { peerPubkey, nonce, sessionId, origin });
      ingestIdentityCrossSign(hub, object, object.pubkeyHex, { relay: true });
    }
  });

  const paths = [lib.FABRIC_IDENTITY_PATH, lib.FABRIC_SIGN_PATH].concat(canLink ? [lib.FABRIC_LINK_PATH] : []);
  for (const pathname of paths) {
    const method = pathname === lib.FABRIC_IDENTITY_PATH ? 'GET' : 'POST';
    hub.http._addRoute(method, pathname, (req, res) => signer.handle(req, res, pathname));
  }
  hub._fabricLocalSigner = signer;
  console.log('[HUB] Passport local signer on', paths.join(', '));
  return signer;
}

module.exports = {
  createParentPortApprover,
  passportExtensionIds,
  hubFabricIdentity,
  mountFabricLocalSignerHub
};
