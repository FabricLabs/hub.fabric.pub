'use strict';

/**
 * @fileoverview Named federations across Hubs. A federation is keyed by the hash of
 * its descriptor (validators, threshold, ladder, publisher), so every member Hub
 * derives the same id and the same Taproot vault. Members talk over Fabric
 * `CONTRACT_MESSAGE` (namespace = federation id) signed with each Hub's root key:
 * invites and responses, then withdrawal requests and signatures. Nothing is
 * signed without the operator approving it.
 *
 * Members without a Fabric peer (Passport) use the mailbox: the Hub keeps every
 * verified federation frame it sends, receives, or is handed over HTTP, serves
 * them by member pubkey, and relays posted frames onto the mesh.
 */

const { Transaction } = require('bitcoinjs-lib');
const Service = require('@fabric/core/types/service');
const Federation = require('@fabric/core/types/federation');
const { pubkeyXOnly } = require('@fabric/core/functions/pubkey');
const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');

const TYPES = Federation.MESSAGE_TYPES;

// Rough vsize of a 1-input 2-of-3 tapscript spend with change (sized up for larger sets).
const WITHDRAWAL_VBYTES_BASE = 150;
const WITHDRAWAL_VBYTES_PER_KEY = 25;

/** @private */
function parseJson (raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch (_) {
    return null;
  }
}

/** @private */
function compressedPubkey (value) {
  const s = String(value || '').trim().toLowerCase().replace(/^0x/, '');
  return /^0[23][0-9a-f]{64}$/.test(s) ? s : null;
}

/** @private */
function cleanText (value, max) {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** @private */
function cleanUrl (value) {
  const s = cleanText(value, 300);
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : null;
  } catch (_) {
    return null;
  }
}

