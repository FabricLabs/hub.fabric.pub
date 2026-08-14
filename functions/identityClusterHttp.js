'use strict';

/**
 * Hub HTTP for identity clusters (D-013 network artifact).
 * GET  /identity/cluster
 * POST /identity/cross-sign  (pre-signed IdentityCrossSign / IdentityCrossSignRevoke)
 *
 * HTTP ingest stores the BIP340-signed object as a Fabric message and relays
 * a CONTRACT_MESSAGE so later peers can verify the link without re-pairing.
 */

const Message = require('@fabric/core/types/message');
const IdentityCluster = require('./identityCluster');
const { verifyCrossSignObject, signCrossSign } = require('./identityCrossSignVerify');

const CLUSTER_DOC = 'identity/CLUSTER';
const PROOFS_DOC = 'identity/CROSS-SIGNS';

function ensureCluster (hub) {
  if (!hub.identityCluster) hub.identityCluster = new IdentityCluster();
  return hub.identityCluster;
}

function persistCluster (hub) {
  const cluster = ensureCluster(hub);
  if (!hub.fs || typeof hub.fs.publish !== 'function') return;
  try {
    void hub.fs.publish(CLUSTER_DOC, cluster.toJSON());
  } catch (_) { /* ignore */ }
}

function persistProof (hub, object, kind) {
  if (!hub.fs || typeof hub.fs.publish !== 'function' || !object) return;
  const list = Array.isArray(hub._identityCrossSignProofs) ? hub._identityCrossSignProofs : [];
  list.push(Object.assign({ storedAt: new Date().toISOString(), kind }, object));
  while (list.length > 256) list.shift();
  hub._identityCrossSignProofs = list;
  try {
    void hub.fs.publish(PROOFS_DOC, { proofs: list });
  } catch (_) { /* ignore */ }
}

function relayIdentityCrossSign (hub, object) {
  if (!object || typeof object !== 'object') return;
  const type = object.type || object['@type'] || IdentityCluster.SIGN_TYPE;
  const contract = (hub.contract && hub.contract.id) ? String(hub.contract.id) : 'identity-cluster';
  const body = {
    contract,
    type,
    actor: { publicKey: object.pubkeyHex || object.localPubkey },
    object
  };
  let msg = null;
  try {
    msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
    if (hub._rootKey && hub._rootKey.private) msg.signWithKey(hub._rootKey);
  } catch (_) {
    msg = null;
  }
  if (msg && hub.agent && typeof hub.agent.relayFrom === 'function') {
    try { hub.agent.relayFrom('_hub', msg); } catch (_) { /* ignore */ }
  }
  if (typeof hub._appendFabricMessage === 'function') {
    try { void hub._appendFabricMessage(type, object); } catch (_) { /* ignore */ }
  }
  if (msg && typeof hub._enqueueOpaqueContractMessage === 'function') {
    try {
      hub._enqueueOpaqueContractMessage({
        contract,
        object: body,
        wireMessage: msg,
        messageHex: typeof msg.toBuffer === 'function' ? msg.toBuffer().toString('hex') : null,
        signer: object.pubkeyHex || object.localPubkey
      });
    } catch (_) { /* ignore */ }
  }
}

function ingest (hub, object, signer, opts = {}) {
  const checked = verifyCrossSignObject(object, signer);
  if (!checked.ok) return { ok: false, error: checked.error };
  const cluster = ensureCluster(hub);
  if (checked.kind === IdentityCluster.REVOKE_TYPE) {
    cluster.ingestRevoke(checked.record);
  } else {
    cluster.ingestCrossSign(checked.record);
  }
  persistProof(hub, object, checked.kind);
  persistCluster(hub);
  if (opts.relay) relayIdentityCrossSign(hub, object);
  return { ok: true, kind: checked.kind, record: checked.record };
}

function sendJson (res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  if (typeof res.status === 'function') res.status(status).send(JSON.stringify(obj));
  else {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }
}

function handleClusterGet (hub, req, res) {
  const cluster = ensureCluster(hub);
  const q = (req.query && req.query.pubkey) ||
    (hub.identity && hub.identity.pubkey) ||
    (hub.agent && hub.agent.key && hub.agent.key.pubkey);
  sendJson(res, 200, { type: 'IdentityCluster', data: cluster.snapshot(q) });
}

function handleCrossSignPost (hub, req, res) {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const kind = body.type || body['@type'] || IdentityCluster.SIGN_TYPE;
  if (body.signature && body.identity) {
    const rec = ingest(hub, body, body.pubkeyHex || body.localPubkey, { relay: true });
    if (!rec.ok) return sendJson(res, 400, { ok: false, error: rec.error });
    return sendJson(res, 200, { type: rec.kind, data: rec.record });
  }
  const ident = hub._unlockedIdentity || null;
  if (!ident) return sendJson(res, 401, { ok: false, error: 'Unlock your identity' });
  try {
    const obj = signCrossSign(ident, { peerPubkey: body.peerPubkey, nonce: body.nonce }, kind);
    const rec = ingest(hub, obj, ident.pubkey, { relay: true });
    if (!rec.ok) return sendJson(res, 400, { ok: false, error: rec.error });
    return sendJson(res, 200, { type: rec.kind, data: rec.record });
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message || String(e) });
  }
}

function mountIdentityClusterHttp (hub) {
  ensureCluster(hub);
  hub.http._addRoute('GET', '/identity/cluster', (req, res) => handleClusterGet(hub, req, res));
  hub.http._addRoute('POST', '/identity/cross-sign', (req, res) => handleCrossSignPost(hub, req, res));
}

module.exports = {
  mountIdentityClusterHttp,
  ingestIdentityCrossSign: ingest,
  ensureCluster,
  relayIdentityCrossSign
};
