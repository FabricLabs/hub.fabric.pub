'use strict';

/**
 * Availability challenges for the paid-hosting market (Phase 3).
 *
 * Issues Merkle-leaf challenges (core `types/challenge`) stamped with the
 * Beacon epoch, verifies provider responses, records commitments / responses /
 * fraud proofs, and keeps the publisher-side bounty bonds (core `types/bond`)
 * for `StorageContract` rows. Every artifact is a plain JSON body carried as a
 * `CONTRACT_MESSAGE` under the market namespace — no new opcodes. A failed
 * response yields a `FraudProof` that is persisted, fed to the local offer book,
 * and gossiped; a passed response reveals that epoch's bounty preimage to the
 * provider (returned on the response, never flooded).
 *
 * Bonds are regtest / signet only (core `Bond` refuses mainnet).
 */
const crypto = require('crypto');
const Service = require('@fabric/core/types/service');
const Challenge = require('@fabric/core/types/challenge');
const Bond = require('@fabric/core/types/bond');
const Witness = require('@fabric/core/types/witness');
const { MILLISECONDS_PER_HOUR, MILLISECONDS_PER_DAY } = require('../constants');

const { FraudProof } = Witness;

const CADENCE_MS = {
  hourly: MILLISECONDS_PER_HOUR,
  daily: MILLISECONDS_PER_DAY,
  weekly: 7 * MILLISECONDS_PER_DAY,
  monthly: 30 * MILLISECONDS_PER_DAY
};

/** Deterministic market namespace id for `CONTRACT_MESSAGE` bodies. */
const MARKET_CONTRACT_ID = crypto.createHash('sha256').update('fabric-document-market').digest('hex');

const INGESTED_TYPES = new Set(['AvailabilityCommitment', 'AvailabilityResponse', 'FraudProof', 'DepositPenaltyPreSig']);
const HEX64 = /^[0-9a-f]{64}$/;

/** @private display-order block hash of an 80-byte header, or null */
function blockHashFromHeader (headerHex) {
  const hex = String(headerHex || '').toLowerCase();
  if (!/^[0-9a-f]{160}$/.test(hex)) return null;
  const once = crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest();
  return Buffer.from(crypto.createHash('sha256').update(once).digest()).reverse().toString('hex');
}

/** @private txid of a raw transaction hex, or null */
function txidFromHex (txHex) {
  try {
    return require('bitcoinjs-lib').Transaction.fromHex(String(txHex || '').trim()).getId();
  } catch (_) { return null; }
}

