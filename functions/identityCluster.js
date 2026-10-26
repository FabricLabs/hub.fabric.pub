'use strict';

/**
 * Union-find over mutually cross-signed device pubkeys (D-013 network).
 * An edge exists only when A→B and B→A IdentityCrossSign records verify for
 * the same device-link session, nonce, and origin, and neither side has
 * revoked that link.
 */

const { pubkeyXOnly, pubkeysMatch } = require('./fabricPubkey');
const {
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage,
  normalizeCrossSignOrigin
} = require('./identityCrossSign');

function keyOf (pk) {
  return pubkeyXOnly(pk);
}

function edgeKey (a, b) {
  const ka = keyOf(a);
  const kb = keyOf(b);
  if (!ka || !kb) return null;
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
}

/**
 * The device-link a cross-sign or revoke names: session, nonce, and origin.
 * @param {object} rec
 * @returns {{ sessionId: string, nonce: string, origin: string }|null}
 */
function bindingOf (rec = {}) {
  const sessionId = String(rec.sessionId || '').trim().toLowerCase();
  const nonce = String(rec.nonce || '').trim().toLowerCase();
  const origin = normalizeCrossSignOrigin(String(rec.origin || ''));
  if (!/^[a-f0-9]{48}$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(nonce) || !origin) return null;
  return { sessionId, nonce, origin };
}

function sameBinding (a, b) {
  return !!(a && b && a.sessionId === b.sessionId && a.nonce === b.nonce && a.origin === b.origin);
}

function revokedKey (ek, binding) {
  return `${ek}|${binding.sessionId}|${binding.nonce}|${binding.origin}`;
}

function dirKey (local, peer) {
  const a = keyOf(local);
  const b = keyOf(peer);
  if (!a || !b) return null;
  return a + '->' + b;
}

class IdentityCluster {
  constructor () {
    /** @type {Map<string, { sessionId: string, nonce: string, origin: string, local: string, peer: string }>} */
    this._pending = new Map();
    /** @type {Map<string, { a: string, b: string, sessionId: string, nonce: string, origin: string }>} */
    this._edges = new Map();
    /** @type {Set<string>} */
    this._revoked = new Set();
  }

  /**
   * Ingest a verified one-way cross-sign. Links when the reverse for the same
   * session, nonce, and origin is already present.
   * @param {object} rec
   * @returns {{ ok: boolean, linked?: boolean, pending?: boolean, reason?: string, edge?: string }}
   */
  ingestCrossSign (rec = {}) {
    const local = keyOf(rec.localPubkey);
    const peer = keyOf(rec.peerPubkey);
    if (!local || !peer) return { ok: false, reason: 'invalid pubkey' };
    if (local === peer) return { ok: false, reason: 'cannot link a key to itself' };
    const binding = bindingOf(rec);
    if (!binding) return { ok: false, reason: 'invalid session, nonce, or origin' };
    const ek = edgeKey(local, peer);
    if (this._revoked.has(revokedKey(ek, binding))) return { ok: false, reason: 'revoked' };
    const forward = dirKey(local, peer);
    const reverse = dirKey(peer, local);
    this._pending.set(forward, Object.assign({ local, peer }, binding));
    const other = this._pending.get(reverse);
    if (sameBinding(other, binding)) {
      this._edges.set(ek, Object.assign({ a: local, b: peer }, binding));
      this._pending.delete(forward);
      this._pending.delete(reverse);
      return { ok: true, linked: true, edge: ek };
    }
    return { ok: true, linked: false, pending: true };
  }

  /**
   * Split the edge made in the session the revoke names. Either party may
   * revoke; a later link in a new session forms a new edge.
   * @param {object} rec
   * @returns {{ ok: boolean, reason?: string }}
   */
  ingestRevoke (rec = {}) {
    const local = keyOf(rec.localPubkey);
    const peer = keyOf(rec.peerPubkey);
    if (!local || !peer) return { ok: false, reason: 'invalid pubkey' };
    const binding = bindingOf(rec);
    if (!binding) return { ok: false, reason: 'invalid session, nonce, or origin' };
    const ek = edgeKey(local, peer);
    this._revoked.add(revokedKey(ek, binding));
    if (sameBinding(this._edges.get(ek), binding)) this._edges.delete(ek);
    for (const dk of [dirKey(local, peer), dirKey(peer, local)]) {
      if (sameBinding(this._pending.get(dk), binding)) this._pending.delete(dk);
    }
    return { ok: true };
  }

  /**
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  clusterEquals (a, b) {
    if (!a || !b) return false;
    if (pubkeysMatch(a, b)) return true;
    const kb = keyOf(b);
    if (!kb) return false;
    return this.clusterOf(a).has(kb);
  }

  /**
   * @param {*} pubkey
   * @returns {Set<string>} x-only pubkeys in the cluster (includes self)
   */
  clusterOf (pubkey) {
    const start = keyOf(pubkey);
    const seen = new Set();
    if (!start) return seen;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      for (const edge of this._edges.values()) {
        const other = edge.a === cur ? edge.b : (edge.b === cur ? edge.a : null);
        if (other && !seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    return seen;
  }

  /**
   * Deterministic display id: lexicographically smallest x-only pubkey.
   * @param {*} pubkey
   * @returns {string|null}
   */
  canonicalOf (pubkey) {
    const members = Array.from(this.clusterOf(pubkey));
    if (!members.length) return keyOf(pubkey);
    members.sort();
    return members[0];
  }

  /**
   * @param {*} pubkey
   * @returns {{ canonical: string|null, members: string[], edges: object[] }}
   */
  snapshot (pubkey) {
    const members = Array.from(this.clusterOf(pubkey));
    members.sort();
    const edges = [];
    for (const edge of this._edges.values()) {
      if (members.includes(edge.a) || members.includes(edge.b)) {
        edges.push({ a: edge.a, b: edge.b, sessionId: edge.sessionId, nonce: edge.nonce, origin: edge.origin });
      }
    }
    return {
      canonical: members[0] || keyOf(pubkey),
      members,
      edges
    };
  }

  toJSON () {
    return {
      pending: Array.from(this._pending.entries()),
      edges: Array.from(this._edges.entries()),
      revoked: Array.from(this._revoked)
    };
  }

  static fromJSON (doc) {
    const c = new IdentityCluster();
    if (!doc || typeof doc !== 'object') return c;
    if (Array.isArray(doc.pending)) {
      for (const [k, v] of doc.pending) if (bindingOf(v)) c._pending.set(k, v);
    }
    if (Array.isArray(doc.edges)) {
      for (const [k, v] of doc.edges) if (bindingOf(v)) c._edges.set(k, v);
    }
    if (Array.isArray(doc.revoked)) {
      for (const k of doc.revoked) if (String(k).split('|').length === 5) c._revoked.add(k);
    }
    return c;
  }
}

IdentityCluster.keyOf = keyOf;
IdentityCluster.edgeKey = edgeKey;
IdentityCluster.bindingOf = bindingOf;
IdentityCluster.SIGN_TYPE = SIGN_TYPE;
IdentityCluster.REVOKE_TYPE = REVOKE_TYPE;
IdentityCluster.buildCrossSignMessage = buildCrossSignMessage;
IdentityCluster.buildRevokeMessage = buildRevokeMessage;

module.exports = IdentityCluster;
