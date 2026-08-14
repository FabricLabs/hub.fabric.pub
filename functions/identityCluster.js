'use strict';

/**
 * Union-find over mutually cross-signed device pubkeys (D-013 network).
 * An edge exists only when both A→B and B→A IdentityCrossSign records verify
 * and neither side has published IdentityCrossSignRevoke.
 */

const { pubkeyXOnly, pubkeysMatch } = require('./fabricPubkey');
const {
  SIGN_TYPE,
  REVOKE_TYPE,
  buildCrossSignMessage,
  buildRevokeMessage
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

function dirKey (local, peer) {
  const a = keyOf(local);
  const b = keyOf(peer);
  if (!a || !b) return null;
  return a + '->' + b;
}

class IdentityCluster {
  constructor () {
    /** @type {Map<string, { nonce: string, local: string, peer: string }>} */
    this._pending = new Map();
    /** @type {Map<string, { a: string, b: string, nonce: string }>} */
    this._edges = new Map();
    /** @type {Set<string>} */
    this._revoked = new Set();
  }

  /**
   * Ingest a verified one-way cross-sign. Links when the reverse with the
   * same nonce is already present.
   * @param {object} rec
   * @returns {{ ok: boolean, linked?: boolean, pending?: boolean, reason?: string, edge?: string }}
   */
  ingestCrossSign (rec = {}) {
    const local = keyOf(rec.localPubkey);
    const peer = keyOf(rec.peerPubkey);
    const nonce = String(rec.nonce || '').trim().toLowerCase();
    if (!local || !peer) return { ok: false, reason: 'invalid pubkey' };
    if (local === peer) return { ok: false, reason: 'cannot link a key to itself' };
    if (!/^[a-f0-9]{64}$/.test(nonce)) return { ok: false, reason: 'invalid nonce' };
    const ek = edgeKey(local, peer);
    if (this._revoked.has(ek)) return { ok: false, reason: 'revoked' };
    const forward = dirKey(local, peer);
    const reverse = dirKey(peer, local);
    this._pending.set(forward, { nonce, local, peer });
    const other = this._pending.get(reverse);
    if (other && other.nonce === nonce) {
      this._edges.set(ek, { a: local, b: peer, nonce });
      this._pending.delete(forward);
      this._pending.delete(reverse);
      return { ok: true, linked: true, edge: ek };
    }
    return { ok: true, linked: false, pending: true };
  }

  /**
   * Split an edge. Either party may revoke.
   * @param {object} rec
   * @returns {{ ok: boolean, reason?: string }}
   */
  ingestRevoke (rec = {}) {
    const local = keyOf(rec.localPubkey);
    const peer = keyOf(rec.peerPubkey);
    if (!local || !peer) return { ok: false, reason: 'invalid pubkey' };
    const ek = edgeKey(local, peer);
    this._edges.delete(ek);
    this._revoked.add(ek);
    this._pending.delete(dirKey(local, peer));
    this._pending.delete(dirKey(peer, local));
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
        edges.push({ a: edge.a, b: edge.b, nonce: edge.nonce });
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
      for (const [k, v] of doc.pending) c._pending.set(k, v);
    }
    if (Array.isArray(doc.edges)) {
      for (const [k, v] of doc.edges) c._edges.set(k, v);
    }
    if (Array.isArray(doc.revoked)) {
      for (const k of doc.revoked) c._revoked.add(k);
    }
    return c;
  }
}

IdentityCluster.keyOf = keyOf;
IdentityCluster.edgeKey = edgeKey;
IdentityCluster.SIGN_TYPE = SIGN_TYPE;
IdentityCluster.REVOKE_TYPE = REVOKE_TYPE;
IdentityCluster.buildCrossSignMessage = buildCrossSignMessage;
IdentityCluster.buildRevokeMessage = buildRevokeMessage;

module.exports = IdentityCluster;
