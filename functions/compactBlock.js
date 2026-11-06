'use strict';

/**
 * BIP152-style compact blocks for Fabric block relay (pure helpers).
 *
 * A compact block is the 80-byte header, an 8-byte nonce, 6-byte SipHash-2-4
 * short ids of every non-prefilled transaction's wtxid, and the prefilled
 * transactions (always the coinbase). The receiver checks the header's proof
 * of work, matches short ids against its mempool, asks the sender for the
 * rest, then rebuilds the block and checks the merkle and witness roots
 * before handing it to `bitcoind`.
 *
 * Wire bodies (JSON, under the Fabric frame cap):
 * - `BlockRelayCompact` `{ hash, height?, headerHex, nonceHex, count, prefilled: [{ index, hex }], part, parts, shortIds (base64, 6 B each) }`
 * - `BlockRelayTxRequest` `{ hash, indexes: [n] }`
 * - `BlockRelayTxResponse` `{ hash, txs: [{ index, hex }] }`
 */

const crypto = require('crypto');
const { Block, Transaction } = require('bitcoinjs-lib');

const SHORT_ID_BYTES = 6;
/** Short ids per `BlockRelayCompact` part: 6500 × 6 B → 52 KB base64, leaving room for the coinbase under the 64 KiB frame. */
const MAX_SHORT_IDS_PER_PART = 6500;
/** Payload budget for one `BlockRelayTxResponse` (hex chars). */
const MAX_TX_RESPONSE_HEX_CHARS = 52 * 1024;

const MASK64 = (1n << 64n) - 1n;

function rotl (x, b) {
  return ((x << BigInt(b)) | (x >> BigInt(64 - b))) & MASK64;
}

/**
 * SipHash-2-4 over `data` with 64-bit keys `k0`, `k1`.
 * @param {bigint} k0
 * @param {bigint} k1
 * @param {Buffer} data
 * @returns {bigint}
 */
function siphash24 (k0, k1, data) {
  let v0 = 0x736f6d6570736575n ^ k0;
  let v1 = 0x646f72616e646f6dn ^ k1;
  let v2 = 0x6c7967656e657261n ^ k0;
  let v3 = 0x7465646279746573n ^ k1;
  const round = () => {
    v0 = (v0 + v1) & MASK64; v1 = rotl(v1, 13); v1 ^= v0; v0 = rotl(v0, 32);
    v2 = (v2 + v3) & MASK64; v3 = rotl(v3, 16); v3 ^= v2;
    v0 = (v0 + v3) & MASK64; v3 = rotl(v3, 21); v3 ^= v0;
    v2 = (v2 + v1) & MASK64; v1 = rotl(v1, 17); v1 ^= v2; v2 = rotl(v2, 32);
  };
  const len = data.length;
  const end = len - (len % 8);
  for (let i = 0; i < end; i += 8) {
    const m = data.readBigUInt64LE(i);
    v3 ^= m; round(); round(); v0 ^= m;
  }
  let b = BigInt(len & 0xff) << 56n;
  for (let i = 0; i < len % 8; i++) b |= BigInt(data[end + i]) << BigInt(8 * i);
  v3 ^= b; round(); round(); v0 ^= b;
  v2 ^= 0xffn;
  round(); round(); round(); round();
  return (v0 ^ v1 ^ v2 ^ v3) & MASK64;
}

/**
 * SipHash keys for a block: SHA256(header || nonce LE).
 * @param {Buffer} header 80 bytes
 * @param {Buffer} nonce 8 bytes
 * @returns {{ k0: bigint, k1: bigint }}
 */
function shortIdKeys (header, nonce) {
  const h = crypto.createHash('sha256').update(Buffer.concat([header, nonce])).digest();
  return { k0: h.readBigUInt64LE(0), k1: h.readBigUInt64LE(8) };
}

/**
 * 6-byte short id of a wtxid (internal byte order).
 * @param {{ k0: bigint, k1: bigint }} keys
 * @param {Buffer} wtxid
 * @returns {Buffer}
 */
function shortId (keys, wtxid) {
  const v = siphash24(keys.k0, keys.k1, wtxid) & 0xffffffffffffn;
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(v);
  return out.subarray(0, SHORT_ID_BYTES);
}

/**
 * Parse and proof-of-work check an 80-byte header.
 * @param {string} headerHex
 * @returns {{ ok: boolean, hash?: string, prevHash?: string, error?: string }}
 */
function checkHeader (headerHex) {
  if (typeof headerHex !== 'string' || !/^[0-9a-fA-F]{160}$/.test(headerHex)) {
    return { ok: false, error: 'header must be 80 bytes of hex' };
  }
  try {
    const block = Block.fromHex(headerHex);
    if (!block.checkProofOfWork()) return { ok: false, error: 'header fails proof of work' };
    return {
      ok: true,
      hash: block.getId(),
      prevHash: Buffer.from(block.prevHash).reverse().toString('hex')
    };
  } catch (e) {
    return { ok: false, error: `bad header: ${e.message}` };
  }
}

