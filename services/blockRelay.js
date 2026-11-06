'use strict';

/**
 * Block relay over Fabric: propagation telemetry (P0) and compact block relay (P1).
 * See `docs/BLOCK_PROPAGATION_MARKET.md`.
 *
 * Telemetry: for each tip the Hub records when its own `bitcoind` announced it
 * (ZMQ) and when each Fabric peer delivered it (`BitcoinBlock` gossip or a
 * compact block). `deltaMs = arrival − local` on this Hub's clock, so a
 * negative delta means Fabric beat the Hub's Bitcoin P2P. Kept in memory
 * (`maxBlocks` tips) and served at `GET /services/market/blocks`.
 *
 * Relay: on a new local tip the Hub sends a BIP152-style compact block
 * (`functions/compactBlock.js`) point to point (`GenericMessage`, never
 * mesh-flooded) to each connected peer that has not shown it the block. A
 * received compact block is forwarded only after its header passes proof of
 * work, then rebuilt from the mempool plus a `BlockRelayTxRequest` to the
 * sender, checked against the merkle and witness roots, and handed to
 * `bitcoind` with `submitblock`, which validates it fully.
 *
 * Settings `bitcoin.blockRelay`: `{ enable, submit, maxBlocks, txRequestTimeoutMs }`;
 * env `FABRIC_BLOCK_RELAY` (`1`/`0`). Relay defaults on except on mainnet;
 * telemetry is always on.
 */

const {
  checkHeader,
  buildCompactBlock,
  buildTxResponses,
  CompactBlockAssembly
} = require('../functions/compactBlock');

const TYPES = new Set(['BlockRelayCompact', 'BlockRelayTxRequest', 'BlockRelayTxResponse']);
const MAX_ASSEMBLIES = 8;
const ASSEMBLY_TTL_MS = 60 * 1000;
const CACHED_BLOCKS = 6;
const MAX_TX_REQUESTS_PER_PEER_PER_BLOCK = 3;
const MEMPOOL_FETCH_CONCURRENCY = 16;

