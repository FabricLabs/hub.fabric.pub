'use strict';

const merge = require('lodash.merge');
const Actor = require('@fabric/core/types/actor');
const Message = require('@fabric/core/types/message');

const BEACON_CHAIN_PATH = 'beacon/CHAIN';

class Beacon extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: 'HUB:BEACON',
      debug: false,
      interval: 60000
    }, settings);

    this.bitcoin = null;
    this.fs = null;
    this.key = null;
    this.timer = null;
    /** @type {Array<{ type: string, payload: object, id?: string }>} Chain of Fabric messages representing epochs. */
    this._epochChain = [];
    this._state = {
      content: {
        clock: 0,
        status: 'STOPPED',
        lastBlockHash: null,
        height: 0,
        balance: 0,
        balanceSats: 0
      }
    };

    return this;
  }

  get state () {
    return this._state.content;
  }

  /**
   * Attach Filesystem and optional key for persistent epoch chain and signing.
   * @param {{ fs?: object, key?: object }} deps
   */
  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    return this;
  }

  /**
   * Load the epoch chain from the Fabric store (Filesystem). Restores clock from last message.
   */
  async _loadEpochChainFromFilesystem () {
    if (!this.fs || typeof this.fs.readFile !== 'function') return;
    try {
      const raw = this.fs.readFile(BEACON_CHAIN_PATH);
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || !Array.isArray(parsed.messages)) return;
      this._epochChain = parsed.messages;
      const last = this._epochChain[this._epochChain.length - 1];
      if (last && last.payload && Number.isFinite(last.payload.clock)) {
        this._state.content.clock = last.payload.clock;
        this._state.content.lastBlockHash = last.payload.blockHash || null;
        this._state.content.height = last.payload.height != null ? last.payload.height : 0;
        this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
        this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
      }
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to load epoch chain from filesystem:', err && err.message ? err.message : err);
    }
  }

  /**
   * Persist the epoch chain (Fabric messages) to the Filesystem store.
   */
  async _persistEpochChain () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    try {
      await this.fs.publish(BEACON_CHAIN_PATH, { messages: this._epochChain });
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to persist epoch chain:', err && err.message ? err.message : err);
    }
  }

  async createEpoch () {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const address = await this.bitcoin.getUnusedAddress();
    const generated = await this.bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
    const blockHash = Array.isArray(generated) ? generated[0] : generated;
    const height = await this.bitcoin._makeRPCRequest('getblockcount', []);
    const balances = await this.bitcoin._makeRPCRequest('getbalances', []).catch(() => null);
    const trusted = (balances && balances.mine && balances.mine.trusted != null) ? Number(balances.mine.trusted) : 0;
    const balanceSats = Math.round(trusted * 1e8);

    this._state.content.clock += 1;
    this._state.content.lastBlockHash = blockHash || null;
    this._state.content.height = Number(height || 0);
    this._state.content.balance = trusted;
    this._state.content.balanceSats = balanceSats;

    const epoch = {
      clock: this._state.content.clock,
      blockHash: this._state.content.lastBlockHash,
      height: this._state.content.height,
      balance: trusted,
      balanceSats,
      timestamp: new Date().toISOString()
    };

    // Append epoch as a Fabric message to the chain and persist via Filesystem.
    try {
      const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(epoch)]);
      if (this.key && this.key.private) message.signWithKey(this.key);
      const entry = { type: 'BEACON_EPOCH', payload: epoch, id: message.id || null };
      this._epochChain.push(entry);
      await this._persistEpochChain();
    } catch (err) {
      this.emit('error', err);
    }

    this.emit('epoch', epoch);
    return epoch;
  }

  async start () {
    if (this._state.content.status === 'RUNNING') return this;
    this._state.content.status = 'RUNNING';

    await this._loadEpochChainFromFilesystem();

    // Prime one block immediately when starting.
    try {
      await this.createEpoch();
    } catch (err) {
      this.emit('error', err);
    }

    this.timer = setInterval(() => {
      this.createEpoch().catch((err) => this.emit('error', err));
    }, this.settings.interval);

    return this;
  }

  async stop () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this._persistEpochChain();
    this._state.content.status = 'STOPPED';
    return this;
  }
}

module.exports = Beacon;
