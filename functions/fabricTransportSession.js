'use strict';

/**
 * Per-transport Fabric session: Merkle tree + ordered commitment chain over inbound
 * AMP {@link Message} bodies so browser-side sequencing matches hub/Federation expectations.
 * Reputation fields mirror {@link Peer} wire budget semantics at a coarse level.
 */

const Tree = require('@fabric/core/types/tree');
const Hash256 = require('@fabric/core/types/hash256');
const { HEADER_SIZE } = require('@fabric/core/constants');

/** Stable id for the browser ↔ hub WebSocket leg (this Bridge instance). */
const HUB_FABRIC_SESSION_ID = 'fabric:hub-websocket';

const SESSION_KIND_HUB = 'hub_websocket';
const SESSION_KIND_WEBRTC = 'webrtc_mesh';

/** Match WebRTC binary cap in Bridge — hub JSONCall payloads can exceed core MAX_MESSAGE_SIZE. */
const BRIDGE_INBOUND_WIRE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Body integrity: header `hash` must be double-SHA256(body), same as {@link Peer#_handleFabricMessage}.
 * @param {*} message
 * @returns {boolean}
 */
function fabricWireBodyIntegrityOk (message) {
  if (!message || !message.raw) return false;
  const bodyBuf = message.raw.data || Buffer.alloc(0);
  const checksum = Hash256.doubleDigest(bodyBuf);
  const expectedHash = Buffer.isBuffer(message.raw.hash)
    ? message.raw.hash.toString('hex')
    : String(message.raw.hash || '');
  return checksum === expectedHash;
}

class FabricTransportSession {
  /**
   * @param {string} sessionId
   * @param {'hub_websocket'|'webrtc_mesh'} kind
   */
  constructor (sessionId, kind) {
    this.sessionId = String(sessionId);
    this.kind = kind;
    this.score = 100;
    this.misbehavior = 0;
    this.updatedAt = Date.now();
    /** @type {import('@fabric/core/types/tree')|null} */
    this._tree = null;
    /**
     * Ordered commitments (Federation-style deterministic append log).
     * Each entry: body double-SHA256 leaf + Merkle root after append.
     * @type {{ seq: number, leafHex: string, merkleRootHex: string|null, wireType: string, at: number }[]}
     */
    this.chain = [];
    this._seq = 0;
  }

  reward (delta) {
    const d = Number.isFinite(delta) && delta > 0 ? delta : 1;
    this.score = Math.min(1000, (Number(this.score) || 0) + d);
    this.misbehavior = Math.max(0, (Number(this.misbehavior) || 0) - 1);
    this.updatedAt = Date.now();
  }

  /**
   * @param {*} message — Fabric {@link Message} after `fromBuffer`
   * @returns {{ seq: number, leafHex: string, merkleRootHex: string|null, wireType: string, at: number }}
   */
  commitWireMessage (message) {
    const bodyBuf = message.raw && message.raw.data ? message.raw.data : Buffer.alloc(0);
    const leafHex = Hash256.doubleDigest(bodyBuf);
    this._seq += 1;
    if (!this._tree) {
      this._tree = new Tree({ leaves: [leafHex] });
    } else {
      this._tree.addLeaf(leafHex);
    }
    const root = this._tree && this._tree.root;
    const merkleRootHex = Buffer.isBuffer(root)
      ? root.toString('hex')
      : (root != null ? String(root) : null);
    const entry = {
      seq: this._seq,
      leafHex,
      merkleRootHex,
      wireType: message.type || '',
      at: Date.now()
    };
    this.chain.push(entry);
    this.updatedAt = Date.now();
    return entry;
  }

  getMerkleRootHex () {
    if (!this._tree || !this._tree.root) return null;
    const root = this._tree.root;
    return Buffer.isBuffer(root) ? root.toString('hex') : String(root);
  }

  /**
   * @param {number} penalty
   * @returns {{ disconnect: boolean, score: number, misbehavior: number }}
   */
  penalize (penalty) {
    const pen = Number.isFinite(penalty) && penalty > 0 ? penalty : 20;
    this.score = Math.max(0, (Number(this.score) || 0) - pen);
    const bump = Math.max(1, Math.min(100, Math.ceil(pen / 2)));
    this.misbehavior = Math.min(100, (Number(this.misbehavior) || 0) + bump);
    this.updatedAt = Date.now();
    const disconnect = this.score <= 0 || this.misbehavior >= 80;
    return { disconnect, score: this.score, misbehavior: this.misbehavior };
  }
}

module.exports = {
  HUB_FABRIC_SESSION_ID,
  SESSION_KIND_HUB,
  SESSION_KIND_WEBRTC,
  fabricWireBodyIntegrityOk,
  HEADER_SIZE,
  BRIDGE_INBOUND_WIRE_MAX_BYTES,
  FabricTransportSession
};