class ChallengeService extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Challenge',
      enable: true,
      persistPath: 'fabric/storage-challenges.json',
      bondsPath: 'fabric/market-bonds.json',
      contract: MARKET_CONTRACT_ID,
      deadlineEpochs: 2,
      // Blocks after the issuing tip by which a provider must answer (timelocked
      // non-response: the provider's pre-signed penalty carries this nLockTime).
      deadlineBlocks: 144,
      network: 'regtest'
    }, settings);

    this.hub = null;
    this.fs = null;
    this.book = null;
    this.key = null;
    this.challenger = new Challenge({ deadlineEpochs: this.settings.deadlineEpochs });

    /** @type {Map<string, object>} Storage contract id → schedule record */
    this._challenges = new Map();
    /** @type {Map<string, object>} challenge hash → `{ challenge, response, verdict, reveal }` */
    this._issued = new Map();
    /** @type {Map<string, object>} commitment hash → signed commitment */
    this._commitments = new Map();
    /** @type {Map<string, object>} proof hash → `{ body, verdict }` */
    this._proofs = new Map();
    /** @type {Map<string, object>} storage contract id → `{ record, seedHex }` */
    this._bonds = new Map();
    /** @type {Map<string, object>} `txid:vout` → provider deposit `{ txid, vout, providerPubkey (x-only), deposit? }` */
    this._deposits = new Map();
    /** @type {Map<string, object>} `txid:vout:deadlineHeight` → provider-signed `DepositPenaltyPreSig` */
    this._penaltyPreSigs = new Map();
    /** @type {function|null} host chain view `() → number` (Bitcoin tip height) */
    this._tipHeight = null;
    /** @type {function|null} host chain view `(txid, vout) → boolean` (outpoint still unspent) */
    this._outpointUnspent = null;
    /** @type {function|null} host chain view `(blockHash) → boolean` (block on our best chain) */
    this._headerKnown = null;
    /** @type {function|null} host chain view `(txid) → boolean` (transaction confirmed) */
    this._txConfirmed = null;
    this._blockConfirmations = null;
  }

  static get MARKET_CONTRACT_ID () { return MARKET_CONTRACT_ID; }

  attach (deps = {}) {
    if (deps.hub) this.hub = deps.hub;
    if (deps.fs) this.fs = deps.fs;
    if (deps.book) this.book = deps.book;
    if (deps.key) this.key = deps.key;
    if (!this.book && this.hub && this.hub.market && this.hub.market.book) this.book = this.hub.market.book;
    if (!this.key && this.hub && this.hub._rootKey) this.key = this.hub._rootKey;
    if (typeof deps.tipHeight === 'function') this._tipHeight = deps.tipHeight;
    if (typeof deps.outpointUnspent === 'function') this._outpointUnspent = deps.outpointUnspent;
    if (typeof deps.headerKnown === 'function') this._headerKnown = deps.headerKnown;
    if (typeof deps.txConfirmed === 'function') this._txConfirmed = deps.txConfirmed;
    if (typeof deps.blockConfirmations === 'function') this._blockConfirmations = deps.blockConfirmations;
    return this;
  }

  // --- clocks / keys -----------------------------------------------------------

  /**
   * Bitcoin tip height from the host (`attach({ tipHeight })`) or the Hub
   * Bitcoin service; `null` when unknown — timelocked proofs then wait.
   * @returns {number|null}
   */
  tipHeight () {
    try {
      if (this._tipHeight) { const h = Number(this._tipHeight()); return Number.isFinite(h) && h > 0 ? h : null; }
      const btc = this.hub && this.hub.bitcoin;
      const h = Number(btc && btc.height);
      return Number.isFinite(h) && h > 0 ? h : null;
    } catch (_) { return null; }
  }

  /**
   * Whether a deposit outpoint is still unspent in our chain view
   * (`attach({ outpointUnspent })`, else Hub bitcoind `gettxout`). `null` when unknown.
   * @param {string} txid
   * @param {number} vout
   * @returns {Promise<boolean|null>}
   */
  async outpointUnspent (txid, vout) {
    try {
      if (this._outpointUnspent) return !!(await this._outpointUnspent(txid, vout));
      const btc = this.hub && this.hub.bitcoin;
      if (!btc || typeof btc._makeRPCRequest !== 'function') return null;
      const out = await btc._makeRPCRequest('gettxout', [String(txid), Number(vout), true]);
      return out != null;
    } catch (_) { return null; }
  }

  /**
   * Whether a block is on our best chain (`attach({ headerKnown })`, else Hub
   * bitcoind `getblockheader`). `null` when unknown.
   * @param {string} blockHash display-order hex
   * @returns {Promise<boolean|null>}
   */
  async headerKnown (blockHash) {
    const hash = String(blockHash || '').toLowerCase();
    if (!HEX64.test(hash)) return null;
    try {
      if (this._headerKnown) return !!(await this._headerKnown(hash));
      const btc = this.hub && this.hub.bitcoin;
      if (!btc || typeof btc._makeRPCRequest !== 'function') return null;
      const header = await btc._makeRPCRequest('getblockheader', [hash, true]);
      // `confirmations: -1` marks a known header that is not on the best chain.
      return !!header && Number(header.confirmations) > 0;
    } catch (e) {
      return /not found/i.test(String(e && e.message ? e.message : e)) ? false : null;
    }
  }

  /**
   * Depth of a block in our chain view (`attach({ blockConfirmations })`, else
   * Hub bitcoind `getblockheader`); 0 off the best chain, `null` when unknown.
   * @param {string} blockHash
   * @returns {Promise<number|null>}
   */
  async blockConfirmations (blockHash) {
    const hash = String(blockHash || '').toLowerCase();
    if (!HEX64.test(hash)) return null;
    try {
      if (this._blockConfirmations) return Number(await this._blockConfirmations(hash)) || 0;
      const btc = this.hub && this.hub.bitcoin;
      if (!btc || typeof btc._makeRPCRequest !== 'function') return null;
      const header = await btc._makeRPCRequest('getblockheader', [hash, true]);
      return header ? Math.max(0, Number(header.confirmations) || 0) : 0;
    } catch (e) {
      return /not found/i.test(String(e && e.message ? e.message : e)) ? 0 : null;
    }
  }

  /**
   * Confirmations of a transaction in our chain view (Hub bitcoind
   * `getrawtransaction` — wallet / txindex permitting). `null` when unknown.
   * @param {string} txid
   * @returns {Promise<number|null>}
   */
  async txConfirmations (txid) {
    const id = String(txid || '').toLowerCase();
    if (!HEX64.test(id)) return null;
    try {
      const btc = this.hub && this.hub.bitcoin;
      if (!btc || typeof btc._makeRPCRequest !== 'function') return null;
      const tx = await btc._makeRPCRequest('getrawtransaction', [id, true]);
      return tx ? Math.max(0, Number(tx.confirmations) || 0) : 0;
    } catch (_) { return null; }
  }

  /**
   * Whether a transaction is confirmed in our chain view (`attach({ txConfirmed })`,
   * else Hub bitcoind `getrawtransaction` — wallet / txindex permitting). `null` when unknown.
   * @param {string} txid
   * @returns {Promise<boolean|null>}
   */
  async txConfirmed (txid) {
    const id = String(txid || '').toLowerCase();
    if (!HEX64.test(id)) return null;
    try {
      if (this._txConfirmed) return !!(await this._txConfirmed(id));
      const btc = this.hub && this.hub.bitcoin;
      if (!btc || typeof btc._makeRPCRequest !== 'function') return null;
      const tx = await btc._makeRPCRequest('getrawtransaction', [id, true]);
      return !!tx && Number(tx.confirmations) > 0;
    } catch (_) { return null; }
  }

  /**
   * Resolve the async chain view a `FraudProof` needs into the boolean-returning
   * callbacks core's synchronous verifier accepts: deposit outpoint (timelocked
   * absence), inclusion header (stale commitment / wrongful penalty), and
   * broadcast-tx confirmation.
   * @param {object} body FraudProof body
   * @returns {Promise<object>} ctx for {@link ChallengeService#recordProof}
   */
  async chainViewFor (body) {
    const ctx = {};
    const a = (body && body.artifacts) || {};
    const dep = a.challenge && a.challenge.deposit;
    if (body && body.kind === 'non-response' && dep && dep.txid) {
      const unspent = await this.outpointUnspent(dep.txid, dep.vout);
      if (unspent != null) ctx.outpointUnspent = () => unspent;
    }
    const txHex = body && body.kind === 'stale-commitment' ? a.staleTxHex
      : (body && body.kind === 'wrongful-penalty' ? a.penaltyTxHex : null);
    if (!txHex) return ctx;
    const inclusion = a.inclusion && typeof a.inclusion === 'object' ? a.inclusion : null;
    const blockHash = inclusion ? blockHashFromHeader(inclusion.blockHeaderHex) : null;
    if (blockHash) {
      const known = await this.headerKnown(blockHash);
      if (known != null) ctx.headerKnown = (h) => known && String(h || '').toLowerCase() === blockHash;
      const depth = known ? await this.blockConfirmations(blockHash) : null;
      if (depth != null) ctx.confirmations = (h) => (String(h || '').toLowerCase() === blockHash ? depth : 0);
    }
    const txid = txidFromHex(txHex);
    if (txid && !ctx.headerKnown) {
      // Core reads `txConfirmed(txid, depth)` as "at least depth deep", so a
      // boolean is only trusted from a host hook; RPC answers with the count.
      const count = this._txConfirmed ? null : await this.txConfirmations(txid);
      if (count != null) {
        ctx.txConfirmations = (id) => (String(id || '').toLowerCase() === txid ? count : 0);
      } else {
        const confirmed = await this.txConfirmed(txid);
        if (confirmed != null) ctx.txConfirmed = (id) => confirmed && String(id || '').toLowerCase() === txid;
      }
    }
    return ctx;
  }

  /**
   * Publisher-chosen penalty destination for a deposit: per-deposit override,
   * else `settings.penaltyAddress` / `settings.minPenaltySats`. The provider
   * never picks where its forfeited deposit goes.
   * @private
   * @param {object} [known] registered deposit row
   * @returns {{ penaltyAddress?: string, minPenaltySats?: number }}
   */
  _penaltyTerms (known = {}) {
    const out = {};
    const address = (known && known.penaltyAddress) || this.settings.penaltyAddress || null;
    if (address) out.penaltyAddress = String(address);
    const min = Number((known && known.minPenaltySats) != null ? known.minPenaltySats : this.settings.minPenaltySats);
    if (Number.isInteger(min) && min > 0) out.minPenaltySats = min;
    return out;
  }

  /**
   * Register a provider's deposit outpoint so challenges can be timelock-bound.
   * @param {object} dep `{ txid, vout, providerPubkey (x-only or compressed), deposit?, penaltyAddress?, minPenaltySats? }`
   * @returns {string} key `txid:vout`
   */
  registerDeposit (dep = {}) {
    const txid = String(dep.txid || '').toLowerCase();
    const vout = Number(dep.vout) || 0;
    if (!HEX64.test(txid)) throw new Error('registerDeposit: txid required');
    const pk = String(dep.providerPubkey || '').toLowerCase();
    const key = `${txid}:${vout}`;
    const row = { txid, vout, providerPubkey: pk.length === 66 ? pk.slice(2) : pk, deposit: dep.deposit || null };
    if (dep.penaltyAddress) row.penaltyAddress = String(dep.penaltyAddress);
    if (Number.isInteger(Number(dep.minPenaltySats)) && Number(dep.minPenaltySats) > 0) row.minPenaltySats = Number(dep.minPenaltySats);
    this._deposits.set(key, row);
    return key;
  }

  /** @private most recent deposit registered for a provider (x-only hex) */
  _depositFor (providerXOnly) {
    const x = String(providerXOnly || '').toLowerCase();
    let hit = null;
    for (const d of this._deposits.values()) if (d.providerPubkey === x) hit = d;
    return hit;
  }

  /**
   * Record a provider's pre-signed penalty for a round (`DepositPenaltyPreSig`).
   * Verified against the registered deposit; the provider must hand this over
   * **before** the round whose deadline it names is live.
   * @param {object} body signed artifact
   * @returns {{ ok: boolean, key?: string, error?: string }}
   */
  recordPenaltyPreSig (body) {
    if (!body || body.type !== 'DepositPenaltyPreSig') return { ok: false, error: 'not a DepositPenaltyPreSig' };
    const dep = body.deposit || {};
    const key = `${String(dep.txid || '').toLowerCase()}:${Number(dep.vout) || 0}`;
    const known = this._deposits.get(key);
    if (!known) return { ok: false, error: 'pre-signature names an unregistered deposit' };
    const terms = this._penaltyTerms(known);
    const bond = known.deposit || {};
    const check = Witness.verifyPenaltyPreSig(body, {
      providerPubkey: known.providerPubkey,
      publisherPubkey: bond.publisherPubkey || this.publisherPubkey(),
      depositAddress: bond.address || null,
      deposit: known,
      deadlineHeight: body.deadlineHeight,
      destinationAddress: terms.penaltyAddress,
      minValueSats: terms.minPenaltySats
    });
    if (!check.ok) return { ok: false, error: check.reason };
    const k = `${key}:${Number(body.deadlineHeight)}`;
    this._penaltyPreSigs.set(k, body);
    this.emit('penaltyPreSig', body);
    return { ok: true, key: k };
  }

  /** @private the registered deposit's answer leaf for a planned round */
  _answerPathFor (challenge) {
    const dep = challenge && challenge.deposit;
    const answerHash = challenge && challenge.answerHashHex ? String(challenge.answerHashHex).toLowerCase() : null;
    if (!dep || !answerHash) return undefined;
    const row = this._deposits.get(`${String(dep.txid).toLowerCase()}:${Number(dep.vout) || 0}`);
    if (!row || !row.deposit || String(row.deposit.answerHashHex || '').toLowerCase() !== answerHash) return undefined;
    try {
      const deposit = row.deposit._leaves ? row.deposit : Bond.fromRecord(row.deposit);
      return Bond.answerPath(deposit);
    } catch (_) { return undefined; }
  }

  /** @private pre-signed penalty for a challenge's deposit + deadline */
  _preSigFor (challenge) {
    const dep = challenge && challenge.deposit;
    if (!dep || !challenge.deadlineHeight) return null;
    return this._penaltyPreSigs.get(`${String(dep.txid).toLowerCase()}:${Number(dep.vout) || 0}:${Number(challenge.deadlineHeight)}`) || null;
  }

  /** Current Beacon epoch (0 when no Beacon has sealed yet). */
  epoch () {
    const hub = this.hub;
    try {
      const live = hub && hub.beacon && hub.beacon.state;
      if (live && live.clock != null) return Number(live.clock) || 0;
      const cached = hub && hub._state && hub._state.content && hub._state.content.services &&
        hub._state.content.services.bitcoin && hub._state.content.services.bitcoin.status;
      if (cached && cached.beacon && cached.beacon.clock != null) return Number(cached.beacon.clock) || 0;
    } catch (_) { /* no beacon */ }
    return 0;
  }

  /** @private 32-byte operator private key or null (watch-only hubs cannot issue). */
  _priv () {
    const k = this.key;
    if (!k || !k.private) return null;
    const buf = Buffer.isBuffer(k.private) ? k.private : Buffer.from(String(k.private), 'hex');
    return buf.length === 32 ? buf : null;
  }

  /** Operator compressed pubkey (hex) or null. */
  publisherPubkey () {
    const k = this.key;
    try {
      if (k && k.public && typeof k.public.encodeCompressed === 'function') return k.public.encodeCompressed('hex');
      if (k && k.pubkey) return String(k.pubkey);
    } catch (_) { /* fall through */ }
    return null;
  }

  // --- schedule (legacy StorageContract rows) ---------------------------------

  _nextDueIso (cadence) {
    const ms = CADENCE_MS[String(cadence)] || CADENCE_MS.daily;
    return new Date(Date.now() + ms).toISOString();
  }

  _scheduleRecord (contract) {
    return {
      type: 'Challenge',
      id: `challenge:${contract.id}`,
      contractId: contract.id,
      documentId: contract.document,
      merkleRootHex: contract.merkleRootHex || null,
      challengeCadence: contract.challengeCadence || 'daily',
      responseDeadline: contract.responseDeadline || '10s',
      status: 'scheduled',
      nextChallengeAt: this._nextDueIso(contract.challengeCadence),
      bond: contract.bond ? { type: contract.bond.type, totalSats: contract.bond.totalSats, epochs: (contract.bond.outputs || []).length } : null,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * @param {object} contract Hub `StorageContract` row
   * @returns {Promise<object|null>}
   */
  async registerFromStorageContract (contract) {
    if (!contract || contract.type !== 'StorageContract' || !contract.id) return null;
    const record = this._scheduleRecord(contract);
    this._challenges.set(contract.id, record);
    await this._persist();
    this.emit('debug', `[ChallengeService] registered challenge for contract ${contract.id}`);
    return record;
  }

  /**
   * Ensure every `StorageContract` in hub state has a challenge row.
   * @returns {number} number of newly registered rows
   */
  syncFromHubState () {
    if (!this.hub || !this.hub._state || !this.hub._state.content) return 0;
    const contracts = this.hub._state.content.collections && this.hub._state.content.collections.contracts;
    if (!contracts || typeof contracts !== 'object') return 0;
    let n = 0;
    for (const c of Object.values(contracts)) {
      if (c && c.type === 'StorageContract' && c.id && !this._challenges.has(c.id)) {
        this._challenges.set(c.id, this._scheduleRecord(c));
        n++;
      }
    }
    return n;
  }

  // --- bounty bonds ------------------------------------------------------------

  /**
   * Build the publisher bounty for a storage contract: one Taproot output per
   * epoch, provider hashlock claims, publisher refund after `refundAfterHeight`.
   * The derivation seed stays on this Hub (`bondsPath`); the record is public.
   * @param {object} opts `{ contractId, merkleRootHex, providerPubkeys, amountSats, epochs, startEpoch, refundAfterHeight, network }`
   * @returns {object} `Bond.toRecord` of the bounty
   */
  createBounty (opts = {}) {
    const contractId = String(opts.contractId || '').trim();
    if (!contractId) throw new Error('createBounty: contractId required');
    const publisherPubkey = opts.publisherPubkey || this.publisherPubkey();
    if (!publisherPubkey) throw new Error('createBounty: operator key required');
    const epochCount = Math.max(1, Math.floor(Number(opts.epochs) || 1));
    const total = Math.floor(Number(opts.amountSats) || 0);
    const slice = Math.floor(total / epochCount);
    if (slice < 546) throw new Error(`createBounty: ${total} sats over ${epochCount} epochs is below dust per epoch`);
    const start = Math.max(0, Math.floor(Number(opts.startEpoch != null ? opts.startEpoch : this.epoch() + 1)));
    const seed = crypto.randomBytes(32);
    const bounty = Bond.buildBounty({
      network: opts.network || this.settings.network,
      publisherPubkey,
      providerPubkeys: opts.providerPubkeys,
      seed,
      epochs: Array.from({ length: epochCount }, (_, i) => ({ epoch: start + i, amountSats: slice })),
      refundAfter: Number(opts.refundAfterHeight),
      merkleRootHex: opts.merkleRootHex || null
    });
    const record = Bond.toRecord(bounty);
    this._bonds.set(contractId, { record, seedHex: seed.toString('hex') });
    return record;
  }

  bountyFor (contractId) {
    const b = this._bonds.get(String(contractId));
    return b ? b.record : null;
  }

  /** Reveal `R_{epoch,provider}` for a passed challenge (publisher-side secret). */
  _revealFor (contractId, epoch, providerPubkey33) {
    const b = this._bonds.get(String(contractId || ''));
    if (!b) return null;
    const out = (b.record.outputs || []).find((o) => o.epoch === epoch);
    if (!out || !out.commitments[providerPubkey33]) return null;
    return {
      epoch,
      address: out.address,
      amountSats: out.amountSats,
      preimageHex: Bond.deriveEpochPreimage(b.seedHex, epoch, providerPubkey33)
    };
  }

  // --- commitments / challenges / responses --------------------------------------

  /**
   * Record a provider's signed `AvailabilityCommitment`.
   * @param {object} body
   * @returns {{ ok: boolean, hash?: string, error?: string }}
   */
  commit (body) {
    if (!body || body.type !== 'AvailabilityCommitment') return { ok: false, error: 'not an AvailabilityCommitment' };
    if (!Witness.verifyArtifact(body)) return { ok: false, error: 'commitment signature invalid' };
    const hash = Witness.artifactHash(body);
    this._commitments.set(hash, body);
    this.emit('commitment', body);
    return { ok: true, hash };
  }

  commitmentFor (merkleRootHex, providerPubkey) {
    const root = String(merkleRootHex || '').toLowerCase();
    const pk = String(providerPubkey || '').toLowerCase();
    let best = null;
    for (const c of this._commitments.values()) {
      if (c.merkleRootHex !== root || c.pubkey !== pk) continue;
      if (!best || Number(c.untilEpoch || 0) > Number(best.untilEpoch || 0)) best = c;
    }
    return best;
  }

  /**
   * Issue a challenge for the current epoch.
   * When the provider has a registered deposit and the chain tip is known the
   * challenge is **timelock-bound** (`deadlineHeight = tip + deadlineBlocks`,
   * `deposit` outpoint) so silence can be proved from the provider's
   * pre-signed penalty; otherwise it is epoch-only and silence is only `late`.
   * The signed `deposit` names the publisher's penalty destination
   * (`penaltyAddress` / `minPenaltySats`, from `opts`, the registered deposit, or
   * settings) so a provider pre-signature paying anywhere else never verifies.
   * A timelocked round is only provable when it was planned (`Challenge.planRound`)
   * and the provider's deposit commits its answer hash: pass the plan's
   * `nonceHex` + `answerHashHex` (or `bytesFor` to compute them).
   * @param {object} opts `{ merkleRootHex, blobHashes?, blobTotal?, providerPubkey (x-only hex), contractId?, epoch?, deadlineHeight?, deposit?, penaltyAddress?, minPenaltySats?, nonceHex?, answerHashHex?, bytesFor? }`
   * @returns {object} signed challenge artifact
   */
  issue (opts = {}) {
    const priv = this._priv();
    if (!priv) throw new Error('issue: operator private key required (watch-only hub)');
    const epoch = opts.epoch != null ? Number(opts.epoch) : this.epoch();
    let deposit = opts.deposit ? { txid: opts.deposit.txid, vout: opts.deposit.vout } : null;
    let deadlineHeight = opts.deadlineHeight != null ? Number(opts.deadlineHeight) : null;
    if (!deposit) {
      const known = this._depositFor(opts.providerPubkey);
      if (known) deposit = { txid: known.txid, vout: known.vout };
    }
    if (deposit) {
      const known = this._deposits.get(`${String(deposit.txid || '').toLowerCase()}:${Number(deposit.vout) || 0}`) || {};
      const terms = this._penaltyTerms({
        penaltyAddress: opts.penaltyAddress || (opts.deposit && opts.deposit.penaltyAddress) || known.penaltyAddress,
        minPenaltySats: opts.minPenaltySats != null ? opts.minPenaltySats
          : (opts.deposit && opts.deposit.minPenaltySats != null ? opts.deposit.minPenaltySats : known.minPenaltySats)
      });
      Object.assign(deposit, terms);
    }
    if (deposit && deadlineHeight == null) {
      const tip = this.tipHeight();
      if (tip != null) deadlineHeight = tip + Math.max(1, Number(this.settings.deadlineBlocks) || 144);
    }
    const challenge = this.challenger.issue(Object.assign({
      merkleRootHex: opts.merkleRootHex,
      blobHashes: opts.blobHashes,
      blobTotal: opts.blobTotal,
      epoch,
      providerPubkey: opts.providerPubkey,
      nonceHex: opts.nonceHex,
      answerHashHex: opts.answerHashHex,
      bytesFor: opts.bytesFor,
      publisherPrivateKey: priv
    }, deposit && deadlineHeight != null ? { deposit, deadlineHeight } : {}));
    const hash = Witness.artifactHash(challenge);
    this._issued.set(hash, {
      hash,
      contractId: opts.contractId ? String(opts.contractId) : null,
      challenge,
      response: null,
      verdict: null,
      reveal: null,
      issuedAt: new Date().toISOString()
    });
    this._publish('AvailabilityChallenge', challenge);
    this.emit('challenge', challenge);
    void this._persist();
    return challenge;
  }

  /**
   * Verify a provider response; on failure build + record the fraud proof, on
   * success attach the epoch bounty reveal.
   * @param {object} response signed `AvailabilityResponse`
   * @param {object} [ctx] `{ bytes }` when the hub holds the blob
   * @returns {object} `{ ok, reason, late, fraud, proofHash?, reveal? }`
   */
  respond (response, ctx = {}) {
    if (!response || response.type !== 'AvailabilityResponse') return { ok: false, reason: 'not an AvailabilityResponse' };
    const row = this._issued.get(String(response.challengeHash || ''));
    if (!row) return { ok: false, reason: 'unknown challenge' };
    // First verdict is final: a later honest answer must not flip a recorded
    // fraud (wrong leaf or swept non-response) into a bounty reveal.
    if (row.response || (row.verdict && row.verdict.fraud)) {
      return Object.assign({ duplicate: true }, row.verdict || { ok: false, reason: 'challenge already resolved' });
    }
    const verdict = this.challenger.validate(row.challenge, response, ctx);
    row.response = response;
    row.verdict = verdict;
    row.respondedAt = new Date().toISOString();
    const out = Object.assign({}, verdict);
    if (verdict.ok) {
      const provider33 = this._providerCompressed(row.challenge.providerPubkey);
      row.reveal = provider33 ? this._revealFor(row.contractId, row.challenge.epoch, provider33) : null;
      if (row.reveal) out.reveal = row.reveal;
    } else if (verdict.fraud) {
      const commitment = this.commitmentFor(row.challenge.merkleRootHex, row.challenge.providerPubkey);
      const proof = this.challenger.proofFor(row.challenge, response, { commitment });
      if (proof) out.proofHash = this.recordProof(proof.toBody()).hash;
    }
    this.emit('response', { challenge: row.challenge, response, verdict });
    return out;
  }

  /**
   * Sweep issued challenges whose deadline passed without a response. A
   * `non-response` proof is recorded only when it is actually provable: the
   * challenge is timelock-bound, a commitment exists, the provider's
   * `DepositPenaltyPreSig` for that deadline is held, the chain tip is at or
   * past `deadlineHeight`, **and** the deposit outpoint is still unspent (no
   * check-in). Epoch-only challenges just become `late`.
   * @returns {Promise<number>} proofs recorded
   */
  async sweep () {
    const now = this.epoch();
    const tip = this.tipHeight();
    let n = 0;
    for (const row of this._issued.values()) {
      if (row.response || (row.verdict && row.verdict.fraud)) continue;
      const ch = row.challenge;
      const epochLate = now > Number(ch.deadlineEpoch);
      const heightLate = ch.deadlineHeight != null && tip != null && tip >= Number(ch.deadlineHeight);
      if (!epochLate && !heightLate) continue;
      const ctx = { epoch: now };
      if (tip != null) ctx.tipHeight = tip;
      if (heightLate && ch.deposit) {
        const unspent = await this.outpointUnspent(ch.deposit.txid, ch.deposit.vout);
        if (unspent == null) continue; // no chain view yet — try again later
        ctx.outpointUnspent = () => unspent;
        if (!unspent) {
          // Provider checked in (or the deposit moved): silence is not provable.
          row.verdict = { ok: false, late: true, fraud: null, reason: 'deposit outpoint spent before the deadline (check-in)' };
          continue;
        }
      }
      row.verdict = this.challenger.validate(ch, null, ctx);
      if (!row.verdict.fraud) continue;
      const commitment = this.commitmentFor(ch.merkleRootHex, ch.providerPubkey);
      const penaltyPreSig = this._preSigFor(ch);
      if (!commitment || !penaltyPreSig) continue;
      const proof = this.challenger.proofFor(ch, null, { commitment, penaltyPreSig, answerPath: this._answerPathFor(ch), epoch: now, tipHeight: ctx.tipHeight, outpointUnspent: ctx.outpointUnspent });
      if (proof) { const rec = this.recordProof(proof.toBody(), ctx); if (rec.ok) n++; }
    }
    return n;
  }

  /**
   * Verify and record any `FraudProof` (ours or a peer's); penalize locally.
   * @param {object} body
   * @param {object} [ctx]
   * @returns {{ ok: boolean, hash: string|null, verdict: object, penalized?: string[] }}
   */
  recordProof (body, ctx = {}) {
    const proof = FraudProof.fromBody(body);
    if (!proof) return { ok: false, hash: null, verdict: { ok: false, reason: 'not a FraudProof' } };
    const epoch = ctx.epoch != null ? ctx.epoch : this.epoch();
    // Timelocked proofs need the chain view: tip height + whether the deposit is still unspent.
    const view = { epoch };
    const tip = ctx.tipHeight != null ? ctx.tipHeight : this.tipHeight();
    if (tip != null) view.tipHeight = tip;
    // Core's verifier is synchronous: callers that already resolved the outpoint
    // (sweep) pass a boolean-returning function; an async RPC lookup would be a
    // truthy Promise here, so it is never substituted. Peer-relayed timelock
    // proofs therefore need `ctx.outpointUnspent` from the host (see
    // `ingestContractMessage`), otherwise they are rejected rather than trusted.
    if (typeof ctx.outpointUnspent === 'function') view.outpointUnspent = ctx.outpointUnspent;
    // Same rule for broadcast evidence: resolved by `chainViewFor` before this call.
    if (typeof ctx.headerKnown === 'function') view.headerKnown = ctx.headerKnown;
    if (typeof ctx.confirmations === 'function') view.confirmations = ctx.confirmations;
    if (typeof ctx.txConfirmations === 'function') view.txConfirmations = ctx.txConfirmations;
    if (typeof ctx.txConfirmed === 'function') view.txConfirmed = ctx.txConfirmed;
    const verdict = this.book ? this.book.ingestFraudProof(proof, view) : proof.verify(view);
    // A peer re-relaying a proof we already hold is not an error.
    const held = this._proofs.get(proof.hash);
    if (!verdict.ok && verdict.duplicate && held) return { ok: true, hash: proof.hash, verdict: held.verdict, duplicate: true, penalized: [] };
    if (!verdict.ok) return { ok: false, hash: proof.hash, verdict };
    const hash = proof.hash;
    const fresh = !this._proofs.has(hash);
    this._proofs.set(hash, { hash, body: proof.toBody(), verdict, recordedAt: new Date().toISOString() });
    if (fresh) {
      this._publish('FraudProof', proof.toBody());
      this.emit('fraud', { hash, kind: proof.kind, offender: verdict.offender });
    }
    void this._persist();
    return { ok: true, hash, verdict, penalized: verdict.penalized || [] };
  }

  /**
   * Fold a peer `CONTRACT_MESSAGE` body into this service.
   * @param {object} object message `object` (`{ type, ... }`)
   * @returns {object|null}
   */
  ingestContractMessage (object) {
    const body = object && object.object && object.object.type ? object.object : object;
    if (!body || !INGESTED_TYPES.has(body.type)) return null;
    if (body.type === 'AvailabilityCommitment') return this.commit(body);
    if (body.type === 'AvailabilityResponse') return this.respond(body);
    if (body.type === 'DepositPenaltyPreSig') return this.recordPenaltyPreSig(body);
    return this.recordProof(body);
  }

  /**
   * Like {@link ChallengeService#ingestContractMessage} but resolves the chain
   * view first ({@link ChallengeService#chainViewFor}) so peer-relayed
   * timelocked, stale-commitment, and wrongful-penalty `FraudProof`s can be
   * verified (bitcoind lookups are async on a live Hub).
   * @param {object} object
   * @returns {Promise<object|null>}
   */
  async ingestContractMessageAsync (object) {
    const body = object && object.object && object.object.type ? object.object : object;
    if (!body || body.type !== 'FraudProof') return this.ingestContractMessage(object);
    return this.recordProof(body, await this.chainViewFor(body));
  }

  /** @private x-only → compressed pubkey, using known bounty provider lists. */
  _providerCompressed (xOnlyHex) {
    const x = String(xOnlyHex || '').toLowerCase();
    for (const b of this._bonds.values()) {
      const hit = (b.record.providerPubkeys || []).find((p) => p.slice(2) === x);
      if (hit) return hit;
    }
    return null;
  }

  /** @private gossip an artifact under the market namespace (hub-signed AMP). */
  _publish (type, object) {
    const hub = this.hub;
    if (!hub || !hub.agent || typeof hub.agent.relayFrom !== 'function') return false;
    try {
      const Message = require('@fabric/core/types/message');
      const pubkey = this.publisherPubkey();
      const body = { contract: this.settings.contract, type, actor: pubkey ? { publicKey: pubkey, id: pubkey } : undefined, object };
      const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
      if (this.key && this.key.private) msg.signWithKey(this.key);
      hub.agent.relayFrom('_hub', msg).catch(() => {});
      return true;
    } catch (e) {
      this.emit('warning', `[ChallengeService] publish ${type} failed: ${e && e.message ? e.message : e}`);
      return false;
    }
  }

  // --- persistence ---------------------------------------------------------------

  _loadPersisted () {
    if (!this.fs) return;
    try {
      const raw = this.fs.readFile(this.settings.persistPath);
      if (raw) {
        const data = JSON.parse(raw);
        for (const v of Object.values((data && data.challenges) || {})) if (v && v.contractId) this._challenges.set(String(v.contractId), v);
        for (const v of Object.values((data && data.issued) || {})) if (v && v.hash) this._issued.set(v.hash, v);
        for (const [k, v] of Object.entries((data && data.commitments) || {})) this._commitments.set(k, v);
        for (const [k, v] of Object.entries((data && data.proofs) || {})) this._proofs.set(k, v);
        for (const [k, v] of Object.entries((data && data.deposits) || {})) this._deposits.set(k, v);
        for (const [k, v] of Object.entries((data && data.penaltyPreSigs) || {})) this._penaltyPreSigs.set(k, v);
      }
    } catch (_) {}
    try {
      const raw = this.fs.readFile(this.settings.bondsPath);
      if (raw) {
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries((data && data.bonds) || {})) if (v && v.record) this._bonds.set(k, v);
      }
    } catch (_) {}
  }

  async _persist () {
    if (!this.fs) return;
    const toObj = (m) => { const o = {}; for (const [k, v] of m) o[k] = v; return o; };
    try {
      await this.fs.publish(this.settings.persistPath, {
        challenges: toObj(this._challenges),
        issued: toObj(this._issued),
        commitments: toObj(this._commitments),
        proofs: toObj(this._proofs),
        deposits: toObj(this._deposits),
        penaltyPreSigs: toObj(this._penaltyPreSigs),
        updatedAt: new Date().toISOString()
      });
      await this.fs.publish(this.settings.bondsPath, { bonds: toObj(this._bonds), updatedAt: new Date().toISOString() });
    } catch (e) {
      this.emit('warning', `[ChallengeService] persist failed: ${e && e.message ? e.message : e}`);
    }
  }

  // --- views ---------------------------------------------------------------------

  list () {
    return Array.from(this._challenges.values());
  }

  listIssued () {
    return Array.from(this._issued.values()).map((r) => ({
      hash: r.hash,
      contractId: r.contractId,
      merkleRootHex: r.challenge.merkleRootHex,
      blobIndex: r.challenge.blobIndex,
      epoch: r.challenge.epoch,
      deadlineEpoch: r.challenge.deadlineEpoch,
      deadlineHeight: r.challenge.deadlineHeight != null ? r.challenge.deadlineHeight : null,
      deposit: r.challenge.deposit || null,
      providerPubkey: r.challenge.providerPubkey,
      status: r.verdict ? (r.verdict.ok ? 'passed' : (r.verdict.late ? 'late' : 'failed')) : 'open',
      issuedAt: r.issuedAt
    }));
  }

  getIssued (hash) {
    return this._issued.get(String(hash)) || null;
  }

  listProofs () {
    return Array.from(this._proofs.values());
  }

  listCommitments () {
    return Array.from(this._commitments.values());
  }

  getByContractId (contractId) {
    return this._challenges.get(String(contractId)) || null;
  }

  getCapabilities () {
    const list = this.list();
    return {
      service: 'challenge',
      available: this.settings.enable !== false,
      endpointBasePath: '/services/challenges',
      contract: this.settings.contract,
      canIssue: !!this._priv(),
      epoch: this.epoch(),
      count: list.length,
      issued: this._issued.size,
      commitments: this._commitments.size,
      proofs: this._proofs.size,
      bonds: this._bonds.size
    };
  }

  async start () {
    this._loadPersisted();
    const added = this.syncFromHubState();
    if (added > 0) await this._persist();
    return this;
  }
}

module.exports = ChallengeService;
