'use strict';

/**
 * @fileoverview Hub side of the `@fabric/core` L1:L1 coinjoin market
 * (`docs/COINJOIN_MARKET.md` in core).
 *
 * - **Maker.** The Hub wallet offers liquidity in three bands built from the
 *   pool sizes (`functions/joinmarketPoolPreferences.js`): each pool size is
 *   the top of a band whose bottom is one sat above the next smaller pool.
 *   Offers are signed with a maker key derived from the Hub identity
 *   (`m/86'/coin'/0'/3/0`), re-signed before they expire, and carry the
 *   Hub's best live fidelity bond. bitcoind `walletprocesspsbt` signs only
 *   the maker's own inputs.
 * - **Taker.** `startCoinjoin` draws makers from the local offer book
 *   (bond-weighted, fee as a hard limit), runs the round over sealed
 *   `CONTRACT_MESSAGE`s, rebuilds without makers that stall, and broadcasts.
 * - **Bonds.** Bond keys derive from the Hub identity at
 *   `m/86'/coin'/0'/2/i`; the Hub wallet funds them; certificates bind each
 *   bond to the maker key; a bond is redeemed once its lock has passed.
 *
 * Everything persists under the Hub filesystem at `coinjoin/` (rounds keep
 * their per-round keys so a restart can finish them). Mainnet is refused.
 */

const Service = require('@fabric/core/types/service');
const { DEFAULT_POOLS_BTC, btcToSats } = require('../functions/joinmarketPoolPreferences');

const NETWORKS = Object.freeze(['regtest', 'signet', 'testnet', 'test']);
const TERMINAL_TAKER = Object.freeze(['broadcast', 'aborted']);
const TERMINAL_MAKER = Object.freeze(['aborted']);

let warnedMissingCore = false;

/** @private */
function loadCore () {
  try {
    const rounds = require('@fabric/core/types/coinjoinRound');
    return {
      Coinjoin: require('@fabric/core/types/coinjoin'),
      Bond: require('@fabric/core/types/bond'),
      CoinjoinBook: require('@fabric/core/types/coinjoinBook'),
      CoinjoinTakerRound: rounds.CoinjoinTakerRound,
      CoinjoinMakerRound: rounds.CoinjoinMakerRound
    };
  } catch (err) {
    return { error: `@fabric/core has no coinjoin market (${err.message}); run npm run link:fabric` };
  }
}

/** @private */
function xOnly (pubkey) {
  const s = String(pubkey || '').toLowerCase();
  return s.length === 66 ? s.slice(2) : s;
}

/** @private */
function intOr (value, fallback) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

