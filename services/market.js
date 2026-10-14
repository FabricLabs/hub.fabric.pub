'use strict';

/**
 * Document Market service: the Hub's local chunk index and provider telemetry.
 *
 * Wraps `functions/documentInventoryMarket.js` (durable `documentoffers`
 * rows) with a `@fabric/core` `DocumentOfferBook` so inventory responses are
 * ranked by price, measured round-trip latency, delivery outcomes, and fraud
 * penalties. Telemetry is **local only** (never gossiped) and persisted under
 * the Hub filesystem as `fabric/market-telemetry.json`.
 *
 * HTTP: `GET /services/market` (capabilities + policy), `GET /services/market/providers`,
 * `GET /services/market/chunks?merkleRootHex=&documentId=`.
 *
 * Budget agent (`@fabric/core/services/market`): `settings.market.agent`
 * `{ enable, budgetSats, perPlanMaxSats, proximityWeight, tickMs }` composes the
 * consumer agent over the same offer book. It funds blob HTLCs from the Hub
 * wallet (`bitcoin._processSpendMessage`) and verifies with `_verifyL1Payment`
 * — **never on mainnet**. `GET /services/market/agent` reports status;
 * `POST /services/market/agent/wants` / `PUT /services/market/agent` are admin.
 * Agent state persists at `fabric/market-agent.json`.
 *
 * Payment channels (Phase 4, `@fabric/core/types/channel` `Channel.Book`):
 * when `settings.market.channels.enable` is on, the Hub keeps per-counterparty
 * channel sessions keyed by the operator root key; the budget agent pays for
 * chunks over an open channel (off-chain HTLC settled by the seller's key
 * reveal) before falling back to L1. Channel bodies (`ChannelOpen`,
 * `ChannelCommitment`, `ChannelHtlcFulfill`, `ChannelHtlcFail`, `ChannelClose`)
 * ride `CONTRACT_MESSAGE` under the document-market namespace — no new opcode.
 * `GET /services/market/channels` lists them; `POST /services/market/channels`
 * (admin) opens one. State persists at `fabric/market-channels.json`.
 */
const Service = require('@fabric/core/types/service');
const DocumentOfferBook = require('@fabric/core/types/offerBook');
const MarketAgent = require('@fabric/core/services/market');
const Channel = require('@fabric/core/types/channel');
const Message = require('@fabric/core/types/message');
const documentInventoryMarket = require('../functions/documentInventoryMarket');