/**
 * Build compact block parts from a full block.
 * @param {string} blockHex serialized block
 * @param {object} [opts] `{ height, nonce (Buffer) }`
 * @returns {object[]} `BlockRelayCompact` bodies
 */
function buildCompactBlock (blockHex, opts = {}) {
  const block = Block.fromHex(blockHex);
  const txs = block.transactions || [];
  const header = Buffer.from(blockHex.slice(0, 160), 'hex');
  const nonce = Buffer.isBuffer(opts.nonce) ? opts.nonce : crypto.randomBytes(8);
  const keys = shortIdKeys(header, nonce);
  const ids = [];
  for (let i = 1; i < txs.length; i++) ids.push(shortId(keys, Buffer.from(txs[i].getHash(true))));
  const base = {
    type: 'BlockRelayCompact',
    hash: block.getId(),
    ...(Number.isFinite(Number(opts.height)) ? { height: Number(opts.height) } : {}),
    headerHex: header.toString('hex'),
    nonceHex: nonce.toString('hex'),
    count: txs.length
  };
  const parts = Math.max(1, Math.ceil(ids.length / MAX_SHORT_IDS_PER_PART));
  const out = [];
  for (let p = 0; p < parts; p++) {
    const slice = ids.slice(p * MAX_SHORT_IDS_PER_PART, (p + 1) * MAX_SHORT_IDS_PER_PART);
    out.push({
      ...base,
      prefilled: p === 0 && txs.length ? [{ index: 0, hex: txs[0].toHex() }] : [],
      part: p,
      parts,
      shortIds: Buffer.concat(slice).toString('base64')
    });
  }
  return out;
}

/**
 * Collects compact parts, mempool matches and fetched txs for one block until
 * it can be rebuilt.
 */
class CompactBlockAssembly {
  /**
   * @param {object} first first `BlockRelayCompact` part seen
   */
  constructor (first) {
    const head = checkHeader(first && first.headerHex);
    if (!head.ok) throw new Error(head.error);
    if (head.hash !== String(first.hash).toLowerCase()) throw new Error('hash does not match header');
    const count = Number(first.count);
    if (!Number.isInteger(count) || count < 1 || count > 1000000) throw new Error('bad tx count');
    if (!/^[0-9a-fA-F]{16}$/.test(String(first.nonceHex || ''))) throw new Error('bad nonce');
    const parts = Number(first.parts);
    if (!Number.isInteger(parts) || parts < 1 || parts > Math.ceil(count / MAX_SHORT_IDS_PER_PART) + 1) throw new Error('bad parts');
    this.hash = head.hash;
    this.prevHash = head.prevHash;
    this.headerHex = first.headerHex.toLowerCase();
    this.count = count;
    this.parts = parts;
    this.height = Number.isFinite(Number(first.height)) ? Number(first.height) : null;
    this.keys = shortIdKeys(Buffer.from(this.headerHex, 'hex'), Buffer.from(first.nonceHex, 'hex'));
    this.nonceHex = first.nonceHex.toLowerCase();
    /** @type {(string|null)[]} tx hex by block index */
    this.txs = new Array(count).fill(null);
    /** @type {(string|null)[]} short id hex by block index */
    this.shortIds = new Array(count).fill(null);
    this._partsSeen = new Set();
    this._nextId = 0;
    this.addPart(first);
  }

  /** @returns {boolean} every part arrived */
  get partsComplete () {
    return this._partsSeen.size === this.parts;
  }

  /**
   * @param {object} part `BlockRelayCompact`
   */
  addPart (part) {
    const p = Number(part.part);
    if (!Number.isInteger(p) || p < 0 || p >= this.parts) throw new Error('bad part index');
    if (String(part.nonceHex).toLowerCase() !== this.nonceHex) throw new Error('nonce changed between parts');
    if (this._partsSeen.has(p)) return;
    for (const pre of Array.isArray(part.prefilled) ? part.prefilled : []) {
      // Only the coinbase is prefilled, so short ids map to slots 1..count-1 in order.
      if (Number(pre.index) !== 0 || typeof pre.hex !== 'string') throw new Error('bad prefilled tx');
      this.txs[0] = pre.hex.toLowerCase();
    }
    const raw = Buffer.from(String(part.shortIds || ''), 'base64');
    if (raw.length % SHORT_ID_BYTES !== 0) throw new Error('bad short ids');
    const n = raw.length / SHORT_ID_BYTES;
    for (let k = 0; k < n; k++) {
      const i = 1 + p * MAX_SHORT_IDS_PER_PART + k;
      if (i >= this.count) throw new Error('too many short ids');
      this.shortIds[i] = raw.subarray(k * SHORT_ID_BYTES, (k + 1) * SHORT_ID_BYTES).toString('hex');
    }
    this._partsSeen.add(p);
  }