/** @private */
function parseJson (raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

class CoinjoinService extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest']
   * @param {Object} [settings.maker] `{ poolSizesBtc, feeSats, feePpm, txFeeContributionSats, offerTtlMs, maxRounds, roundTtlMs, signedHoldMs }`
   * @param {Object} [settings.taker] `{ minMakers, feeRateSatVb, maxFeeSats, ackTimeoutMs, sigTimeoutMs }`
   * @param {Object} [settings.bonds] `{ certBlocks, minConfs, redeemFeeSats }`
   * @param {number} [settings.tickMs=5000]
   * @param {Object} [settings.core] core modules (tests; default `@fabric/core`)
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: 'Coinjoin',
      enable: true,
      network: 'regtest',
      path: 'coinjoin',
      tickMs: 5000,
      bookRefreshMs: 10 * 60 * 1000,
      maxTakerRounds: 200
    }, settings);
    this.settings.network = String(this.settings.network || 'regtest').toLowerCase();
    this.settings.maker = Object.assign({
      poolSizesBtc: [...DEFAULT_POOLS_BTC],
      feeSats: 250,
      feePpm: 200,
      txFeeContributionSats: 0,
      offerTtlMs: 60 * 60 * 1000,
      maxRounds: 20,
      roundTtlMs: 10 * 60 * 1000,
      signedHoldMs: 60 * 60 * 1000
    }, settings.maker || {});
    this.settings.taker = Object.assign({
      minMakers: 2,
      feeRateSatVb: 2,
      maxFeeSats: null,
      ackTimeoutMs: 30000,
      sigTimeoutMs: 60000
    }, settings.taker || {});
    this.settings.bonds = Object.assign({
      certBlocks: 2016 * 4,
      minConfs: 6,
      redeemFeeSats: 500
    }, settings.bonds || {});

    this.core = settings.core || loadCore();
    this.fs = null;
    this.bitcoin = null;
    this.key = null;
    this.chain = null;
    this.wallet = null;
    this._publish = null;
    this._fund = null;
    this._newAddress = null;

    this.book = null;
    this.blacklist = null;
    this.verifier = null;
    this._maker = { enabled: false, updatedAt: null };
    this._ownOffers = [];
    this._recentOffers = new Map();
    this._makerRounds = new Map();
    this._takerRounds = new Map();
    this._podleUsed = {};
    this._bonds = [];
    this._queue = Promise.resolve();
    this._timer = null;
    this._offersRefreshAt = 0;
    this._bookRefreshAt = 0;
    this._started = false;
  }

  /** @returns {string|null} why the market cannot run here, else null */
  get unavailableReason () {
    if (this.core.error) return this.core.error;
    if (!NETWORKS.includes(this.settings.network)) return `coinjoin is not offered on ${this.settings.network}`;
    if (!this.chain || !this.wallet) return 'Bitcoin is not available';
    return null;
  }

  /** @returns {boolean} */
  get available () {
    return !this.unavailableReason;
  }

  /** @returns {string|null} the coinjoin `CONTRACT_MESSAGE` namespace */
  get contractId () {
    return this.core.Coinjoin ? this.core.Coinjoin.SEAL_NAMESPACE : null;
  }

  /**
   * @param {Object} deps
   * @param {Object} [deps.fs] Hub `Filesystem` (`publish`, `readFile`)
   * @param {Object} [deps.bitcoin] `@fabric/core` Bitcoin service
   * @param {Object} [deps.key] Hub identity `Key` (needs `master`)
   * @param {Function} [deps.publish] `(contractMessageBody, { anonymous }) => void`
   * @param {Object} [deps.chain] chain adapter override (tests)
   * @param {Object} [deps.wallet] wallet adapter override (tests)
   * @param {Function} [deps.fund] `(address, scriptPubKeyHex, amountSats) => { txid, vout }` (tests)
   * @param {Function} [deps.newAddress] `() => address` (tests)
   * @returns {CoinjoinService}
   */
  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.bitcoin) this.bitcoin = deps.bitcoin;
    if (deps.key) this.key = deps.key;
    if (typeof deps.publish === 'function') this._publish = deps.publish;
    if (typeof deps.fund === 'function') this._fund = deps.fund;
    if (typeof deps.newAddress === 'function') this._newAddress = deps.newAddress;
    if (this.core.error) return this;
    const { CoinjoinTakerRound } = this.core;
    if (deps.chain) this.chain = deps.chain;
    else if (this.bitcoin && typeof this.bitcoin._makeRPCRequest === 'function') this.chain = CoinjoinTakerRound.bitcoinAdapter(this.bitcoin);
    if (deps.wallet) this.wallet = deps.wallet;
    else if (this.bitcoin && typeof this.bitcoin._makeRPCRequest === 'function') {
      this.wallet = CoinjoinTakerRound.walletAdapter(this.bitcoin, {
        wallet: this._walletName(),
        usedIndexes: (txid, vout) => this._podleUsed[`${txid}:${vout}`] || []
      });
    }
    return this;
  }

  async start () {
    if (this._started) return this;
    this._started = true;
    if (this.core.error) {
      if (!warnedMissingCore) this.emit('warning', `[COINJOIN] ${this.core.error}`);
      warnedMissingCore = true;
      return this;
    }
    const { CoinjoinBook, Coinjoin, Bond } = this.core;
    this.book = new CoinjoinBook({ network: this.settings.network });
    const saved = this._read('podle.json') || {};
    this.blacklist = new Coinjoin.PodleBlacklist({ commitments: Array.isArray(saved.blacklist) ? saved.blacklist : [] });
    this._podleUsed = saved.used && typeof saved.used === 'object' ? saved.used : {};
    if (this.chain) {
      this.verifier = new Bond.FidelityVerifier({ bitcoin: this.chain, network: this.settings.network, minConfs: this.settings.bonds.minConfs });
    }
    this._loadMaker();
    this._loadBonds();
    this._loadRounds();
    if (this.settings.tickMs > 0) {
      this._timer = setInterval(() => {
        this._enqueue(() => this.tick()).catch((err) => this.emit('warning', `[COINJOIN] tick failed: ${err.message}`));
      }, this.settings.tickMs);
      if (this._timer.unref) this._timer.unref();
    }
    return this;
  }

  async stop () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    await this._queue.catch(() => {});
    return this;
  }

  // ---------------------------------------------------------------------------
  // Persistence

  /** @private */
  _read (name) {
    if (!this.fs || typeof this.fs.readFile !== 'function') return null;
    return parseJson(this.fs.readFile(`${this.settings.path}/${name}`));
  }

  /** @private */
  async _write (name, value) {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    await this.fs.publish(`${this.settings.path}/${name}`, value);
  }

  /** @private */
  async _savePodle () {
    await this._write('podle.json', { blacklist: this.blacklist ? this.blacklist.toJSON() : [], used: this._podleUsed });
  }

  /** @private */
  async _saveIndex () {
    await this._write('index.json', {
      takerRounds: [...this._takerRounds.keys()],
      makerRounds: [...this._makerRounds.keys()]
    });
  }

  /** @private */
  async _saveTaker (entry) {
    entry.updatedAt = Date.now();
    await this._write(`rounds/${entry.round.roundId}.json`, {
      role: 'taker',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      feeRateSatVb: entry.feeRateSatVb,
      error: entry.error,
      round: entry.round.toJSON({ includeSecrets: true })
    });
  }

  /** @private */
  async _saveMaker (entry) {
    entry.updatedAt = Date.now();
    await this._write(`maker-rounds/${entry.round.fillId}.json`, {
      role: 'maker',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      released: entry.released,
      error: entry.error,
      round: entry.round.toJSON({ includeSecrets: true })
    });
  }

  /** @private */
  _loadMaker () {
    const saved = this._read('maker.json');
    if (!saved || typeof saved !== 'object') return;
    this._maker.enabled = saved.enabled === true;
    this._maker.updatedAt = saved.updatedAt || null;
    for (const field of ['poolSizesBtc', 'feeSats', 'feePpm', 'txFeeContributionSats', 'offerTtlMs']) {
      if (saved[field] != null) this.settings.maker[field] = saved[field];
    }
  }

  /** @private */
  _loadBonds () {
    const index = this._read('bonds/index.json');
    const ids = index && Array.isArray(index.bonds) ? index.bonds : [];
    this._bonds = ids.map((id) => this._read(`bonds/${id}.json`)).filter((b) => b && b.txid);
  }

  /** @private */
  async _saveBond (bond) {
    await this._write(`bonds/${bond.id}.json`, bond);
    await this._write('bonds/index.json', { bonds: this._bonds.map((b) => b.id) });
  }

  /** @private */
  _loadRounds () {
    const index = this._read('index.json') || {};
    const { CoinjoinTakerRound, CoinjoinMakerRound } = this.core;
    for (const roundId of Array.isArray(index.takerRounds) ? index.takerRounds : []) {
      const saved = this._read(`rounds/${roundId}.json`);
      if (!saved || !saved.round) continue;
      try {
        const round = CoinjoinTakerRound.fromJSON(saved.round, this._takerSettings({ feeRateSatVb: saved.feeRateSatVb }));
        this._takerRounds.set(roundId, this._takerEntry(round, saved));
      } catch (err) {
        this.emit('warning', `[COINJOIN] cannot restore round ${roundId}: ${err.message}`);
      }
    }
    const identityKey = this._makerKey();
    for (const fillId of Array.isArray(index.makerRounds) ? index.makerRounds : []) {
      const saved = this._read(`maker-rounds/${fillId}.json`);
      if (!saved || !saved.round || !identityKey) continue;
      try {
        const round = CoinjoinMakerRound.fromJSON(saved.round, {
          identityKey,
          adapters: { bitcoin: this.chain, wallet: this.wallet },
          blacklist: this.blacklist
        });
        this._makerRounds.set(fillId, this._makerEntry(round, saved));
      } catch (err) {
        this.emit('warning', `[COINJOIN] cannot restore maker round ${fillId}: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Keys and wallet

  /** @private */
  _walletName () {
    const b = this.bitcoin;
    return (b && (b.walletName || (b.settings && b.settings.walletName))) || undefined;
  }

  /** @private */
  _coinType () {
    return this.settings.network === 'mainnet' ? 0 : 1;
  }

  /** @private */
  _derive (path) {
    const master = this.key && this.key.master;
    if (!master || typeof master.derivePath !== 'function') return null;
    const node = master.derivePath(path);
    return node && node.privateKey ? Buffer.from(node.privateKey) : null;
  }

  /** @private maker identity key: signs offers, opens fills */
  _makerKey () {
    if (this._makerKeyCache !== undefined) return this._makerKeyCache;
    this._makerKeyCache = this._derive(`m/86'/${this._coinType()}'/0'/3/0`);
    return this._makerKeyCache;
  }

  /** @returns {string|null} compressed maker pubkey */
  get makerPubkey () {
    const key = this._makerKey();
    return key && this.core.Coinjoin ? this.core.Coinjoin.pubkeyFromPrivate(key) : null;
  }

  /** @private */
  _bondKey (index) {
    return this._derive(this.core.Bond.fidelityPath(index, this.settings.network));
  }

  /** @private */
  async _rpc (method, params = [], wallet = false) {
    const b = this.bitcoin;
    if (!b) throw new Error('Bitcoin is not available');
    const name = wallet ? this._walletName() : null;
    if (name && typeof b._makeWalletRequest === 'function') return b._makeWalletRequest(method, params, name);
    return b._makeRPCRequest(method, params);
  }

  /**
   * Spendable P2TR value the maker could put into a round, or null when unknown.
   * @private
   */
  async _makerBalanceSats () {
    const w = this.wallet;
    if (w && typeof w.balanceSats === 'function') return Number(await w.balanceSats());
    if (w && Array.isArray(w.coins)) {
      const locked = w.locked instanceof Set ? w.locked : new Set();
      return w.coins.filter((c) => !locked.has(`${c.txid}:${c.vout}`)).reduce((t, c) => t + Number(c.valueSats), 0);
    }
    if (!this.bitcoin) return null;
    try {
      const rows = await this._rpc('listunspent', [1, 9999999, [], false], true);
      return (rows || [])
        .filter((u) => u.spendable !== false && /^5120[0-9a-f]{64}$/.test(String(u.scriptPubKey || '')))
        .reduce((t, u) => t + Math.round(Number(u.amount) * 1e8), 0);
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Wire

  /** @private */
  _enqueue (fn) {
    const next = this._queue.then(fn, fn);
    this._queue = next.catch(() => {});
    return next;
  }

  /**
   * Publish a coinjoin `CONTRACT_MESSAGE` body. Sealed envelopes ask for an
   * anonymous carrier: the round key already authenticates them, and a Hub
   * signature on the wire would tie a taker's round to the Hub.
   * @private
   */
  _send (value) {
    if (!this._publish) return false;
    try {
      const body = this.core.Coinjoin.toContractMessage(value);
      this._publish(body, { anonymous: body.type === this.core.Coinjoin.SEALED_TYPE });
      return true;
    } catch (err) {
      this.emit('warning', `[COINJOIN] publish failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Whether a `CONTRACT_MESSAGE` body belongs to the coinjoin market.
   * @param {Object} object
   * @returns {boolean}
   */
  ownsContractMessage (object) {
    return !!(object && this.contractId && object.contract === this.contractId);
  }

  /**
   * Handle a coinjoin `CONTRACT_MESSAGE` body from a peer: offers and
   * cancels go to the book; sealed envelopes to the round they are sealed to.
   * @param {Object} object parsed `CONTRACT_MESSAGE` body
   * @returns {Promise<{ kind: (string|null), handled: boolean, reason: (string|null) }>}
   */
  handleContractMessage (object) {
    return this._enqueue(() => this._handle(object));
  }

  /** @private */
  async _handle (object) {
    if (this.core.error || !this.book) return { kind: null, handled: false, reason: 'unavailable' };
    const read = this.core.Coinjoin.fromContractMessage(object);
    if (!read) return { kind: null, handled: false, reason: 'not a coinjoin message' };
    if (read.kind === 'offer') {
      if (read.body.makerPubkey === this.makerPubkey) return { kind: 'offer', handled: false, reason: 'own offer' };
      const r = this.book.ingest(read.body);
      return { kind: 'offer', handled: r.ok, reason: r.reason || null };
    }
    if (read.kind === 'cancel') {
      const r = this.book.cancel(read.body);
      return { kind: 'cancel', handled: r.ok, reason: r.reason || null };
    }
    return this._routeSealed(read.envelope, read.to);
  }

  /** @private */
  async _routeSealed (envelope, to) {
    for (const entry of this._takerRounds.values()) {
      if (entry.round.sealXOnly !== to || TERMINAL_TAKER.includes(entry.round.status)) continue;
      await this._takerReceive(entry, envelope);
      return { kind: 'sealed', handled: true, reason: null };
    }
    for (const entry of this._makerRounds.values()) {
      if (entry.round.sealXOnly !== to || TERMINAL_MAKER.includes(entry.round.status)) continue;
      await this._makerReceive(entry, envelope);
      return { kind: 'sealed', handled: true, reason: null };
    }
    const makerPubkey = this.makerPubkey;
    if (this._maker.enabled && makerPubkey && to === xOnly(makerPubkey)) {
      return this._onFill(envelope);
    }
    return { kind: 'sealed', handled: false, reason: 'not for this Hub' };
  }

  // ---------------------------------------------------------------------------
  // Maker

  /** @private */
  _makerEntry (round, saved = {}) {
    return {
      round,
      createdAt: saved.createdAt || Date.now(),
      updatedAt: saved.updatedAt || Date.now(),
      released: saved.released === true,
      error: saved.error || null
    };
  }

  /** @private */
  _liveMakerRounds () {
    return [...this._makerRounds.values()].filter((e) => !TERMINAL_MAKER.includes(e.round.status) && !e.released);
  }

  /** @private */
  async _onFill (envelope) {
    if (!this.available) return { kind: 'sealed', handled: false, reason: this.unavailableReason };
    const { Coinjoin, CoinjoinMakerRound } = this.core;
    const identityKey = this._makerKey();
    const opened = Coinjoin.openRoundMessage(envelope, identityKey);
    if (!opened.ok || opened.body.type !== Coinjoin.BODY_TYPES.FILL) return { kind: 'sealed', handled: false, reason: opened.reason || 'not a fill' };
    const offer = this._recentOffers.get(opened.body.offerId);
    if (!offer) return { kind: 'sealed', handled: false, reason: 'fill for an offer this Hub no longer holds' };
    if (this._liveMakerRounds().filter((e) => e.round.status !== 'signed').length >= this.settings.maker.maxRounds) {
      return { kind: 'sealed', handled: false, reason: 'maker is busy' };
    }
    const round = new CoinjoinMakerRound({
      offer,
      identityKey,
      adapters: { bitcoin: this.chain, wallet: this.wallet },
      blacklist: this.blacklist
    });
    round.on('error', () => {});
    const entry = this._makerEntry(round);
    let reply;
    try {
      reply = await round.receive(envelope);
    } catch (err) {
      return { kind: 'sealed', handled: false, reason: err.message };
    }
    this._makerRounds.set(round.fillId, entry);
    if (reply) this._send(reply);
    await this._saveMaker(entry);
    await this._saveIndex();
    return { kind: 'sealed', handled: true, reason: null };
  }

  /** @private */
  async _makerReceive (entry, envelope) {
    try {
      const reply = await entry.round.receive(envelope);
      if (reply) this._send(reply);
      entry.error = null;
    } catch (err) {
      entry.error = err.message;
    }
    if (entry.round.status !== 'new') await this._savePodle();
    await this._saveMaker(entry);
  }

  /** @private */
  _bands (balanceSats) {
    const { Coinjoin } = this.core;
    const cfg = this.settings.maker;
    const pools = (Array.isArray(cfg.poolSizesBtc) ? cfg.poolSizesBtc : DEFAULT_POOLS_BTC)
      .map(btcToSats)
      .filter((s) => s >= Coinjoin.MIN_COINJOIN_SATS)
      .sort((a, b) => a - b);
    const sizes = [...new Set(pools)];
    const ceiling = balanceSats == null ? Infinity : balanceSats - Number(cfg.txFeeContributionSats || 0);
    const bands = [];
    for (let i = 0; i < sizes.length; i++) {
      const minSats = i === 0 ? Coinjoin.MIN_COINJOIN_SATS : sizes[i - 1] + 1;
      const maxSats = Math.min(sizes[i], ceiling);
      if (maxSats >= minSats) bands.push({ minSats, maxSats, poolSats: sizes[i] });
    }
    return bands;
  }

  /**
   * Re-sign the Hub's offers (one per pool band, clamped to the P2TR balance,
   * with the best live bond) and announce them; earlier offers are cancelled.
   * @returns {Promise<Object[]>} the signed offers
   */
  async refreshOffers () {
    if (!this.available) return [];
    const { Coinjoin } = this.core;
    const identityKey = this._makerKey();
    if (!identityKey) return [];
    const previous = this._ownOffers;
    const now = Date.now();
    const offers = [];
    if (this._maker.enabled) {
      const cfg = this.settings.maker;
      const bond = await this._bestBondCertificate();
      for (const band of this._bands(await this._makerBalanceSats())) {
        const offer = Coinjoin.signBody(Object.assign({
          type: Coinjoin.BODY_TYPES.OFFER,
          network: this.settings.network,
          minSats: band.minSats,
          maxSats: band.maxSats,
          feeSats: Math.min(intOr(cfg.feeSats, 0), band.minSats),
          feePpm: intOr(cfg.feePpm, 0),
          txFeeContributionSats: Math.min(intOr(cfg.txFeeContributionSats, 0), band.minSats),
          createdAt: now,
          expiresAt: now + intOr(cfg.offerTtlMs, 3600000),
          makerPubkey: Coinjoin.pubkeyFromPrivate(identityKey),
          nonce: Coinjoin.randomNonce()
        }, bond ? { fidelityBond: bond } : {}), identityKey);
        offers.push(offer);
      }
    }
    this._ownOffers = offers;
    for (const offer of offers) {
      this._recentOffers.set(Coinjoin.bodyId(offer), offer);
      this._send(offer);
    }
    for (const offer of previous) {
      this._send(Coinjoin.signBody({
        type: Coinjoin.BODY_TYPES.CANCEL,
        offerId: Coinjoin.bodyId(offer),
        makerPubkey: offer.makerPubkey,
        createdAt: now
      }, identityKey));
    }
    for (const [id, offer] of this._recentOffers) {
      if (offer.expiresAt <= now) this._recentOffers.delete(id);
    }
    this._offersRefreshAt = offers.length ? now + Math.floor(intOr(this.settings.maker.offerTtlMs, 3600000) / 2) : 0;
    return offers;
  }

  /**
   * Turn the Hub maker on or off and set its terms (admin). Pool sizes are
   * the three browser pool targets in BTC; each becomes the top of a band.
   * @param {Object} [opts] `{ enable, poolSizesBtc, feeSats, feePpm, txFeeContributionSats, offerTtlMs }`
   * @returns {Promise<Object>} {@link CoinjoinService#makerStatus}
   */
  createOffer (opts = {}) {
    return this._enqueue(async () => {
      if (!this.available) throw new Error(this.unavailableReason);
      if (!this._makerKey()) throw new Error('the Hub identity has no HD key to derive a maker key from');
      const cfg = this.settings.maker;
      if (opts.poolSizesBtc != null) {
        if (!Array.isArray(opts.poolSizesBtc) || !opts.poolSizesBtc.length) throw new Error('poolSizesBtc must be a list of BTC amounts');
        const pools = opts.poolSizesBtc.map(Number);
        if (pools.some((p) => !(p > 0) || p > 21e6)) throw new Error('pool sizes must be positive BTC amounts');
        cfg.poolSizesBtc = pools;
      }
      for (const field of ['feeSats', 'feePpm', 'txFeeContributionSats', 'offerTtlMs']) {
        if (opts[field] == null) continue;
        const n = Number(opts[field]);
        if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${field} must be a non-negative integer`);
        cfg[field] = n;
      }
      if (cfg.feePpm > this.core.Coinjoin.MAX_FEE_PPM) throw new Error(`feePpm must be at most ${this.core.Coinjoin.MAX_FEE_PPM}`);
      if (cfg.offerTtlMs < 60000) throw new Error('offerTtlMs must be at least a minute');
      this._maker.enabled = opts.enable !== false;
      this._maker.updatedAt = new Date().toISOString();
      await this._write('maker.json', {
        enabled: this._maker.enabled,
        poolSizesBtc: cfg.poolSizesBtc,
        feeSats: cfg.feeSats,
        feePpm: cfg.feePpm,
        txFeeContributionSats: cfg.txFeeContributionSats,
        offerTtlMs: cfg.offerTtlMs,
        updatedAt: this._maker.updatedAt
      });
      await this.refreshOffers();
      return this.makerStatus();
    });
  }

  /** @returns {Object} maker terms and live offers (public) */
  makerStatus () {
    const cfg = this.settings.maker;
    const { Coinjoin } = this.core;
    return {
      enabled: this._maker.enabled,
      makerPubkey: this.makerPubkey,
      poolSizesBtc: cfg.poolSizesBtc,
      feeSats: cfg.feeSats,
      feePpm: cfg.feePpm,
      txFeeContributionSats: cfg.txFeeContributionSats,
      offerTtlMs: cfg.offerTtlMs,
      updatedAt: this._maker.updatedAt,
      offers: Coinjoin ? this._ownOffers.map((o) => Object.assign({ id: Coinjoin.bodyId(o) }, o)) : [],
      liveRounds: this._liveMakerRounds().length
    };
  }

  /**
   * Offers in the book (other makers) plus the Hub's own.
   * @param {Object} [filter] `{ amountSats, makerPubkey }`
   * @returns {Object}
   */
  listOffers (filter = {}) {
    if (this.core.error || !this.book) return { available: false, reason: this.unavailableReason, offers: [], own: [] };
    const amountSats = filter.amountSats != null && filter.amountSats !== '' ? Number(filter.amountSats) : undefined;
    const q = {};
    if (Number.isSafeInteger(amountSats) && amountSats > 0) q.amountSats = amountSats;
    if (filter.makerPubkey) q.makerPubkey = String(filter.makerPubkey);
    return {
      available: this.available,
      network: this.settings.network,
      index: this.book.index(q.amountSats),
      offers: this.book.list(q).map((o) => Object.assign({
        cjfeeSats: q.amountSats ? this.core.Coinjoin.makerFee(o, q.amountSats) : null
      }, o)),
      own: this.makerStatus().offers
    };
  }

  // ---------------------------------------------------------------------------
  // Taker

  /** @private */
  _takerSettings (opts = {}) {
    const t = this.settings.taker;
    return {
      network: this.settings.network,
      adapters: { bitcoin: this.chain, wallet: this.wallet },
      minMakers: intOr(opts.minMakers, t.minMakers),
      feeRateSatVb: Number(opts.feeRateSatVb) || t.feeRateSatVb,
      maxFeeSats: opts.maxFeeSats != null ? Number(opts.maxFeeSats) : (t.maxFeeSats != null ? Number(t.maxFeeSats) : undefined),
      ackTimeoutMs: t.ackTimeoutMs,
      sigTimeoutMs: t.sigTimeoutMs
    };
  }

  /** @private */
  _takerEntry (round, saved = {}) {
    round.on('error', () => {});
    round.on('podle', ({ txid, vout, index }) => {
      const key = `${txid}:${vout}`;
      const used = this._podleUsed[key] || [];
      if (!used.includes(index)) this._podleUsed[key] = used.concat(index);
    });
    return {
      round,
      createdAt: saved.createdAt || Date.now(),
      updatedAt: saved.updatedAt || Date.now(),
      feeRateSatVb: Number(saved.feeRateSatVb) || this.settings.taker.feeRateSatVb,
      error: saved.error || null
    };
  }

  /**
   * Start a coinjoin as taker from the Hub wallet (admin).
   * @param {Object} opts
   * @param {number} opts.amountSats size of every equal output
   * @param {number} [opts.makers] makers to fill (at least `minMakers`)
   * @param {number} [opts.feeRateSatVb]
   * @param {number} [opts.maxFeeSats] most any one maker may charge
   * @param {boolean} [opts.requireBond=false]
   * @returns {Promise<Object>} {@link CoinjoinService#roundView}
   */
  startCoinjoin (opts = {}) {
    return this._enqueue(async () => {
      if (!this.available) throw new Error(this.unavailableReason);
      const { CoinjoinTakerRound } = this.core;
      const amountSats = Number(opts.amountSats);
      if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('amountSats must be a positive integer');
      const settings = this._takerSettings(opts);
      const count = Math.max(settings.minMakers, intOr(opts.makers, settings.minMakers));
      if (this.verifier && Date.now() >= this._bookRefreshAt) await this._refreshBook();
      const exclude = this.makerPubkey ? [this.makerPubkey] : [];
      const offers = this.book.choose(amountSats, count, {
        maxFeeSats: settings.maxFeeSats,
        exclude,
        requireBond: opts.requireBond === true
      });
      const round = new CoinjoinTakerRound(Object.assign({}, settings, { amountSats }));
      const entry = this._takerEntry(round, { feeRateSatVb: settings.feeRateSatVb });
      const out = await round.start(offers);
      this._takerRounds.set(round.roundId, entry);
      for (const msg of out) this._send(msg.envelope);
      this._pruneTakerRounds();
      await this._savePodle();
      await this._saveTaker(entry);
      await this._saveIndex();
      return this.roundView(round.roundId);
    });
  }

  /** @private */
  _pruneTakerRounds () {
    const max = this.settings.maxTakerRounds;
    if (this._takerRounds.size <= max) return;
    for (const [id, entry] of this._takerRounds) {
      if (this._takerRounds.size <= max) break;
      if (TERMINAL_TAKER.includes(entry.round.status)) this._takerRounds.delete(id);
    }
  }

  /** @private */
  async _takerReceive (entry, envelope) {
    try {
      const replies = await entry.round.receive(envelope);
      for (const msg of replies) this._send(msg.envelope);
      entry.error = null;
    } catch (err) {
      entry.error = err.message;
    }
    await this._advanceTaker(entry);
  }

  /** @private */
  async _advanceTaker (entry) {
    const round = entry.round;
    try {
      if (round.status === 'authed') {
        const live = round.makers().filter((m) => !m.dropped);
        if (live.length && live.every((m) => m.stage === 'ioauthed')) {
          for (const msg of await round.buildTx({ feeRateSatVb: entry.feeRateSatVb })) this._send(msg.envelope);
        }
      }
      if (round.status === 'signed') await round.finalize();
    } catch (err) {
      entry.error = err.message;
      await this._abortTaker(entry, err.message);
    }
    await this._saveTaker(entry);
  }

  /** @private */
  async _abortTaker (entry, reason) {
    if (TERMINAL_TAKER.includes(entry.round.status)) return;
    try {
      await entry.round.abort(reason);
    } catch (err) {
      this.emit('warning', `[COINJOIN] abort failed: ${err.message}`);
    }
  }

  /** @private */
  async _tickTaker (entry) {
    const round = entry.round;
    if (TERMINAL_TAKER.includes(round.status)) return;
    if (!round.timedOut().length) return;
    try {
      if (round.status === 'authed' && round.makers().filter((m) => m.stage === 'ioauthed').length >= round.settings.minMakers) {
        for (const msg of await round.buildTx({ feeRateSatVb: entry.feeRateSatVb })) this._send(msg.envelope);
      } else if (round.status === 'built') {
        for (const msg of await round.rebuild({ feeRateSatVb: entry.feeRateSatVb })) this._send(msg.envelope);
      } else if (round.status === 'filled' || round.status === 'authed') {
        entry.error = 'makers did not answer in time';
        await this._abortTaker(entry, entry.error);
      }
    } catch (err) {
      entry.error = err.message;
      await this._abortTaker(entry, err.message);
    }
    await this._saveTaker(entry);
  }

  /**
   * A round this Hub took part in, without keys (admin).
   * @param {string} roundId taker round id, or a maker fill id
   * @returns {Object|null}
   */
  roundView (roundId) {
    const id = String(roundId || '').toLowerCase();
    const taker = this._takerRounds.get(id);
    if (taker) {
      const r = taker.round;
      const plan = r.plan || null;
      return {
        role: 'taker',
        roundId: r.roundId,
        status: r.status,
        amountSats: r.amountSats,
        feeRateSatVb: taker.feeRateSatVb,
        makers: r.makers().map((m) => ({
          makerPubkey: m.makerPubkey,
          offerId: m.offerId,
          stage: m.stage,
          reason: m.reason,
          cjfeeSats: m.cjfeeSats
        })),
        feeSats: plan && plan.feeSats != null ? plan.feeSats : null,
        txid: r.txid,
        error: taker.error,
        history: r.toJSON().history.slice(-20),
        createdAt: taker.createdAt,
        updatedAt: taker.updatedAt
      };
    }
    const maker = this._makerRounds.get(id);
    if (maker) {
      const r = maker.round;
      const saved = r.toJSON();
      const fill = saved.fill;
      return {
        role: 'maker',
        roundId: r.roundId,
        fillId: r.fillId,
        status: r.status,
        amountSats: fill ? fill.amountSats : null,
        cjfeeSats: fill ? this.core.Coinjoin.makerFee(r.offer, fill.amountSats) : null,
        inputs: (r.inputs || []).map((i) => `${i.txid}:${i.vout}`),
        signedTxids: saved.signedTxids,
        released: maker.released,
        error: maker.error,
        history: saved.history.slice(-20),
        createdAt: maker.createdAt,
        updatedAt: maker.updatedAt
      };
    }
    return null;
  }

  /** @returns {Object[]} every round, newest first (admin) */
  listRounds () {
    const ids = [...this._takerRounds.keys(), ...this._makerRounds.keys()];
    return ids.map((id) => this.roundView(id)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Fidelity bonds

  /** @private */
  async _tip () {
    return Number(await this.chain.getTipHeight());
  }

  /** @private */
  _bondById (id) {
    const key = String(id || '').toLowerCase();
    const bond = this._bonds.find((b) => b.id === key || `${b.txid}:${b.vout}` === key);
    if (!bond) throw new Error(`no fidelity bond ${id}`);
    return bond;
  }

  /** @private */
  async _fundBond (address, scriptPubKeyHex, amountSats) {
    if (this._fund) return this._fund(address, scriptPubKeyHex, amountSats);
    const txid = await this._rpc('sendtoaddress', [address, Number((amountSats / 1e8).toFixed(8))], true);
    const tx = await this._rpc('gettransaction', [txid, false, true], true);
    const outs = (tx && tx.decoded && tx.decoded.vout) || [];
    const hit = outs.find((o) => o.scriptPubKey && String(o.scriptPubKey.hex).toLowerCase() === scriptPubKeyHex);
    if (!hit) throw new Error(`bond funding ${txid} has no output to the bond address`);
    return { txid, vout: Number(hit.n) };
  }

  /** @private */
  _certify (bond, tip, certBlocks) {
    const { Bond } = this.core;
    const blocks = Math.min(Math.max(1, intOr(certBlocks, this.settings.bonds.certBlocks)), Bond.FIDELITY_MAX_CERT_BLOCKS);
    const cert = Bond.signFidelityCertificate({
      network: this.settings.network,
      txid: bond.txid,
      vout: bond.vout,
      locktime: bond.locktime,
      makerPubkey: this.makerPubkey,
      certExpiresAt: tip + blocks,
      bondPrivateKey: this._bondKey(bond.index)
    });
    bond.certificate = cert;
    bond.certifiedAt = new Date().toISOString();
    return cert;
  }

  /**
   * Lock Hub wallet coins in a new fidelity bond (admin). The bond key
   * derives from the Hub identity; the certificate binds it to the maker key.
   * @param {Object} opts
   * @param {number} opts.amountSats
   * @param {number} opts.locktime block height (on the 4320-block grid on mainnet)
   * @param {number} [opts.certBlocks]
   * @returns {Promise<Object>} {@link CoinjoinService#bondView}
   */
  createFidelityBond (opts = {}) {
    return this._enqueue(async () => {
      if (!this.available) throw new Error(this.unavailableReason);
      const { Bond, Coinjoin } = this.core;
      if (!this.makerPubkey) throw new Error('the Hub identity has no HD key to derive bond keys from');
      const amountSats = Number(opts.amountSats);
      if (!Number.isSafeInteger(amountSats) || amountSats < Coinjoin.MIN_COINJOIN_SATS) {
        throw new Error(`amountSats must be an integer of at least ${Coinjoin.MIN_COINJOIN_SATS}`);
      }
      const locktime = Number(opts.locktime);
      const tip = await this._tip();
      if (!Bond.isValidFidelityLocktime(locktime, this.settings.network)) throw new Error(`locktime ${opts.locktime} is not allowed on ${this.settings.network}`);
      if (locktime <= tip) throw new Error(`locktime ${locktime} has already passed (tip ${tip})`);
      const index = this._bonds.reduce((m, b) => Math.max(m, Number(b.index) + 1), 0);
      const bondKey = this._bondKey(index);
      const out = Bond.buildFidelity({
        networkName: this.settings.network,
        bondPubkey: Coinjoin.pubkeyFromPrivate(bondKey),
        locktime
      });
      const funded = await this._fundBond(out.address, out.scriptPubKeyHex, amountSats);
      const bond = {
        id: `${String(funded.txid).toLowerCase()}-${Number(funded.vout)}`,
        index,
        network: this.settings.network,
        txid: String(funded.txid).toLowerCase(),
        vout: Number(funded.vout),
        valueSats: amountSats,
        locktime,
        address: out.address,
        scriptPubKeyHex: out.scriptPubKeyHex,
        bondXOnly: out.bondXOnly,
        createdAt: new Date().toISOString(),
        certificate: null,
        redeemTxid: null
      };
      this._certify(bond, tip, opts.certBlocks);
      this._bonds.push(bond);
      await this._saveBond(bond);
      if (this._maker.enabled) await this.refreshOffers();
      return this.bondView(bond, tip);
    });
  }

  /**
   * One bond with its chain status and current value.
   * @param {Object} bond stored record
   * @param {number} tip
   * @returns {Promise<Object>}
   */
  async bondView (bond, tip) {
    const { Bond } = this.core;
    let utxo = null;
    if (!bond.redeemTxid) {
      try {
        utxo = await this.chain.getTxOut(bond.txid, bond.vout);
      } catch (_) {}
    }
    const confirmations = utxo ? Number(utxo.confirmations) || 0 : 0;
    const confirmHeight = confirmations > 0 ? tip - confirmations + 1 : (bond.confirmHeight || null);
    if (confirmations > 0) bond.confirmHeight = confirmHeight;
    let status = 'unconfirmed';
    if (bond.redeemTxid) status = 'redeemed';
    else if (!utxo && bond.confirmHeight) status = 'spent';
    else if (confirmations >= this.settings.bonds.minConfs) status = 'confirmed';
    else if (confirmations > 0) status = 'confirming';
    const cert = bond.certificate;
    const certLive = !!(cert && cert.certExpiresAt > tip);
    const unspent = status === 'confirmed' || status === 'confirming' || status === 'unconfirmed';
    return {
      id: bond.id,
      index: bond.index,
      txid: bond.txid,
      vout: bond.vout,
      address: bond.address,
      valueSats: bond.valueSats,
      locktime: bond.locktime,
      status,
      confirmations,
      confirmHeight,
      tipHeight: tip,
      blocksUntilUnlock: Math.max(0, bond.locktime - tip),
      redeemable: unspent && tip >= bond.locktime,
      value: confirmHeight != null && unspent
        ? Bond.fidelityValue({ valueSats: bond.valueSats, locktime: bond.locktime, confirmHeight, tipHeight: tip })
        : 0,
      certExpiresAt: cert ? cert.certExpiresAt : null,
      certBlocksLeft: cert ? Math.max(0, cert.certExpiresAt - tip) : 0,
      live: status === 'confirmed' && certLive,
      redeemTxid: bond.redeemTxid,
      createdAt: bond.createdAt
    };
  }

  /**
   * Every Hub bond with value, confirmation height, lock and certificate state (admin).
   * @returns {Promise<Object>}
   */
  async listFidelityBonds () {
    if (!this.available) return { available: false, reason: this.unavailableReason, bonds: [] };
    const tip = await this._tip();
    const bonds = [];
    for (const bond of this._bonds) bonds.push(await this.bondView(bond, tip));
    const best = bonds.filter((b) => b.live).sort((a, b) => b.value - a.value)[0] || null;
    return {
      available: true,
      network: this.settings.network,
      tipHeight: tip,
      makerPubkey: this.makerPubkey,
      bestBondId: best ? best.id : null,
      locktimes: this.core.Bond.fidelityLocktimes({ tipHeight: tip, networkName: this.settings.network, count: 12 }),
      bonds
    };
  }

  /** @private */
  async _bestBondCertificate () {
    if (!this._bonds.length || !this.chain) return null;
    let tip;
    try {
      tip = await this._tip();
    } catch (_) {
      return null;
    }
    let best = null;
    for (const bond of this._bonds) {
      const view = await this.bondView(bond, tip);
      if (view.live && (!best || view.value > best.value)) best = { value: view.value, cert: bond.certificate };
    }
    return best ? best.cert : null;
  }

  /**
   * Re-sign a bond's certificate with a new expiry (admin).
   * @param {Object} opts `{ id, certBlocks? }`
   * @returns {Promise<Object>}
   */
  renewBondCertificate (opts = {}) {
    return this._enqueue(async () => {
      if (!this.available) throw new Error(this.unavailableReason);
      const bond = this._bondById(opts.id);
      if (bond.redeemTxid) throw new Error('bond already redeemed');
      const tip = await this._tip();
      this._certify(bond, tip, opts.certBlocks);
      await this._saveBond(bond);
      if (this._maker.enabled) await this.refreshOffers();
      return this.bondView(bond, tip);
    });
  }

  /**
   * Spend a bond back to the Hub wallet once its lock has passed (admin).
   * @param {Object} opts `{ id, destinationAddress?, feeSats? }`
   * @returns {Promise<Object>}
   */
  redeemFidelityBond (opts = {}) {
    return this._enqueue(async () => {
      if (!this.available) throw new Error(this.unavailableReason);
      const { Bond } = this.core;
      const bond = this._bondById(opts.id);
      if (bond.redeemTxid) throw new Error('bond already redeemed');
      const tip = await this._tip();
      if (tip < bond.locktime) throw new Error(`bond is locked until block ${bond.locktime} (tip ${tip})`);
      const utxo = await this.chain.getTxOut(bond.txid, bond.vout);
      if (!utxo) throw new Error('bond output is spent or unknown');
      let destination = String(opts.destinationAddress || '').trim();
      if (!destination) {
        destination = this._newAddress
          ? await this._newAddress()
          : await this._rpc('getnewaddress', ['', 'bech32m'], true);
      }
      const psbt = Bond.prepareFidelityRedeem({
        networkName: this.settings.network,
        bond: {
          txid: bond.txid,
          vout: bond.vout,
          valueSats: Number(utxo.valueSats),
          locktime: bond.locktime,
          bondXOnly: bond.bondXOnly
        },
        destinationAddress: destination,
        feeSats: intOr(opts.feeSats, this.settings.bonds.redeemFeeSats)
      });
      const signed = Bond.signFidelityRedeem(psbt, this._bondKey(bond.index));
      await this.chain.broadcast(signed.txHex);
      bond.redeemTxid = signed.txid;
      bond.redeemedAt = new Date().toISOString();
      bond.redeemAddress = destination;
      await this._saveBond(bond);
      if (this._maker.enabled) await this.refreshOffers();
      return this.bondView(bond, tip);
    });
  }

  // ---------------------------------------------------------------------------
  // Housekeeping

  /** @private */
  async _refreshBook () {
    this.book.prune();
    if (this.verifier) {
      try {
        await this.book.refreshBonds(this.verifier);
      } catch (err) {
        this.emit('warning', `[COINJOIN] bond refresh failed: ${err.message}`);
      }
    }
    this._bookRefreshAt = Date.now() + this.settings.bookRefreshMs;
  }

  /** @private */
  async _tickMaker (entry) {
    const round = entry.round;
    const age = Date.now() - entry.createdAt;
    if (entry.released || round.status === 'aborted') return;
    if (round.status !== 'signed') {
      if (age < this.settings.maker.roundTtlMs) return;
      try {
        await round.abort('taker went quiet');
      } catch (_) {}
      await this._saveMaker(entry);
      return;
    }
    if (age < this.settings.maker.signedHoldMs) return;
    // The taker never broadcast: free the coins (spending them elsewhere voids the signature).
    const inputs = round.inputs || [];
    let unspent = 0;
    for (const input of inputs) {
      try {
        if (await this.chain.getTxOut(input.txid, input.vout)) unspent++;
      } catch (_) {}
    }
    if (unspent === inputs.length && typeof this.wallet.releaseInputs === 'function') {
      try {
        await this.wallet.releaseInputs(inputs);
      } catch (err) {
        this.emit('warning', `[COINJOIN] release failed: ${err.message}`);
      }
    }
    entry.released = true;
    await this._saveMaker(entry);
  }

  /**
   * Time out stalled rounds, re-sign offers before they expire, and re-check
   * bonds in the book. Runs every `tickMs`.
   */
  async tick () {
    if (!this.available || !this.book) return;
    for (const entry of [...this._takerRounds.values()]) await this._tickTaker(entry);
    for (const entry of [...this._makerRounds.values()]) await this._tickMaker(entry);
    const now = Date.now();
    if (this._maker.enabled && now >= this._offersRefreshAt) await this.refreshOffers();
    if (now >= this._bookRefreshAt) await this._refreshBook();
  }

  /** @returns {Object} public capabilities and counts */
  status () {
    return {
      type: 'CoinjoinStatus',
      available: this.available,
      reason: this.unavailableReason,
      network: this.settings.network,
      contract: this.contractId,
      scriptType: this.core.Coinjoin ? this.core.Coinjoin.SCRIPT_TYPE : null,
      book: this.book ? this.book.index() : null,
      maker: this.makerStatus(),
      rounds: {
        taker: this._takerRounds.size,
        maker: this._makerRounds.size
      },
      bonds: this._bonds.length
    };
  }
}

module.exports = CoinjoinService;