/** @private */
function sats (value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer (sats)`);
  return n;
}

/** @private */
function btcToSats (btc) {
  return Math.round(Number(btc) * 1e8);
}

class FederationsService extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.network='regtest'] Bitcoin network of this Hub
   * @param {string} [settings.path='named-federations'] Filesystem prefix
   * @param {boolean} [settings.allowMainnet=false] `FABRIC_FEDERATION_MAINNET=1`
   * @param {number} [settings.maxDepositSats] Cap per deposit (mainnet default 1,000,000)
   * @param {number} [settings.maxWithdrawalSats] Cap per withdrawal (mainnet default 1,000,000)
   * @param {number} [settings.maxFeeSats=100000] Highest withdrawal fee a member signs
   * @param {number} [settings.maxFeeRateSatVb=500]
   * @param {number} [settings.tickMs=30000] Re-send interval for pending invites / withdrawals
   * @param {number} [settings.mailboxSize=2000] Frames kept for members without a peer
   * @param {number} [settings.mailboxPageSize=200] Most frames per mailbox read
   * @param {number} [settings.vaultCacheMs=30000] How long a public vault read is reused
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: 'Federations',
      network: 'regtest',
      path: 'named-federations',
      allowMainnet: false,
      maxDepositSats: null,
      maxWithdrawalSats: null,
      maxFeeSats: 100000,
      maxFeeRateSatVb: 500,
      defaultFeeRateSatVb: 2,
      tickMs: 30000,
      resendMinMs: 10000,
      mailboxSize: 2000,
      mailboxPageSize: 200,
      vaultCacheMs: 30000
    }, settings);
    this.settings.network = String(this.settings.network || 'regtest').toLowerCase();
    if (this.settings.network === 'mainnet') {
      if (this.settings.maxDepositSats == null) this.settings.maxDepositSats = 1000000;
      if (this.settings.maxWithdrawalSats == null) this.settings.maxWithdrawalSats = 1000000;
    }
    this.fs = null;
    this.key = null;
    this._publish = null;
    this._rpc = null;
    this._walletSend = null;
    this._relay = null;
    this._records = new Map();
    this._mailbox = [];
    this._mailboxIds = new Set();
    this._mailboxSeq = 0;
    this._mailboxTimer = null;
    this._descriptors = new Map();
    this._vaultCache = new Map();
    this._lastSent = new Map();
    this._timer = null;
    this._queue = Promise.resolve();
    this._started = false;
  }

  /**
   * @param {Object} deps
   * @param {Object} [deps.fs] Hub `Filesystem` (`publish`, `readFile`)
   * @param {Object} [deps.key] Hub root `Key` (`pubkey`, `private`)
   * @param {Function} [deps.publish] `(body) => Message|null` sign and flood a `CONTRACT_MESSAGE` (truthy = sent)
   * @param {Function} [deps.relay] `(message) => void` flood a frame another key signed
   * @param {Function} [deps.rpc] `(method, params) => result` node RPC
   * @param {Function} [deps.walletSend] `({ address, amountSats, feeRateSatVb, label }) => txid`
   * @returns {FederationsService}
   */
  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    if (typeof deps.publish === 'function') this._publish = deps.publish;
    if (typeof deps.rpc === 'function') this._rpc = deps.rpc;
    if (typeof deps.walletSend === 'function') this._walletSend = deps.walletSend;
    if (typeof deps.relay === 'function') this._relay = deps.relay;
    return this;
  }

  async start () {
    if (this._started) return this;
    this._started = true;
    const index = this._read('index.json');
    for (const id of (index && Array.isArray(index.ids)) ? index.ids : []) {
      const record = this._read(`${id}.json`);
      if (record && record.id === id && record.descriptor) this._records.set(id, record);
    }
    const mailbox = this._read('mailbox.json');
    if (mailbox && Array.isArray(mailbox.frames)) {
      for (const [id, descriptor] of Object.entries(mailbox.descriptors || {})) this._descriptors.set(id, descriptor);
      for (const f of mailbox.frames) {
        if (!f || !f.id || this._mailboxIds.has(f.id)) continue;
        this._mailbox.push(f);
        this._mailboxIds.add(f.id);
      }
      this._mailboxSeq = Math.max(Number(mailbox.seq) || 0, ...this._mailbox.map((f) => f.seq));
    }
    if (this.settings.tickMs > 0) {
      this._timer = setInterval(() => {
        this._enqueue(() => this.tick()).catch((err) => this.emit('warning', `[FEDERATIONS] tick failed: ${err.message}`));
      }, this.settings.tickMs);
      if (this._timer.unref) this._timer.unref();
    }
    return this;
  }

  async stop () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._mailboxTimer) {
      clearTimeout(this._mailboxTimer);
      this._mailboxTimer = null;
      await this._writeMailbox();
    }
    await this._queue.catch(() => {});
    return this;
  }

  /** @returns {string|null} this Hub's compressed root pubkey */
  get pubkey () {
    return this.key ? compressedPubkey(this.key.pubkey) : null;
  }

  /** @private */
  get _self () {
    const pk = this.pubkey;
    return pk ? pk.slice(2) : null;
  }

  /** @private */
  _privateKey () {
    const k = this.key && this.key.private;
    if (!k) throw new Error('Hub key cannot sign');
    return Buffer.isBuffer(k) ? k : Buffer.from(String(k), 'hex');
  }

  /** @private */
  _enqueue (fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------------------
  // Persistence

  /** @private */
  _read (name) {
    if (!this.fs || typeof this.fs.readFile !== 'function') return null;
    try {
      return parseJson(this.fs.readFile(`${this.settings.path}/${name}`));
    } catch (_) {
      return null;
    }
  }

  /** @private */
  async _save (record) {
    record.updatedAt = Date.now();
    this._records.set(record.id, record);
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    await this.fs.publish(`${this.settings.path}/${record.id}.json`, record);
    await this.fs.publish(`${this.settings.path}/index.json`, { ids: [...this._records.keys()] });
  }

  // ---------------------------------------------------------------------------
  // Gates

  /** @private */
  _checkNetwork (network) {
    if (network !== this.settings.network) {
      throw new Error(`federation is on ${network}; this Hub runs ${this.settings.network}`);
    }
    if (network === 'mainnet' && !this.settings.allowMainnet) {
      throw new Error('mainnet federations need FABRIC_FEDERATION_MAINNET=1');
    }
  }

  /** @private */
  _checkCap (amountSats, cap, what) {
    if (cap != null && amountSats > Number(cap)) throw new Error(`${what} of ${amountSats} sats is over the ${cap} sat cap`);
  }

  // ---------------------------------------------------------------------------
  // Views

  /** @private */
  _record (federationId) {
    const record = this._records.get(String(federationId || '').toLowerCase());
    if (!record) throw new Error('unknown federation');
    return record;
  }

  /** @private */
  _view (record) {
    const self = this._self;
    const me = record.members[self] || null;
    const withdrawals = Object.values(record.withdrawals || {}).map((w) => ({
      requestId: w.requestId,
      requester: w.requester,
      destinationAddress: w.destinationAddress,
      amountSats: w.amountSats,
      feeSats: w.feeSats,
      input: { txid: w.txid, vout: w.vout, sats: w.inputSats },
      changeSats: w.changeSats,
      signers: Object.keys(w.signatures || {}),
      signedBySelf: !!(w.signatures && w.signatures[self]),
      status: w.status,
      txid: w.broadcastTxid || null,
      error: w.error || null,
      createdAt: w.createdAt
    })).sort((a, b) => b.createdAt - a.createdAt);
    return {
      id: record.id,
      name: record.name,
      network: record.descriptor.network,
      threshold: record.descriptor.threshold,
      validators: record.descriptor.validators,
      publisher: record.descriptor.publisher,
      csvBlocks: record.descriptor.ladder.csvBlocks,
      vaultAddress: record.vaultAddress,
      status: record.status,
      source: record.source || 'created',
      self: this.pubkey,
      selfStatus: me ? me.status : null,
      isPublisher: record.descriptor.publisher.slice(2) === self,
      members: record.descriptor.validators.map((pk) => {
        const m = record.members[pk.slice(2)] || {};
        return { pubkey: pk, url: m.url || null, alias: m.alias || null, status: m.status || 'invited', self: pk.slice(2) === self };
      }),
      deposits: (record.deposits || []).slice(-50),
      withdrawals,
      descriptor: record.descriptor,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  /** @returns {Object[]} */
  list () {
    return [...this._records.values()].map((r) => this._view(r)).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Things waiting on this operator: invites to answer, withdrawals to approve.
   * @returns {{ invites: Object[], withdrawals: Object[] }}
   */
  pending () {
    const invites = [];
    const withdrawals = [];
    for (const view of this.list()) {
      if (view.selfStatus === 'invited') invites.push(view);
      for (const w of view.withdrawals) {
        if (w.status === 'pending' && !w.signedBySelf) withdrawals.push({ federation: { id: view.id, name: view.name, threshold: view.threshold }, ...w });
      }
    }
    return { invites, withdrawals };
  }

  /**
   * One federation with its vault UTXOs and balance.
   * @param {string} federationId
   * @returns {Promise<Object>}
   */
  async get (federationId) {
    const view = this._view(this._record(federationId));
    try {
      const utxos = await this.vaultUtxos(view.vaultAddress);
      view.utxos = utxos;
      view.balanceSats = utxos.reduce((sum, u) => sum + u.sats, 0);
    } catch (err) {
      view.utxos = null;
      view.balanceSats = null;
      view.balanceError = err.message;
    }
    return view;
  }

  // ---------------------------------------------------------------------------
  // Chain

  /** @private */
  async _call (method, params = []) {
    if (!this._rpc) throw new Error('Bitcoin is not available');
    const out = await this._rpc(method, params);
    if (out && typeof out === 'object' && out.error) throw new Error(out.error.message || String(out.error));
    return out;
  }

  /**
   * Confirmed UTXOs at a vault address.
   * @param {string} address
   * @returns {Promise<Array<{ txid: string, vout: number, sats: number, height: number }>>}
   */
  async vaultUtxos (address) {
    let scan;
    for (let attempt = 0; ; attempt++) {
      try {
        scan = await this._call('scantxoutset', ['start', [`addr(${address})`]]);
        break;
      } catch (err) {
        if (attempt >= 10 || !/scan already in progress/i.test(String(err && err.message))) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return ((scan && scan.unspents) || []).map((u) => ({
      txid: u.txid,
      vout: u.vout,
      sats: btcToSats(u.amount),
      height: u.height
    })).sort((a, b) => a.sats - b.sats);
  }

  /** @private */
  async _rawTransaction (txid, height) {
    if (height != null) {
      try {
        const blockhash = await this._call('getblockhash', [Number(height)]);
        const hex = await this._call('getrawtransaction', [txid, false, blockhash]);
        if (typeof hex === 'string') return hex;
      } catch (_) { /* fall back to txindex */ }
    }
    const hex = await this._call('getrawtransaction', [txid, false]);
    if (typeof hex !== 'string') throw new Error(`transaction ${txid} not found`);
    return hex;
  }

  // ---------------------------------------------------------------------------
  // Create / join

  /**
   * Create a federation with this Hub as publisher and invite the others.
   * @param {Object} opts
   * @param {string} [opts.name]
   * @param {Array<{ pubkey: string, url?: string, alias?: string }>} opts.members Other Hubs (this Hub is added)
   * @param {number} opts.threshold
   * @param {number} [opts.csvBlocks]
   * @returns {Promise<Object>}
   */
  async create (opts = {}) {
    const self = this.pubkey;
    if (!self) throw new Error('Hub key unavailable');
    this._checkNetwork(this.settings.network);
    const members = Array.isArray(opts.members) ? opts.members : [];
    const descriptor = Federation.buildDescriptor({
      validators: [self, ...members.map((m) => (m && typeof m === 'object') ? m.pubkey : m)],
      threshold: opts.threshold,
      network: this.settings.network,
      publisher: self,
      csvBlocks: opts.csvBlocks
    });
    if (descriptor.validators.length > 1 && descriptor.threshold < 2) {
      throw new Error('a multi-Hub federation needs a threshold of at least 2');
    }
    const id = Federation.descriptorId(descriptor);
    let record = this._records.get(id);
    if (!record) {
      record = this._newRecord(id, descriptor, cleanText(opts.name, 80));
      for (const m of members) {
        if (!m || typeof m !== 'object') continue;
        const x = pubkeyXOnly(m.pubkey);
        if (!x || !record.members[x]) continue;
        record.members[x].url = cleanUrl(m.url);
        record.members[x].alias = cleanText(m.alias, 80);
      }
      record.members[self.slice(2)].status = 'accepted';
      this._refreshStatus(record);
      await this._save(record);
    }
    this._sendInvite(record, true);
    return this._view(record);
  }

  /** @private */
  _newRecord (id, descriptor, name) {
    const vault = Federation.vaultForDescriptor(descriptor);
    const members = {};
    for (const pk of descriptor.validators) members[pk.slice(2)] = { pubkey: pk, status: 'invited', url: null, alias: null };
    return {
      id,
      name: name || `Federation ${id.slice(0, 8)}`,
      descriptor,
      vaultAddress: vault.address,
      members,
      status: 'pending',
      deposits: [],
      withdrawals: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /** @private */
  _refreshStatus (record) {
    const states = Object.values(record.members).map((m) => m.status);
    if (states.includes('declined')) record.status = 'declined';
    else if (states.every((s) => s === 'accepted')) record.status = 'active';
    else record.status = 'pending';
  }

  /** @private */
  _send (body, throttleKey, force = false) {
    if (!this._publish) return false;
    const now = Date.now();
    const last = this._lastSent.get(throttleKey) || 0;
    if (!force && now - last < this.settings.resendMinMs) return false;
    this._lastSent.set(throttleKey, now);
    try {
      const sent = this._publish({ ...body, sentAt: now });
      if (sent && typeof sent.toBuffer === 'function') {
        try {
          this.recordFrame(sent);
        } catch (err) {
          this.emit('warning', `[FEDERATIONS] own frame not kept: ${err.message}`);
        }
      }
      return !!sent;
    } catch (err) {
      this.emit('warning', `[FEDERATIONS] publish failed: ${err.message}`);
      return false;
    }
  }

  /** @private */
  _sendInvite (record, force = false) {
    if (record.descriptor.publisher.slice(2) !== this._self) return false;
    return this._send(Federation.inviteMessage({
      descriptor: record.descriptor,
      name: record.name,
      members: Object.values(record.members)
    }), `invite:${record.id}`, force);
  }

  /** @private */
  _sendResponse (record, force = false) {
    const me = record.members[this._self];
    if (!me || (me.status !== 'accepted' && me.status !== 'declined')) return false;
    return this._send(Federation.responseMessage(record.id, me.status === 'accepted'), `response:${record.id}`, force);
  }

  /**
   * Answer an invite (operator decision).
   * @param {string} federationId
   * @param {boolean} [accept=true]
   * @returns {Promise<Object>}
   */
  async respond (federationId, accept = true) {
    const record = this._record(federationId);
    this._checkNetwork(record.descriptor.network);
    const me = record.members[this._self];
    if (!me) throw new Error('this Hub is not a member of that federation');
    me.status = accept ? 'accepted' : 'declined';
    me.at = Date.now();
    this._refreshStatus(record);
    await this._save(record);
    this._sendResponse(record, true);
    return this._view(record);
  }

  /**
   * Import a descriptor-shaped policy as a local record (no invites are sent).
   * @param {Object} policy `{ validators, threshold, name? }`
   * @returns {Promise<Object|null>}
   */
  async importPolicy (policy = {}) {
    const self = this.pubkey;
    const validators = (Array.isArray(policy.validators) ? policy.validators : [])
      .map(compressedPubkey).filter(Boolean);
    if (!self || validators.length < 1) return null;
    const publisher = validators.find((v) => v.slice(2) === self.slice(2)) || [...validators].sort()[0];
    let descriptor;
    try {
      descriptor = Federation.buildDescriptor({
        validators,
        threshold: policy.threshold,
        network: this.settings.network,
        publisher
      });
    } catch (_) {
      return null;
    }
    const id = Federation.descriptorId(descriptor);
    if (this._records.has(id)) return this._view(this._records.get(id));
    const record = this._newRecord(id, descriptor, cleanText(policy.name, 80) || 'Imported federation policy');
    record.source = 'policy';
    if (record.members[self.slice(2)]) record.members[self.slice(2)].status = 'accepted';
    this._refreshStatus(record);
    await this._save(record);
    return this._view(record);
  }

  /**
   * Re-send the invite (publisher) or this Hub's answer (member).
   * @param {string} federationId
   * @returns {Object}
   */
  resend (federationId) {
    const record = this._record(federationId);
    return { invite: this._sendInvite(record, true), response: this._sendResponse(record, true) };
  }

  // ---------------------------------------------------------------------------
  // Deposit

  /**
   * Send from the Hub wallet to the vault.
   * @param {string} federationId
   * @param {Object} opts `{ amountSats, feeRateSatVb? }`
   * @returns {Promise<Object>}
   */
  async deposit (federationId, opts = {}) {
    const record = this._record(federationId);
    this._checkNetwork(record.descriptor.network);
    if (record.status !== 'active') throw new Error('every member must accept before the vault takes deposits');
    if (!this._walletSend) throw new Error('Hub wallet is not available');
    const amountSats = sats(opts.amountSats, 'amountSats');
    this._checkCap(amountSats, this.settings.maxDepositSats, 'deposit');
    const feeRateSatVb = opts.feeRateSatVb != null ? Number(opts.feeRateSatVb) : this.settings.defaultFeeRateSatVb;
    if (!(feeRateSatVb > 0) || feeRateSatVb > this.settings.maxFeeRateSatVb) {
      throw new Error(`feeRateSatVb must be above 0 and at most ${this.settings.maxFeeRateSatVb}`);
    }
    const txid = await this._walletSend({
      address: record.vaultAddress,
      amountSats,
      feeRateSatVb,
      label: 'federation_deposit',
      meta: { federationId: record.id }
    });
    if (!txid || typeof txid !== 'string') throw new Error('wallet send returned no txid');
    record.deposits = record.deposits || [];
    record.deposits.push({ txid, amountSats, feeRateSatVb, at: Date.now() });
    await this._save(record);
    return { txid, amountSats, feeRateSatVb, vaultAddress: record.vaultAddress };
  }

  // ---------------------------------------------------------------------------
  // Withdraw

  /**
   * Start a withdrawal: build the PSBT from one vault UTXO, sign it, ask the members.
   * @param {string} federationId
   * @param {Object} opts `{ destinationAddress, amountSats, feeSats?, feeRateSatVb?, utxo?: 'txid:vout' }`
   * @returns {Promise<Object>}
   */
  async createWithdrawal (federationId, opts = {}) {
    const record = this._record(federationId);
    this._checkNetwork(record.descriptor.network);
    if (!record.members[this._self]) throw new Error('this Hub is not a member of that federation');
    const amountSats = sats(opts.amountSats, 'amountSats');
    this._checkCap(amountSats, this.settings.maxWithdrawalSats, 'withdrawal');
    let feeSats;
    if (opts.feeSats != null) {
      feeSats = sats(opts.feeSats, 'feeSats');
    } else {
      const rate = opts.feeRateSatVb != null ? Number(opts.feeRateSatVb) : this.settings.defaultFeeRateSatVb;
      if (!(rate > 0) || rate > this.settings.maxFeeRateSatVb) throw new Error(`feeRateSatVb must be above 0 and at most ${this.settings.maxFeeRateSatVb}`);
      const vbytes = WITHDRAWAL_VBYTES_BASE + WITHDRAWAL_VBYTES_PER_KEY * record.descriptor.validators.length;
      feeSats = Math.ceil(rate * vbytes);
    }
    if (feeSats > this.settings.maxFeeSats) throw new Error(`fee of ${feeSats} sats is over the ${this.settings.maxFeeSats} sat cap`);

    const utxos = await this.vaultUtxos(record.vaultAddress);
    const busy = new Set(Object.values(record.withdrawals || {})
      .filter((w) => w.status === 'pending')
      .map((w) => `${w.txid}:${w.vout}`));
    let utxo;
    if (opts.utxo) {
      utxo = utxos.find((u) => `${u.txid}:${u.vout}` === String(opts.utxo));
      if (!utxo) throw new Error(`vault has no confirmed UTXO ${opts.utxo}`);
    } else {
      utxo = utxos.find((u) => !busy.has(`${u.txid}:${u.vout}`) && u.sats >= amountSats + feeSats);
      if (!utxo) {
        const total = utxos.reduce((s, u) => s + u.sats, 0);
        throw new Error(`no single confirmed vault UTXO covers ${amountSats + feeSats} sats (vault holds ${total} in ${utxos.length})`);
      }
    }
    const fundedTxHex = await this._rawTransaction(utxo.txid, utxo.height);
    const prepared = Federation.prepareWithdrawal({
      descriptor: record.descriptor,
      fundedTxHex,
      vout: utxo.vout,
      destinationAddress: opts.destinationAddress,
      amountSats,
      feeSats
    });
    const existing = record.withdrawals[prepared.requestId];
    if (!existing) {
      record.withdrawals[prepared.requestId] = this._newWithdrawal(prepared, {
        requester: this._self,
        fundedTxHex,
        destinationAddress: String(opts.destinationAddress).trim()
      });
    }
    const w = record.withdrawals[prepared.requestId];
    if (!w.signatures[this._self]) this._signLocal(record, w);
    await this._save(record);
    this._sendWithdrawal(record, w, true);
    this._sendSignature(record, w, true);
    await this._maybeBroadcast(record, w);
    return this._view(record).withdrawals.find((x) => x.requestId === w.requestId);
  }

  /** @private */
  _newWithdrawal (prepared, extra) {
    return {
      requestId: prepared.requestId,
      requester: extra.requester,
      destinationAddress: extra.destinationAddress,
      amountSats: prepared.amountSats,
      feeSats: prepared.feeSats,
      changeSats: prepared.changeSats,
      txid: prepared.txid,
      vout: prepared.vout,
      inputSats: prepared.inputSats,
      fundedTxHex: extra.fundedTxHex,
      psbtBase64: prepared.psbtBase64,
      signatures: {},
      status: 'pending',
      createdAt: Date.now()
    };
  }

  /** @private */
  _signLocal (record, w) {
    const signed = Federation.signWithdrawal({ psbtBase64: w.psbtBase64, privateKey: this._privateKey() });
    this._addSignatures(record, w, signed.signatures);
  }

  /** @private */
  _addSignatures (record, w, signatures) {
    const out = Federation.addWithdrawalSignatures({ descriptor: record.descriptor, psbtBase64: w.psbtBase64, signatures });
    w.psbtBase64 = out.psbtBase64;
    for (const s of signatures) {
      const x = pubkeyXOnly(s.pubkey);
      if (x) w.signatures[x] = s;
    }
  }

  /**
   * Operator approval: sign a pending withdrawal and send the signature.
   * @param {string} federationId
   * @param {string} requestId
   * @returns {Promise<Object>}
   */
  async approveWithdrawal (federationId, requestId) {
    const record = this._record(federationId);
    this._checkNetwork(record.descriptor.network);
    const w = record.withdrawals[String(requestId || '').toLowerCase()];
    if (!w) throw new Error('unknown withdrawal request');
    if (!record.members[this._self]) throw new Error('this Hub is not a member of that federation');
    if (w.status !== 'pending') throw new Error(`withdrawal is ${w.status}`);
    this._checkCap(w.amountSats, this.settings.maxWithdrawalSats, 'withdrawal');
    if (!w.signatures[this._self]) this._signLocal(record, w);
    await this._save(record);
    this._sendSignature(record, w, true);
    await this._maybeBroadcast(record, w);
    return this._view(record).withdrawals.find((x) => x.requestId === w.requestId);
  }

  /**
   * Finalize and broadcast once the threshold is met (any member may).
   * @param {string} federationId
   * @param {string} requestId
   * @returns {Promise<Object>}
   */
  async broadcastWithdrawal (federationId, requestId) {
    const record = this._record(federationId);
    const w = record.withdrawals[String(requestId || '').toLowerCase()];
    if (!w) throw new Error('unknown withdrawal request');
    if (w.status === 'pending') w.error = null;
    const done = await this._maybeBroadcast(record, w, true);
    if (!done && w.status !== 'broadcast') {
      throw new Error(w.error || `${Object.keys(w.signatures).length} of ${record.descriptor.threshold} signatures`);
    }
    return this._view(record).withdrawals.find((x) => x.requestId === w.requestId);
  }

  /** @private */
  async _maybeBroadcast (record, w, force = false) {
    if (w.status !== 'pending' && !(force && w.status === 'failed')) return false;
    if (Object.keys(w.signatures).length < record.descriptor.threshold) return false;
    let final;
    try {
      final = Federation.finalizeWithdrawal({ descriptor: record.descriptor, psbtBase64: w.psbtBase64 });
    } catch (err) {
      w.error = err.message;
      await this._save(record);
      return false;
    }
    try {
      await this._call('sendrawtransaction', [final.txHex]);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (!/already in (block chain|utxo set|mempool)|txn-already-known|txn-already-in-mempool|txn-same-nonwitness-data-in-mempool/i.test(msg)) {
        w.status = 'failed';
        w.error = msg;
        await this._save(record);
        this.emit('warning', `[FEDERATIONS] withdrawal ${w.requestId.slice(0, 12)} broadcast failed: ${msg}`);
        return false;
      }
    }
    w.status = 'broadcast';
    w.broadcastTxid = final.txid;
    w.error = null;
    await this._save(record);
    this._send(Federation.broadcastMessage(record.id, w.requestId, final.txid), `broadcast:${w.requestId}`, true);
    this.emit('withdrawal:broadcast', { federationId: record.id, requestId: w.requestId, txid: final.txid });
    return true;
  }

  /** @private */
  _sendWithdrawal (record, w, force = false) {
    if (w.requester !== this._self || w.status !== 'pending') return false;
    return this._send(Federation.withdrawalMessage(record.id, w), `withdrawal:${w.requestId}`, force);
  }

  /** @private */
  _sendSignature (record, w, force = false) {
    const mine = w.signatures[this._self];
    if (!mine) return false;
    return this._send(Federation.signatureMessage(record.id, w.requestId, [mine]), `signature:${w.requestId}`, force);
  }

  // ---------------------------------------------------------------------------
  // Inbound

  /**
   * @param {Object} body CONTRACT_MESSAGE body
   * @returns {boolean}
   */
  ownsContractMessage (body) {
    return Federation.isMessage(body);
  }

  /**
   * @param {Object} body CONTRACT_MESSAGE body
   * @param {string} signer verified x-only (or compressed) author pubkey
   * @returns {Promise<void>}
   */
  handleContractMessage (body, signer) {
    return this._enqueue(() => this._handle(body, pubkeyXOnly(signer)))
      .catch((err) => this.emit('debug', `[FEDERATIONS] ignored ${body && body.type}: ${err.message}`));
  }

  /** @private */
  async _handle (body, signer) {
    if (!signer || !this._self || signer === this._self) return;
    if (body.contract !== body.federationId) throw new Error('contract must be the federation id');
    if (body.type === TYPES.invite) return this._onInvite(body, signer);
    const record = this._records.get(String(body.federationId || '').toLowerCase());
    if (!record) return;
    Federation.verifySender(record.descriptor, body, signer);
    switch (body.type) {
      case TYPES.response: return this._onResponse(record, body, signer);
      case TYPES.sync: return this._onSync(record);
      case TYPES.withdrawal: return this._onWithdrawal(record, body, signer);
      case TYPES.signature: return this._onSignature(record, body, signer);
      case TYPES.broadcast: return this._onBroadcast(record, body);
      default:
    }
  }

  /** @private */
  async _onInvite (body, signer) {
    const descriptor = Federation.verifyInvite(body, signer);
    if (!Federation.isValidator(descriptor, this._self)) return;
    this._checkNetwork(descriptor.network);
    let record = this._records.get(body.federationId);
    if (record) {
      // Already known: answer again in case the publisher missed it.
      this._sendResponse(record);
      return;
    }
    record = this._newRecord(body.federationId, descriptor, cleanText(body.name, 80));
    record.members[signer].status = 'accepted';
    for (const m of Array.isArray(body.members) ? body.members : []) {
      const x = pubkeyXOnly(m && m.pubkey);
      if (!x || !record.members[x]) continue;
      record.members[x].url = cleanUrl(m.url);
      record.members[x].alias = cleanText(m.alias, 80);
    }
    this._refreshStatus(record);
    await this._save(record);
    this.emit('invite', this._view(record));
    // Ask the others for their answers.
    this._send(Federation.syncMessage(record.id), `sync:${record.id}`, true);
  }

  /** @private */
  async _onResponse (record, body, signer) {
    const m = record.members[signer];
    const status = body.accept === true ? 'accepted' : 'declined';
    if (m.status === status) return;
    m.status = status;
    m.at = Date.now();
    this._refreshStatus(record);
    await this._save(record);
    this.emit('member', { federationId: record.id, pubkey: m.pubkey, status });
  }

  /** @private */
  async _onSync (record) {
    this._sendInvite(record);
    this._sendResponse(record);
    for (const w of Object.values(record.withdrawals || {})) {
      if (w.status !== 'pending') continue;
      this._sendWithdrawal(record, w);
      this._sendSignature(record, w);
    }
  }

  /** @private */
  async _onWithdrawal (record, body, signer) {
    this._checkNetwork(record.descriptor.network);
    if (!record.members[this._self]) return;
    const prepared = Federation.verifyWithdrawalRequest(record.descriptor, body);
    if (prepared.feeSats > this.settings.maxFeeSats) throw new Error('withdrawal fee is over this Hub\'s cap');
    const existing = record.withdrawals[prepared.requestId];
    if (existing) {
      this._sendSignature(record, existing);
      return;
    }
    record.withdrawals[prepared.requestId] = this._newWithdrawal(prepared, {
      requester: signer,
      fundedTxHex: String(body.fundedTxHex).toLowerCase(),
      destinationAddress: String(body.destinationAddress).trim()
    });
    await this._save(record);
    this.emit('withdrawal', { federationId: record.id, requestId: prepared.requestId });
  }

  /** @private */
  async _onSignature (record, body, signer) {
    const w = record.withdrawals[String(body.requestId || '').toLowerCase()];
    if (!w) {
      // Signature before the request: ask for it again.
      this._send(Federation.syncMessage(record.id), `sync:${record.id}`);
      return;
    }
    if (w.signatures[signer]) return;
    const sigs = (Array.isArray(body.signatures) ? body.signatures : []).filter((s) => pubkeyXOnly(s && s.pubkey) === signer);
    if (!sigs.length) throw new Error('signature does not belong to its sender');
    this._addSignatures(record, w, sigs);
    await this._save(record);
    await this._maybeBroadcast(record, w);
  }

  /** @private */
  async _onBroadcast (record, body) {
    const w = record.withdrawals[String(body.requestId || '').toLowerCase()];
    if (!w || w.status === 'broadcast') return;
    const txid = String(body.txid || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) return;
    // Only believe it when our node sees the transaction.
    try {
      await this._call('getrawtransaction', [txid, false]);
    } catch (_) {
      try {
        await this._call('getmempoolentry', [txid]);
      } catch (_) {
        return;
      }
    }
    w.status = 'broadcast';
    w.broadcastTxid = txid;
    await this._save(record);
  }

  // ---------------------------------------------------------------------------
  // Mailbox (members without a Fabric peer)

  /** @private */
  _descriptorFor (federationId) {
    const id = String(federationId || '').toLowerCase();
    const record = this._records.get(id);
    return record ? record.descriptor : (this._descriptors.get(id) || null);
  }

  /**
   * Check a signed federation `CONTRACT_MESSAGE` and keep it for the members.
   * Invites must be signed by their publisher; anything else must come from a
   * member of a federation whose invite this Hub has seen.
   * @param {string|Object} frame `fabric:` URI or a signed `Message`
   * @returns {{ duplicate: boolean, federationId: string, type: string, signer: string, body: Object, message: Object }}
   */
  recordFrame (frame) {
    const uri = typeof frame === 'string' ? frame : encodeFabricUri(frame);
    const decoded = decodeFabricUri(uri, { allowedTypes: ['CONTRACT_MESSAGE'] });
    if (!decoded.ok) throw new Error(decoded.error);
    const body = parseJson(decoded.message.data);
    if (!Federation.isMessage(body)) throw new Error('not a federation message');
    const signer = pubkeyXOnly(decoded.author);
    let descriptor;
    if (body.type === TYPES.invite) {
      descriptor = Federation.verifyInvite(body, signer);
    } else {
      descriptor = this._descriptorFor(body.federationId);
      if (!descriptor) throw new Error('unknown federation (its invite has not reached this Hub)');
      Federation.verifySender(descriptor, body, signer);
    }
    const federationId = Federation.descriptorId(descriptor);
    const id = decoded.message.id;
    const out = { duplicate: false, federationId, type: body.type, signer, body, message: decoded.message };
    if (this._mailboxIds.has(id)) return Object.assign(out, { duplicate: true });
    if (body.type === TYPES.invite) this._descriptors.set(federationId, descriptor);
    this._mailbox.push({
      seq: ++this._mailboxSeq,
      id,
      fabric: encodeFabricUri(decoded.buffer),
      federationId,
      type: body.type,
      signer,
      at: Date.now()
    });
    this._mailboxIds.add(id);
    this._trimMailbox();
    this._scheduleMailboxWrite();
    return out;
  }

  /** @private */
  _trimMailbox () {
    const max = Math.max(1, Number(this.settings.mailboxSize) || 1);
    if (this._mailbox.length <= max) return;
    for (const f of this._mailbox.splice(0, this._mailbox.length - max)) this._mailboxIds.delete(f.id);
    const used = new Set(this._mailbox.map((f) => f.federationId));
    for (const id of [...this._descriptors.keys()]) {
      if (!used.has(id)) this._descriptors.delete(id);
    }
  }

  /** @private */
  _scheduleMailboxWrite () {
    if (this._mailboxTimer || !this.fs || typeof this.fs.publish !== 'function') return;
    this._mailboxTimer = setTimeout(() => {
      this._mailboxTimer = null;
      this._writeMailbox().catch((err) => this.emit('warning', `[FEDERATIONS] mailbox not saved: ${err.message}`));
    }, 1000);
    if (this._mailboxTimer.unref) this._mailboxTimer.unref();
  }

  /** @private */
  async _writeMailbox () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    await this.fs.publish(`${this.settings.path}/mailbox.json`, {
      seq: this._mailboxSeq,
      descriptors: Object.fromEntries(this._descriptors),
      frames: this._mailbox
    });
  }

  /**
   * Frames for every federation that names `pubkey`, oldest first.
   * @param {string} pubkey member pubkey (compressed or x-only)
   * @param {Object} [opts]
   * @param {number} [opts.since=0] Last `seq` already read
   * @param {number} [opts.limit]
   * @returns {{ messages: Object[], next: number, more: boolean }}
   */
  framesFor (pubkey, opts = {}) {
    const x = pubkeyXOnly(pubkey);
    if (!x) throw new Error('pubkey required');
    const since = Math.max(0, Number(opts.since) || 0);
    const page = this.settings.mailboxPageSize;
    const limit = Math.min(page, Math.max(1, Number(opts.limit) || page));
    const messages = [];
    for (const f of this._mailbox) {
      if (f.seq <= since) continue;
      const descriptor = this._descriptorFor(f.federationId);
      if (!descriptor || !Federation.isValidator(descriptor, x)) continue;
      messages.push({ seq: f.seq, fabric: f.fabric, federationId: f.federationId, type: f.type, signer: f.signer, at: f.at });
      if (messages.length >= limit) break;
    }
    const more = messages.length >= limit;
    return { messages, next: more ? messages[messages.length - 1].seq : Math.max(since, this._mailboxSeq), more };
  }

  /**
   * A member without a Fabric peer hands over a signed frame: keep it, act on it
   * when this Hub is a member too, and relay the original frame to the mesh.
   * @param {string} uri `fabric:` URI of a signed `CONTRACT_MESSAGE`
   * @returns {Promise<{ duplicate: boolean, federationId: string, type: string }>}
   */
  async submitFrame (uri) {
    const out = this.recordFrame(uri);
    if (!out.duplicate) {
      if (this._relay) {
        try {
          this._relay(out.message);
        } catch (err) {
          this.emit('warning', `[FEDERATIONS] relay failed: ${err.message}`);
        }
      }
      await this.handleContractMessage(out.body, out.signer);
    }
    return { duplicate: out.duplicate, federationId: out.federationId, type: out.type };
  }

  /** @private */
  _knownDescriptor (federationId) {
    const descriptor = this._descriptorFor(federationId);
    if (!descriptor) throw new Error('unknown federation');
    if (descriptor.network !== this.settings.network) throw new Error(`federation is on ${descriptor.network}; this Hub runs ${this.settings.network}`);
    return descriptor;
  }

  /**
   * Public vault read for a known federation: confirmed UTXOs and the raw
   * transactions that funded them (what a member needs to build a withdrawal).
   * @param {string} federationId
   * @returns {Promise<{ federationId: string, address: string, balanceSats: number, utxos: Array<{ txid: string, vout: number, amountSats: number, height: (number|null), txHex: string }> }>}
   */
  async vault (federationId) {
    const descriptor = this._knownDescriptor(federationId);
    const id = Federation.descriptorId(descriptor);
    const cached = this._vaultCache.get(id);
    if (cached && Date.now() - cached.at < this.settings.vaultCacheMs) return cached.value;
    const address = Federation.vaultForDescriptor(descriptor).address;
    const utxos = await this.vaultUtxos(address);
    const funded = await Promise.all(utxos.slice(0, 50).map(async (u) => ({
      txid: u.txid,
      vout: u.vout,
      amountSats: u.sats,
      height: u.height != null ? u.height : null,
      txHex: await this._rawTransaction(u.txid, u.height)
    })));
    const value = {
      federationId: id,
      address,
      balanceSats: utxos.reduce((sum, u) => sum + u.sats, 0),
      utxos: funded
    };
    this._vaultCache.set(id, { at: Date.now(), value });
    if (this._vaultCache.size > 500) this._vaultCache.delete(this._vaultCache.keys().next().value);
    return value;
  }

  /**
   * Broadcast a finished withdrawal for a known federation. Only transactions
   * that spend one of its vault UTXOs are sent.
   * @param {string} federationId
   * @param {string} txHex
   * @returns {Promise<{ txid: string }>}
   */
  async broadcastTransaction (federationId, txHex) {
    const descriptor = this._knownDescriptor(federationId);
    const hex = String(txHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(hex) || hex.length > 200000) throw new Error('txHex must be a raw transaction');
    const tx = Transaction.fromHex(hex);
    const address = Federation.vaultForDescriptor(descriptor).address;
    const utxos = new Set((await this.vaultUtxos(address)).map((u) => `${u.txid}:${u.vout}`));
    const spendsVault = tx.ins.some((i) => utxos.has(`${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`));
    if (!spendsVault) throw new Error('transaction does not spend this federation\'s vault');
    try {
      await this._call('sendrawtransaction', [hex]);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (!/already in (block chain|utxo set|mempool)|txn-already-known|txn-already-in-mempool|txn-same-nonwitness-data-in-mempool/i.test(msg)) throw err;
    }
    this._vaultCache.delete(Federation.descriptorId(descriptor));
    return { txid: tx.getId() };
  }

  // ---------------------------------------------------------------------------
  // Timer

  /** Re-send what is still pending, for members that were offline. */
  async tick () {
    for (const record of this._records.values()) {
      if (!record.members[this._self]) continue;
      if (record.status === 'pending') {
        if (!this._sendInvite(record)) {
          this._send(Federation.syncMessage(record.id), `sync:${record.id}`);
        }
      }
      for (const w of Object.values(record.withdrawals || {})) {
        if (w.status !== 'pending') continue;
        if (Object.keys(w.signatures).length >= record.descriptor.threshold) await this._maybeBroadcast(record, w);
        else this._sendWithdrawal(record, w);
      }
    }
  }
}

FederationsService.TYPES = TYPES;

module.exports = FederationsService;