class MarketService extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Market',
      enable: true,
      endpointBasePath: '/services/market',
      telemetryPath: 'fabric/market-telemetry.json',
      agentPath: 'fabric/market-agent.json',
      channelsPath: 'fabric/market-channels.json',
      persistDebounceMs: 2000,
      agent: { enable: false },
      channels: { enable: false }
    }, settings);

    this.hub = null;
    this.fs = null;
    this.book = new DocumentOfferBook(this.settings.book || {});
    this.agent = null;
    this.channels = null;
    this.key = null;
    this._persistTimer = null;
  }

  /** @returns {boolean} */
  get channelsEnabled () {
    return !!(this.settings.channels && this.settings.channels.enable === true);
  }

  /** @returns {string} market namespace shared with the challenge service */
  get contractId () {
    return require('crypto').createHash('sha256').update('fabric-document-market').digest('hex');
  }

  /**
   * Build (once) the channel registry keyed by the operator root key.
   * @returns {Channel.Book|null}
   */
  _ensureChannels () {
    if (this.channels) return this.channels;
    if (!this.channelsEnabled || !this.key || !this.key.private) return null;
    const hub = this.hub;
    const bitcoin = hub && hub.bitcoin;
    const network = (bitcoin && bitcoin.network) || (hub && hub.settings && hub.settings.bitcoin && hub.settings.bitcoin.network) || 'regtest';
    if (String(network) === 'mainnet') {
      this.emit('warning', '[MARKET] payment channels refused on mainnet (RC posture)');
      return null;
    }
    try {
      const cfg = (this.settings.channels && typeof this.settings.channels === 'object') ? this.settings.channels : {};
      this.channels = new Channel.Book({
        localPrivateKey: this.key.private,
        network,
        tipHeight: () => Number(bitcoin && bitcoin.height) || 0,
        // Funding gating: confirmations are fed from the Hub block hook (`onBitcoinBlock`).
        confirmations: !!bitcoin,
        policy: cfg.policy || {},
        forwardPolicy: cfg.forwardPolicy || undefined,
        staleTipMs: cfg.staleTipMs,
        publish: (body) => this._publishChannelBody(body),
        // Seller-fulfils: a committed HTLC whose payment hash is one of our
        // published sealed blobs is fulfilled with that blob's key K_i.
        preimageFor: (paymentHashHex) => this._preimageFor(paymentHashHex)
      });
      this.channels.on('htlcSettled', (ev) => {
        this.emit('channelHtlcSettled', ev);
        this._schedulePersist();
      });
      this.channels.on('htlcCommitted', (ev) => this.emit('channelHtlcCommitted', ev));
    } catch (e) {
      this.emit('warning', `[MARKET] channels unavailable: ${e.message}`);
      return null;
    }
    return this.channels;
  }

  /**
   * Content key for a payment hash we can fulfil: our Peer's published sealed
   * blobs first, then (optional) `settings.channels.preimageFor` hook.
   * @param {string} paymentHashHex
   * @returns {string|null} 32-byte key hex
   * @private
   */
  _preimageFor (paymentHashHex) {
    const peer = this.hub && this.hub.agent;
    if (peer && typeof peer.sealedBlobPreimageForPaymentHash === 'function') {
      const hit = peer.sealedBlobPreimageForPaymentHash(paymentHashHex);
      if (hit && hit.keyHex) return hit.keyHex;
    }
    const hook = this.settings.channels && this.settings.channels.preimageFor;
    if (typeof hook === 'function') {
      try { return hook(paymentHashHex) || null; } catch (_) { return null; }
    }
    return null;
  }

  /** @private gossip a signed channel body as CONTRACT_MESSAGE. */
  _publishChannelBody (body) {
    const hub = this.hub;
    if (!hub || !hub.agent || typeof hub.agent.relayFrom !== 'function') return false;
    try {
      const pubkey = this.key.public.encodeCompressed('hex');
      const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify({ contract: this.contractId, type: body.type, actor: { publicKey: pubkey, id: pubkey }, object: body })]);
      msg.signWithKey(this.key);
      hub.agent.relayFrom('_hub', msg).catch(() => {});
      this._schedulePersist();
      return true;
    } catch (e) {
      this.emit('warning', `[MARKET] channel publish failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Route an inbound `Channel*` body (from `contract:message`).
   * @param {object} body
   * @param {object} [meta] `{ sellerId }`
   * @returns {object|null} reply body (already published)
   */
  ingestChannelMessage (body, meta = {}) {
    const book = this._ensureChannels();
    if (!book) return null;
    try {
      const reply = book.ingest(body, meta);
      this._schedulePersist();
      return reply;
    } catch (e) {
      this.emit('warning', `[MARKET] channel ingest rejected: ${e.message}`);
      return null;
    }
  }

  /**
   * New Bitcoin tip (Hub `_handleBitcoinBlockUpdate`): refresh the channel
   * book's tip, confirm pending fundings via RPC, tick expiries, and hand any
   * supplied transactions to `observe()` so stale broadcasts are punished.
   * When `tip` (block hash) is given and RPC is available the raw header and
   * every transaction of that block are fetched so each stale observation
   * carries an SPV inclusion proof (`BitcoinTxInclusion`) in its FraudProof.
   * @param {object} payload `{ height, tip?, txHexes?, blockHeaderHex?, txids? }`
   * @returns {Promise<object|null>}
   */
  async onBitcoinBlock (payload = {}) {
    const book = this.channels;
    if (!book) return null;
    const bitcoin = this.hub && this.hub.bitcoin;
    let txHexes = Array.isArray(payload.txHexes) ? payload.txHexes.slice() : [];
    let blockHeaderHex = payload.blockHeaderHex || null;
    let txids = Array.isArray(payload.txids) ? payload.txids.slice() : null;
    if (payload.tip && bitcoin && typeof bitcoin._makeRPCRequest === 'function' && (!blockHeaderHex || !txids || !txHexes.length)) {
      try {
        const block = await bitcoin._makeRPCRequest('getblock', [String(payload.tip), 2]);
        if (block && Array.isArray(block.tx)) {
          if (!txids) txids = block.tx.map((t) => t.txid);
          if (!txHexes.length) txHexes = block.tx.map((t) => t.hex).filter(Boolean);
        }
        if (!blockHeaderHex) blockHeaderHex = await bitcoin._makeRPCRequest('getblockheader', [String(payload.tip), false]);
      } catch (e) {
        this.emit('debug', `[MARKET] block ${payload.tip} not fetched for inclusion proofs: ${e.message}`);
      }
    }
    for (const txid of book.pendingFundingTxids()) {
      try {
        const info = bitcoin && typeof bitcoin.getTransactionInfo === 'function' ? await bitcoin.getTransactionInfo(txid) : null;
        if (info && info.confirmations != null) book.setConfirmations(txid, info.confirmations);
      } catch (_) { /* unknown yet */ }
    }
    const destinationAddress = bitcoin && typeof bitcoin.getUnusedAddress === 'function'
      ? await Promise.resolve(bitcoin.getUnusedAddress()).catch(() => null)
      : null;
    const result = book.onBlock({
      height: payload.height,
      txHexes,
      blockHeaderHex: blockHeaderHex || undefined,
      txids: txids || undefined,
      destinationAddress: destinationAddress || undefined
    });
    for (const obs of result.observations) {
      if (obs.kind !== 'stale') continue;
      this.emit('channelBreach', obs);
      if (obs.fraudProof) this._publishChannelBody(obs.fraudProof);
      if (obs.justice && bitcoin && typeof bitcoin._spendRawTX === 'function') {
        try { await bitcoin._spendRawTX(obs.justice.txHex); } catch (e) { this.emit('warning', `[MARKET] justice broadcast failed: ${e.message}`); }
      }
    }
    if (result.published.length || result.observations.length) this._schedulePersist();
    return result;
  }

  /** @returns {object} */
  channelsStatus () {
    const book = this._ensureChannels();
    if (!book) return { type: 'ChannelBookStatus', available: false, reason: this.channelsEnabled ? 'unavailable' : 'disabled' };
    return { type: 'ChannelBookStatus', available: true, localPubkey: book.localPubkey, network: book.network, channels: book.list() };
  }

  /**
   * Open a channel as funder (admin). The caller supplies the funding tx hex
   * that pays the returned address (Hub wallet or external).
   * @param {object} body `{ remotePubkey, fundedTxHex, capacitySats, expireAfter, localAddress, remoteAddress, feeSats?, aliases? }`
   */
  channelOpen (body = {}) {
    const book = this._ensureChannels();
    if (!book) throw new Error('payment channels are not enabled');
    const { session, body: open } = book.open(body);
    this._schedulePersist();
    return { channelId: session.channelId, open };
  }

  /** @returns {boolean} true when the consumer budget agent is configured on. */
  get agentEnabled () {
    return !!(this.settings.agent && this.settings.agent.enable === true);
  }

  /**
   * Build (once) the core budget agent over this service's offer book.
   * Funding + verification are Hub wallet callbacks; mainnet is refused.
   * @returns {MarketAgent|null}
   */
  _ensureAgent () {
    if (this.agent) return this.agent;
    if (!this.agentEnabled) return null;
    const hub = this.hub;
    const bitcoin = hub && hub.bitcoin;
    const network = (bitcoin && bitcoin.network) || (hub && hub.settings && hub.settings.bitcoin && hub.settings.bitcoin.network) || 'regtest';
    if (String(network) === 'mainnet') {
      this.emit('warning', '[MARKET] budget agent refused on mainnet (RC posture); set bitcoin.network to regtest/signet');
      return null;
    }
    const cfg = Object.assign({ tickMs: 15000 }, this.settings.agent, { book: this.book, network });
    const channels = this._ensureChannels();
    delete cfg.enable;
    const agent = new MarketAgent(cfg);
    const service = this;
    agent.attach({
      peer: hub ? hub.agent : null,
      book: this.book,
      channels: channels || undefined,
      pay: async (session) => {
        const btc = service.hub && service.hub.bitcoin;
        if (!btc || typeof btc._processSpendMessage !== 'function') throw new Error('Hub wallet unavailable');
        const txid = await btc._processSpendMessage({
          destination: session.paymentAddress,
          amount: Number((session.amountSats / 100000000).toFixed(8)),
          comment: `fabric-market ${String(session.documentId).slice(0, 24)}#${session.blobIndex != null ? session.blobIndex : 'all'}`
        });
        try {
          if (txid && typeof service.hub._mergePersistedTxLabel === 'function') {
            service.hub._mergePersistedTxLabel(String(txid), 'market_purchase', { documentId: session.documentId, settlementId: session.settlementId });
          }
        } catch (_) { /* label is best-effort */ }
        return txid || null;
      },
      verify: async (session, txid) => {
        const btc = service.hub && service.hub.bitcoin;
        if (!btc || !service.hub || typeof service.hub._verifyL1Payment !== 'function') return false;
        return service.hub._verifyL1Payment(btc, txid, session.paymentAddress, session.amountSats);
      }
    });
    for (const ev of ['sessionOpened', 'sessionConfirmed', 'sessionComplete', 'sessionFailed', 'fundingRequired']) {
      agent.on(ev, (session) => {
        this.emit(ev, session);
        this._schedulePersist();
      });
    }
    agent.on('error', (e) => this.emit('warning', String(e)));
    agent.on('debug', (m) => this.emit('debug', m));
    this.agent = agent;
    return agent;
  }

  /** @returns {Object} agent status (or `{ available: false }`). */
  agentStatus () {
    const agent = this._ensureAgent();
    if (!agent) return { type: 'MarketAgentStatus', available: false, reason: this.agentEnabled ? 'unavailable' : 'disabled' };
    return Object.assign({ available: true }, agent.status());
  }

  /**
   * Register a want with the budget agent (admin).
   * @param {Object} body `{ documentId, merkleRootHex?, blobTotal?, maxSats? }`
   */
  agentWant (body = {}) {
    const agent = this._ensureAgent();
    if (!agent) throw new Error('budget agent is not enabled');
    const want = agent.want(body.documentId, body);
    this._schedulePersist();
    return want;
  }

  /**
   * Update budget / knobs (admin).
   * @param {Object} body `{ budgetSats?, perPlanMaxSats?, proximityWeight? }`
   */
  agentConfigure (body = {}) {
    const agent = this._ensureAgent();
    if (!agent) throw new Error('budget agent is not enabled');
    if (body.budgetSats != null) agent.setBudget(body.budgetSats);
    if (body.perPlanMaxSats != null) agent.settings.perPlanMaxSats = Math.max(0, Math.floor(Number(body.perPlanMaxSats) || 0));
    if (body.proximityWeight != null) agent.settings.proximityWeight = Math.min(1, Math.max(0, Number(body.proximityWeight) || 0));
    this._schedulePersist();
    return agent.status();
  }

  attach (deps = {}) {
    if (deps.hub) this.hub = deps.hub;
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    return this;
  }

  /**
   * Market policy from Hub settings (see `documentInventoryMarket.normalizeMarketPolicy`).
   * @returns {Object}
   */
  policy () {
    return documentInventoryMarket.normalizeMarketPolicy(this.hub ? this.hub.settings : this.settings);
  }

  /**
   * Fold one inventory response into the ranked book. Also records RTT /
   * hop telemetry for the seller when the Peer measured it.
   * @param {Object} ev `{ message, origin, latencyMs, hops, signerPubkeyHex }` (Peer `inventoryResponse`)
   * @returns {number} items ingested
   */
  ingestInventoryResponse (ev = {}) {
    const message = ev.message || {};
    const obj = message.object && typeof message.object === 'object' ? message.object : {};
    const items = documentInventoryMarket.itemsFromInventoryMessage(message);
    if (!items.length) return 0;
    const actorId = message.actor && message.actor.id ? String(message.actor.id).trim() : '';
    const origin = ev.origin && (ev.origin.name || ev.origin.address || ev.origin.id)
      ? String(ev.origin.name || ev.origin.address || ev.origin.id)
      : '';
    const sellerId = actorId || ev.signerPubkeyHex || origin;
    if (!sellerId) return 0;
    this.book.ingestInventoryResponse({
      origin: origin || sellerId,
      sellerId,
      sellerPubkey: actorId || null,
      signerPubkeyHex: ev.signerPubkeyHex || null,
      latencyMs: ev.latencyMs,
      hops: ev.hops,
      items
    });
    if (obj.kind === 'documents') this._schedulePersist();
    return items.length;
  }

  /**
   * Record a delivery outcome from a settlement (verified bytes or failure).
   * @param {string} sellerId
   * @param {Object} outcome `{ ok, latencyMs, bytes }`
   */
  recordDelivery (sellerId, outcome) {
    this.book.recordDelivery(sellerId, outcome);
    this._schedulePersist();
  }

  /**
   * @param {string} sellerId
   */
  recordRefund (sellerId) {
    this.book.recordRefund(sellerId);
    this._schedulePersist();
  }

  /**
   * @param {string} sellerId
   * @param {Object} proof verified FraudProof (`{ kind }`)
   */
  recordPenalty (sellerId, proof) {
    this.book.recordPenalty(sellerId, proof);
    this.book.forgetSeller(sellerId);
    this._schedulePersist();
  }

  /**
   * Ranked providers (local telemetry).
   * @returns {object[]}
   */
  listProviders () {
    return this.book.listProviders();
  }

  /**
   * Chunk index: blob hash → ranked offers, as a plain object for JSON.
   * @param {Object} [filter] `{ merkleRootHex, documentId }`
   * @returns {Object}
   */
  chunkIndex (filter = {}) {
    const out = {};
    for (const [hash, rows] of this.book.indexByBlobHash(filter)) {
      out[hash] = rows.map((r) => ({
        sellerId: r.sellerId,
        sellerPubkey: r.sellerPubkey || r.ampSignerPubkey || null,
        rateSats: r.rateSats,
        contentHashHex: r.contentHashHex,
        latencyMs: r.latencyMs,
        hops: r.hops,
        peerScore: r.peerScore,
        rankScore: r.rankScore,
        blobIndex: r.blobIndex,
        blobTotal: r.blobTotal
      }));
    }
    return out;
  }

  getCapabilities () {
    const policy = this.policy();
    return {
      service: 'market',
      available: this.settings.enable !== false,
      endpointBasePath: this.settings.endpointBasePath,
      policy: {
        accumulatePeerInventories: !!policy.accumulatePeerInventories,
        republishWithMarkup: !!policy.republishWithMarkup,
        markupBps: policy.markupBps,
        markupSats: policy.markupSats,
        minPriceSats: policy.minPriceSats
      },
      offerCount: this.book.listOffers().length,
      providerCount: this.book.listProviders().length,
      telemetry: 'local'
    };
  }

  _schedulePersist () {
    if (!this.fs || this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist().catch(() => {});
    }, this.settings.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _persist () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    try {
      await this.fs.publish(this.settings.telemetryPath, this.book.exportTelemetry());
      if (this.agent) await this.fs.publish(this.settings.agentPath, this.agent.export());
      if (this.channels) await this.fs.publish(this.settings.channelsPath, this.channels.export());
    } catch (e) {
      this.emit('warning', `[MARKET] telemetry persist failed: ${e && e.message ? e.message : e}`);
    }
  }

  _loadPersistedAgent () {
    const agent = this._ensureAgent();
    if (!agent || !this.fs || typeof this.fs.readFile !== 'function') return false;
    try {
      const raw = this.fs.readFile(this.settings.agentPath);
      if (!raw) return false;
      agent.import(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));
      return true;
    } catch (_) {
      return false;
    }
  }

  _loadPersisted () {
    if (!this.fs || typeof this.fs.readFile !== 'function') return 0;
    try {
      const raw = this.fs.readFile(this.settings.telemetryPath);
      if (!raw) return 0;
      const data = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
      return this.book.importTelemetry(data);
    } catch (_) {
      return 0;
    }
  }

  _loadPersistedChannels () {
    const book = this._ensureChannels();
    if (!book || !this.fs || typeof this.fs.readFile !== 'function') return false;
    try {
      const raw = this.fs.readFile(this.settings.channelsPath);
      if (!raw) return false;
      book.import(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));
      return true;
    } catch (_) {
      return false;
    }
  }

  async start () {
    const n = this._loadPersisted();
    if (n) this.emit('debug', `[MARKET] restored telemetry for ${n} providers`);
    if (this.channelsEnabled) this._loadPersistedChannels();
    if (this.agentEnabled) {
      this._loadPersistedAgent();
      if (this.agent) await this.agent.start();
    }
    return this;
  }

  async stop () {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this.agent) await this.agent.stop();
    await this._persist();
    return this;
  }
}

module.exports = MarketService;