function percentile (sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

function isHash (h) {
  return typeof h === 'string' && /^[0-9a-fA-F]{64}$/.test(h);
}

class BlockRelay {
  /**
   * @param {object} [settings] `bitcoin.blockRelay` plus `network`
   * @param {object} io `{ rpc(method, params), send(peer, body), peers() → string[], now?() }`
   */
  constructor (settings = {}, io = {}) {
    const env = String(process.env.FABRIC_BLOCK_RELAY || '').trim();
    const network = String(settings.network || '');
    let enable = settings.enable;
    if (env === '1' || env === 'true') enable = true;
    else if (env === '0' || env === 'false') enable = false;
    if (enable === undefined || enable === null) enable = network !== 'mainnet';
    this.settings = Object.assign({
      submit: true,
      maxBlocks: 144,
      txRequestTimeoutMs: 5000
    }, settings, { enable: !!enable, network });
    this.io = io;
    this.now = typeof io.now === 'function' ? io.now : () => Date.now();
    /** @type {Map<string, object>} hash → telemetry record, oldest first */
    this.blocks = new Map();
    /** @type {Map<string, CompactBlockAssembly>} */
    this.assemblies = new Map();
    /** @type {Map<string, string>} hash → block hex, for tx requests */
    this.cache = new Map();
    /** @type {Map<string, Set<string>>} hash → peers known to have it */
    this.holders = new Map();
    this._txRequests = new Map();
    this._timers = new Set();
  }

  /** @returns {boolean} */
  owns (type) {
    return TYPES.has(String(type));
  }

  _record (hash, height) {
    const h = hash.toLowerCase();
    let rec = this.blocks.get(h);
    if (!rec) {
      rec = { hash: h, height: null, localAt: null, arrivals: [], relay: null };
      this.blocks.set(h, rec);
      while (this.blocks.size > this.settings.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
    }
    if (rec.height == null && Number.isFinite(Number(height))) rec.height = Number(height);
    return rec;
  }

  _holders (hash) {
    let s = this.holders.get(hash);
    if (!s) {
      s = new Set();
      this.holders.set(hash, s);
      while (this.holders.size > this.settings.maxBlocks) this.holders.delete(this.holders.keys().next().value);
    }
    return s;
  }

  /**
   * The Hub's own `bitcoind` announced a tip (ZMQ). Sends compact blocks when relay is on.
   * @param {object} payload `{ tip, height }`
   */
  async onLocalBlock (payload = {}) {
    const hash = String(payload.tip || '').toLowerCase();
    if (!isHash(hash)) return;
    const rec = this._record(hash, payload.height);
    if (rec.localAt == null) rec.localAt = this.now();
    if (!this.settings.enable) return;
    const blockHex = await this._blockHex(hash);
    if (!blockHex) return;
    this._sendCompact(hash, blockHex, rec.height);
  }

  /**
   * A peer gossiped a `BitcoinBlock` tip.
   * @param {object} payload `{ tip, height }`
   * @param {string} peer
   */
  onGossip (payload = {}, peer) {
    const hash = String(payload.tip || '').toLowerCase();
    if (!isHash(hash)) return;
    this._arrival(this._record(hash, payload.height), peer, 'gossip');
  }

  _arrival (rec, peer, kind) {
    const name = String(peer || '?');
    if (rec.arrivals.some((a) => a.peer === name && a.kind === kind)) return;
    rec.arrivals.push({ peer: name, kind, at: this.now() });
  }

  async _blockHex (hash) {
    if (this.cache.has(hash)) return this.cache.get(hash);
    try {
      const hex = await this.io.rpc('getblock', [hash, 0]);
      if (typeof hex !== 'string') return null;
      this._cacheBlock(hash, hex);
      return hex;
    } catch (_) {
      return null;
    }
  }

  _cacheBlock (hash, hex) {
    this.cache.set(hash, hex);
    while (this.cache.size > CACHED_BLOCKS) this.cache.delete(this.cache.keys().next().value);
  }

  _sendCompact (hash, blockHex, height, skip) {
    let parts;
    try {
      parts = buildCompactBlock(blockHex, { height });
    } catch (e) {
      console.warn('[HUB:BLOCKRELAY] compact build failed:', e.message);
      return;
    }
    this._forward(hash, parts, skip);
  }

  _forward (hash, parts, skip) {
    const holders = this._holders(hash);
    for (const peer of this.io.peers() || []) {
      if (peer === skip || holders.has(peer)) continue;
      holders.add(peer);
      for (const part of parts) {
        try { this.io.send(peer, part); } catch (_) { /* peer went away */ }
      }
    }
  }

  /**
   * Inbound block relay body from a Fabric peer.
   * @param {object} body
   * @param {string} peer
   */
  async handleMessage (body, peer) {
    if (!body || typeof body !== 'object' || !this.settings.enable) return;
    try {
      if (body.type === 'BlockRelayCompact') await this._onCompact(body, peer);
      else if (body.type === 'BlockRelayTxRequest') await this._onTxRequest(body, peer);
      else if (body.type === 'BlockRelayTxResponse') await this._onTxResponse(body, peer);
    } catch (e) {
      if (this.settings.debug) console.warn('[HUB:BLOCKRELAY]', body.type, 'from', peer, e.message);
    }
  }

  async _onCompact (body, peer) {
    if (!isHash(body.hash)) return;
    const hash = body.hash.toLowerCase();
    this._holders(hash).add(peer);
    const rec = this.blocks.get(hash);
    const done = rec && rec.relay && rec.relay.status !== 'assembling';
    if (done || rec?.localAt != null) {
      if (rec) this._arrival(rec, peer, 'compact');
      return;
    }
    let asm = this.assemblies.get(hash);
    if (!asm) {
      if (this.assemblies.size >= MAX_ASSEMBLIES) return;
      // Constructor checks the header's proof of work before anything else.
      asm = new CompactBlockAssembly(body);
      asm.peer = peer;
      asm.startedAt = this.now();
      this.assemblies.set(hash, asm);
      const t = setTimeout(() => {
        this._timers.delete(t);
        if (this.assemblies.get(hash) === asm) this._finish(asm, 'timeout');
      }, ASSEMBLY_TTL_MS);
      if (t.unref) t.unref();
      this._timers.add(t);
      const r = this._record(hash, asm.height);
      this._arrival(r, peer, 'compact');
      r.relay = { status: 'assembling', from: peer, count: asm.count };
    } else {
      asm.addPart(body);
    }
    // Header has valid PoW: pass the part on before rebuilding, as BIP152 high-bandwidth peers do.
    this._forward(hash, [body], peer);
    if (asm.partsComplete && !asm.mempoolChecked) {
      asm.mempoolChecked = true;
      await this._fillFromMempool(asm);
      await this._advance(asm);
    }
  }

  async _fillFromMempool (asm) {
    let entries = [];
    try {
      const pool = await this.io.rpc('getrawmempool', [true]);
      if (pool && typeof pool === 'object') {
        entries = Object.entries(pool).map(([txid, e]) => ({ txid, wtxid: (e && e.wtxid) || txid }));
      }
    } catch (_) { /* empty mempool path: everything is fetched from the sender */ }
    const matches = asm.matchMempool(entries);
    asm.fromMempool = 0;
    for (let i = 0; i < matches.length; i += MEMPOOL_FETCH_CONCURRENCY) {
      const batch = matches.slice(i, i + MEMPOOL_FETCH_CONCURRENCY);
      const txs = await Promise.all(batch.map(async (m) => {
        try {
          const hex = await this.io.rpc('getrawtransaction', [m.txid]);
          return typeof hex === 'string' ? { index: m.index, hex } : null;
        } catch (_) {
          return null; // left the mempool; fetched from the sender instead
        }
      }));
      asm.fromMempool += asm.fill(txs.filter(Boolean));
    }
  }

  async _advance (asm) {
    if (this.assemblies.get(asm.hash) !== asm) return;
    const missing = asm.missing();
    if (!missing.length) return this._complete(asm);
    if (asm.requested) return;
    asm.requested = missing.length;
    try {
      this.io.send(asm.peer, { type: 'BlockRelayTxRequest', hash: asm.hash, indexes: missing });
    } catch (_) {
      return this._finish(asm, 'sender gone');
    }
    const t = setTimeout(() => {
      this._timers.delete(t);
      if (this.assemblies.get(asm.hash) === asm) this._finish(asm, 'tx request timed out');
    }, this.settings.txRequestTimeoutMs);
    if (t.unref) t.unref();
    this._timers.add(t);
  }

  async _complete (asm) {
    const built = asm.build();
    if (!built.ok) return this._finish(asm, built.error);
    this._cacheBlock(asm.hash, built.blockHex);
    let submit = 'skipped';
    if (this.settings.submit) {
      try {
        const res = await this.io.rpc('submitblock', [built.blockHex]);
        submit = res == null ? 'accepted' : String(res);
      } catch (e) {
        submit = `error: ${e.message}`;
      }
    }
    this._finish(asm, null, submit);
  }

  _finish (asm, error, submit) {
    this.assemblies.delete(asm.hash);
    const rec = this._record(asm.hash, asm.height);
    rec.relay = {
      status: error ? 'failed' : 'rebuilt',
      from: asm.peer,
      count: asm.count,
      fromMempool: asm.fromMempool || 0,
      fetched: asm.requested || 0,
      rebuildMs: this.now() - asm.startedAt,
      ...(error ? { error } : {}),
      ...(submit ? { submit } : {})
    };
  }

  async _onTxRequest (body, peer) {
    if (!isHash(body.hash) || !Array.isArray(body.indexes)) return;
    const hash = body.hash.toLowerCase();
    const key = `${peer}|${hash}`;
    const n = (this._txRequests.get(key) || 0) + 1;
    if (n > MAX_TX_REQUESTS_PER_PEER_PER_BLOCK) return;
    this._txRequests.set(key, n);
    while (this._txRequests.size > 1024) this._txRequests.delete(this._txRequests.keys().next().value);
    // Only blocks this Hub has: its cache or its own bitcoind.
    const blockHex = this.cache.get(hash) || await this._blockHex(hash);
    if (!blockHex) return;
    for (const res of buildTxResponses(blockHex, body.indexes.slice(0, 1000000))) {
      this.io.send(peer, res);
    }
  }

  async _onTxResponse (body, peer) {
    if (!isHash(body.hash)) return;
    const asm = this.assemblies.get(body.hash.toLowerCase());
    if (!asm || asm.peer !== peer) return;
    asm.fill(body.txs);
    if (!asm.missing().length) await this._complete(asm);
  }

  /** @returns {object} status for `GET /services/market/blocks` */
  getStatus () {
    const blocks = [...this.blocks.values()].reverse().map((rec) => ({
      hash: rec.hash,
      height: rec.height,
      localAt: rec.localAt,
      arrivals: rec.arrivals.map((a) => ({
        ...a,
        deltaMs: rec.localAt != null ? a.at - rec.localAt : null
      })),
      ...(rec.relay ? { relay: rec.relay } : {})
    }));
    const byPeer = new Map();
    for (const b of blocks) {
      for (const a of b.arrivals) {
        if (a.deltaMs == null) continue;
        const k = `${a.peer}|${a.kind}`;
        if (!byPeer.has(k)) byPeer.set(k, { peer: a.peer, kind: a.kind, deltas: [] });
        byPeer.get(k).deltas.push(a.deltaMs);
      }
    }
    const peers = [...byPeer.values()].map((p) => {
      const d = p.deltas.slice().sort((x, y) => x - y);
      return {
        peer: p.peer,
        kind: p.kind,
        blocks: d.length,
        p50Ms: percentile(d, 0.5),
        p95Ms: percentile(d, 0.95),
        aheadOfLocal: d.filter((x) => x < 0).length
      };
    });
    const rebuilt = blocks.filter((b) => b.relay && b.relay.status === 'rebuilt');
    return {
      type: 'BlockRelayStatus',
      relay: { enable: this.settings.enable, submit: !!this.settings.submit, network: this.settings.network || null },
      tracked: blocks.length,
      rebuilt: rebuilt.length,
      accepted: rebuilt.filter((b) => b.relay.submit === 'accepted').length,
      peers,
      blocks
    };
  }

  stop () {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
  }
}

BlockRelay.checkHeader = checkHeader;
module.exports = BlockRelay;