  /**
   * Match mempool wtxids against the short ids still empty.
   * @param {object[]} entries `[{ txid, wtxid }]` (display byte order, as `getrawmempool true` gives)
   * @returns {{ index: number, txid: string }[]} slots the mempool can fill
   */
  matchMempool (entries) {
    const want = new Map();
    for (let i = 1; i < this.count; i++) {
      if (!this.txs[i] && this.shortIds[i]) want.set(this.shortIds[i], i);
    }
    const out = [];
    for (const e of entries || []) {
      if (!want.size) break;
      if (!e || !/^[0-9a-fA-F]{64}$/.test(String(e.wtxid || ''))) continue;
      const id = shortId(this.keys, Buffer.from(e.wtxid, 'hex').reverse()).toString('hex');
      const i = want.get(id);
      if (i === undefined) continue;
      want.delete(id);
      out.push({ index: i, txid: String(e.txid || e.wtxid).toLowerCase() });
    }
    return out;
  }

  /**
   * Fill slots with raw transactions (a `BlockRelayTxResponse`, or mempool
   * hex looked up after {@link matchMempool}). A tx whose short id does not
   * match its slot is refused.
   * @param {object[]} txs `[{ index, hex }]`
   * @returns {number} slots filled
   */
  fill (txs) {
    let filled = 0;
    for (const t of Array.isArray(txs) ? txs : []) {
      const i = Number(t && t.index);
      if (!Number.isInteger(i) || i < 1 || i >= this.count || this.txs[i] || typeof t.hex !== 'string') continue;
      let tx;
      try { tx = Transaction.fromHex(t.hex); } catch (_) { continue; }
      if (shortId(this.keys, Buffer.from(tx.getHash(true))).toString('hex') !== this.shortIds[i]) continue;
      this.txs[i] = t.hex.toLowerCase();
      filled++;
    }
    return filled;
  }

  /** @returns {number[]} block indexes still missing */
  missing () {
    if (!this.partsComplete) return [];
    const out = [];
    for (let i = 0; i < this.count; i++) if (!this.txs[i]) out.push(i);
    return out;
  }

  /**
   * Serialize and check the rebuilt block (merkle root, witness commitment, PoW).
   * @returns {{ ok: boolean, blockHex?: string, error?: string }}
   */
  build () {
    if (!this.partsComplete || this.missing().length) return { ok: false, error: 'block incomplete' };
    const blockHex = this.headerHex + encodeVarInt(this.count).toString('hex') + this.txs.join('');
    try {
      const block = Block.fromHex(blockHex);
      if (block.getId() !== this.hash) return { ok: false, error: 'rebuilt hash mismatch' };
      if (!block.checkTxRoots()) return { ok: false, error: 'merkle or witness root mismatch' };
      return { ok: true, blockHex };
    } catch (e) {
      return { ok: false, error: `rebuild failed: ${e.message}` };
    }
  }
}

function encodeVarInt (n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}

/**
 * Answer a `BlockRelayTxRequest` from a full block, split under the frame cap.
 * @param {string} blockHex
 * @param {number[]} indexes
 * @returns {object[]} `BlockRelayTxResponse` bodies
 */
function buildTxResponses (blockHex, indexes) {
  const block = Block.fromHex(blockHex);
  const txs = block.transactions || [];
  const hash = block.getId();
  const out = [];
  let batch = [];
  let size = 0;
  const seen = new Set();
  for (const raw of Array.isArray(indexes) ? indexes : []) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= txs.length || seen.has(i)) continue;
    seen.add(i);
    const hex = txs[i].toHex();
    // A single tx larger than the budget cannot ride this channel; the receiver falls back to bitcoind.
    if (hex.length > MAX_TX_RESPONSE_HEX_CHARS) continue;
    if (size + hex.length > MAX_TX_RESPONSE_HEX_CHARS && batch.length) {
      out.push({ type: 'BlockRelayTxResponse', hash, txs: batch });
      batch = [];
      size = 0;
    }
    batch.push({ index: i, hex });
    size += hex.length;
  }
  if (batch.length) out.push({ type: 'BlockRelayTxResponse', hash, txs: batch });
  return out;
}

module.exports = {
  SHORT_ID_BYTES,
  MAX_SHORT_IDS_PER_PART,
  siphash24,
  shortIdKeys,
  shortId,
  checkHeader,
  buildCompactBlock,
  buildTxResponses,
  CompactBlockAssembly
};
