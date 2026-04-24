'use strict';

const merge = require('lodash.merge');
const Actor = require('@fabric/core/types/actor');
const Message = require('@fabric/core/types/message');
const Tree = require('@fabric/core/types/tree');
const DistributedExecution = require('../functions/fabricDistributedExecution');

const BEACON_CHAIN_PATH = 'beacon/CHAIN';

class Beacon extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: 'HUB:BEACON',
      debug: false,
      interval: 60000,
      regtest: true,
      /** Comma-separated hex pubkeys (optional) — see {@link DistributedExecution.verifyFederationWitnessOnMessage} */
      federationValidators: [],
      federationThreshold: 1
    }, settings);

    this.bitcoin = null;
    this.fs = null;
    this.key = null;
    this.timer = null;
    this._blockHandler = null;
    /** @type {Array<{ type: string, payload: object, id?: string }>} Chain of Fabric messages representing epochs. */
    this._epochChain = [];
    this._federationValidators = Array.isArray(this.settings.federationValidators)
      ? this.settings.federationValidators.slice()
      : [];
    this._federationThreshold = Math.max(1, Number(this.settings.federationThreshold) || 1);
    /** @type {null | (() => { clock: number, stateDigest: string } | null)} */
    this._getSidechainSnapshotForEpoch = null;
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

  get merkleRoot () {
    return this._computeMerkleRoot();
  }

  /**
   * Summary for HTTP `/services/distributed/epoch` (no private keys).
   */
  getEpochChainSummary () {
    const last = this._epochChain[this._epochChain.length - 1];
    return {
      length: this._epochChain.length,
      last: last
        ? {
          payload: last.payload,
          federationWitness: last.federationWitness || null
        }
        : null
    };
  }

  /**
   * Attach Filesystem and optional key for persistent epoch chain and signing.
   * @param {{
   *   fs?: object,
   *   key?: object,
   *   federationValidators?: string[],
   *   federationThreshold?: number,
   *   getSidechainSnapshotForEpoch?: () => ({ clock: number, stateDigest: string } | null)
   * }} deps
   */
  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    if (Array.isArray(deps.federationValidators)) {
      this._federationValidators = deps.federationValidators.slice();
    }
    if (deps.federationThreshold != null) {
      this._federationThreshold = Math.max(1, Number(deps.federationThreshold) || 1);
    }
    if (typeof deps.getSidechainSnapshotForEpoch === 'function') {
      this._getSidechainSnapshotForEpoch = deps.getSidechainSnapshotForEpoch;
    }
    return this;
  }

  /**
   * Federation policy for HTTP manifest / operators (compressed pubkey hex list + threshold).
   */
  getFederationPolicy () {
    return {
      validators: this._federationValidators.slice(),
      threshold: this._federationThreshold
    };
  }

  _hubCompressedPubkeyHex () {
    if (!this.key || !this.key.public || typeof this.key.public.encodeCompressed !== 'function') return null;
    try {
      return this.key.public.encodeCompressed('hex');
    } catch (_) {
      return null;
    }
  }

  _mergeSidechainIntoEpoch (epoch) {
    const out = { ...epoch };
    if (typeof this._getSidechainSnapshotForEpoch !== 'function') return out;
    try {
      const snap = this._getSidechainSnapshotForEpoch();
      if (snap && typeof snap === 'object') {
        out.sidechain = {
          clock: Number(snap.clock) || 0,
          stateDigest: snap.stateDigest != null ? String(snap.stateDigest) : null
        };
      }
    } catch (err) {
      this.emit('warning', '[BEACON] sidechain snapshot failed:', err && err.message ? err.message : err);
    }
    return out;
  }

  _makeFederationWitnessForEpoch (epochPayload) {
    if (!this._federationValidators.length) return null;
    if (!this.key || !this.key.private) return null;
    const pk = this._hubCompressedPubkeyHex();
    if (!pk || !this._federationValidators.includes(pk)) return null;
    const msg = Buffer.from(DistributedExecution.signingStringForBeaconEpoch(epochPayload), 'utf8');
    let sig;
    try {
      sig = this.key.signSchnorr(msg);
    } catch (_) {
      return null;
    }
    return {
      version: 1,
      signatures: { [pk]: Buffer.isBuffer(sig) ? sig.toString('hex') : String(sig) }
    };
  }

  /**
   * Build a chain entry: Fabric message + optional federation witness over the full epoch payload (incl. sidechain head).
   */
  _buildEpochEntry (epochBase) {
    const fullEpoch = this._mergeSidechainIntoEpoch(epochBase);
    const message = Message.fromVector(['BEACON_EPOCH', JSON.stringify(fullEpoch)]);
    if (this.key && this.key.private) message.signWithKey(this.key);
    const entry = { type: 'BEACON_EPOCH', payload: fullEpoch, id: message.id || null };
    const witness = this._makeFederationWitnessForEpoch(fullEpoch);
    if (witness) entry.federationWitness = witness;
    return entry;
  }

  _verifyEpochWitnessesIfConfigured () {
    if (!this._federationValidators.length) return;
    for (const e of this._epochChain) {
      if (e.type !== 'BEACON_EPOCH' || !e.payload) continue;
      const buf = Buffer.from(DistributedExecution.signingStringForBeaconEpoch(e.payload), 'utf8');
      const ok = DistributedExecution.verifyFederationWitnessOnMessage(
        buf,
        e.federationWitness,
        this._federationValidators,
        this._federationThreshold
      );
      if (!ok) {
        this.emit('warning', `[BEACON] Federation witness missing or invalid for epoch clock ${e.payload.clock}`);
      }
    }
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
      this._verifyEpochWitnessesIfConfigured();
    } catch (err) {
      this.emit('warning', '[BEACON] Failed to load epoch chain from filesystem:', err && err.message ? err.message : err);
    }
  }

  /**
   * Compute merkle root over the epoch chain. Updated when chain changes (append or reorg).
   */
  _computeMerkleRoot () {
    if (!this._epochChain.length) return null;
    const leaves = this._epochChain.map((e) => JSON.stringify({
      type: e.type,
      payload: e.payload,
      id: e.id,
      federationWitness: e.federationWitness || null
    }));
    const tree = new Tree({ leaves });
    const root = tree && tree.root;
    return root ? (Buffer.isBuffer(root) ? root.toString('hex') : String(root)) : null;
  }

  /**
   * Persist the epoch chain (Fabric messages) to the Filesystem store.
   * Includes merkle root so consumers can verify chain integrity after reorgs.
   */
  async _persistEpochChain () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    try {
      const merkle = { root: this._computeMerkleRoot(), leaves: this._epochChain.length };
      await this.fs.publish(BEACON_CHAIN_PATH, { messages: this._epochChain, merkle });
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

    let committedPayload = epoch;
    try {
      const entry = this._buildEpochEntry(epoch);
      this._epochChain.push(entry);
      await this._persistEpochChain();
      committedPayload = entry.payload;
    } catch (err) {
      this.emit('error', err);
    }

    this.emit('epoch', committedPayload);
    return committedPayload;
  }

  /**
   * Prune epochs from the chain (reorg). Updates state from last remaining epoch.
   * Emits 'reorg' so consumers can refresh merkle state and rewind sidechain snapshots.
   * @param {number} inclusiveMaxHeight Keep epochs whose L1 `height` is **<=** this (the new chain tip height).
   */
  _pruneEpochChain (inclusiveMaxHeight) {
    const maxH = Number(inclusiveMaxHeight);
    if (!Number.isFinite(maxH)) return;

    const removedBeaconClocks = [];
    const next = [];
    for (const e of this._epochChain) {
      const h = e.payload && e.payload.height != null ? Number(e.payload.height) : 0;
      if (h <= maxH) next.push(e);
      else if (e.payload && e.payload.clock != null) removedBeaconClocks.push(Number(e.payload.clock));
    }
    const before = this._epochChain.length;
    this._epochChain = next;
    const pruned = before - this._epochChain.length;
    if (pruned === 0) return;

    const last = this._epochChain[this._epochChain.length - 1];
    if (last && last.payload) {
      this._state.content.clock = last.payload.clock != null ? last.payload.clock : 0;
      this._state.content.lastBlockHash = last.payload.blockHash || null;
      this._state.content.height = last.payload.height != null ? last.payload.height : 0;
      this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
      this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
    } else {
      this._state.content.clock = 0;
      this._state.content.lastBlockHash = null;
      this._state.content.height = 0;
      this._state.content.balance = 0;
      this._state.content.balanceSats = 0;
    }
    this.emit('reorg', { pruned, inclusiveMaxHeight, removedBeaconClocks });
  }

  /**
   * Record an epoch from a chain-tip event (does not generate blocks).
   * Mainnet/testnet/signet: Beacon listens to bitcoin `'block'` and calls this.
   * Regtest: the Hub also calls this from ZMQ hashblock so externally mined blocks update the epoch chain;
   * blocks from the regtest interval timer (`createEpoch`) dedupe here when the same tip arrives via ZMQ.
   * Handles reorgs: prunes chain when new tip is at lower height or same height with different hash.
   * @param {{ tip?: string, height?: number, supply?: number }} payload From bitcoin 'block' event.
   */
  async recordEpochFromBlock (payload = {}) {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const blockHash = payload.tip || null;
    const height = payload.height != null ? Number(payload.height) : (await this.bitcoin._makeRPCRequest('getblockcount', []));
    const balances = await this.bitcoin._makeRPCRequest('getbalances', []).catch(() => null);
    const trusted = (balances && balances.mine && balances.mine.trusted != null) ? Number(balances.mine.trusted) : 0;
    const balanceSats = Math.round(trusted * 1e8);

    if (height <= this._state.content.height && blockHash === this._state.content.lastBlockHash) {
      return null;
    }

    if (height < this._state.content.height) {
      this._pruneEpochChain(height);
    } else if (height === this._state.content.height && blockHash !== this._state.content.lastBlockHash) {
      const popped = this._epochChain.pop();
      const poppedClock = popped && popped.payload && popped.payload.clock != null
        ? Number(popped.payload.clock)
        : null;
      const last = this._epochChain[this._epochChain.length - 1];
      if (last && last.payload) {
        this._state.content.clock = last.payload.clock != null ? last.payload.clock : 0;
        this._state.content.lastBlockHash = last.payload.blockHash || null;
        this._state.content.height = last.payload.height != null ? last.payload.height : 0;
        this._state.content.balance = last.payload.balance != null ? last.payload.balance : 0;
        this._state.content.balanceSats = last.payload.balanceSats != null ? last.payload.balanceSats : 0;
      } else if (!this._epochChain.length) {
        this._state.content.clock = 0;
        this._state.content.lastBlockHash = null;
        this._state.content.height = 0;
        this._state.content.balance = 0;
        this._state.content.balanceSats = 0;
      }
      this.emit('reorg', {
        pruned: 1,
        sameHeight: true,
        removedBeaconClocks: poppedClock != null && Number.isFinite(poppedClock) ? [poppedClock] : []
      });
    }

    this._state.content.clock += 1;
    this._state.content.lastBlockHash = blockHash;
    this._state.content.height = height;
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

    let committedPayload = epoch;
    try {
      const entry = this._buildEpochEntry(epoch);
      this._epochChain.push(entry);
      await this._persistEpochChain();
      committedPayload = entry.payload;
    } catch (err) {
      this.emit('error', err);
    }

    this.emit('epoch', committedPayload);
    return committedPayload;
  }

  async start () {
    if (this._state.content.status === 'RUNNING') return this;
    this._state.content.status = 'RUNNING';

    await this._loadEpochChainFromFilesystem();

    const isRegtest = this.settings.regtest !== false;

    if (isRegtest) {
      // Regtest: generate blocks on a timer (1 block per interval).
      try {
        await this.createEpoch();
      } catch (err) {
        this.emit('error', err);
      }
      this.timer = setInterval(() => {
        this.createEpoch().catch((err) => this.emit('error', err));
      }, this.settings.interval);
    } else {
      // Non-regtest: 1 event per block (listen to bitcoin 'block' events).
      const prime = async () => {
        try {
          const tip = await this.bitcoin._makeRPCRequest('getbestblockhash', []);
          const height = await this.bitcoin._makeRPCRequest('getblockcount', []);
          await this.recordEpochFromBlock({ tip, height });
        } catch (err) {
          this.emit('error', err);
        }
      };
      await prime();
      this._blockHandler = (payload) => {
        this.recordEpochFromBlock(payload).catch((err) => this.emit('error', err));
      };
      if (this.bitcoin && typeof this.bitcoin.on === 'function') {
        this.bitcoin.on('block', this._blockHandler);
      }
    }

    return this;
  }

  async stop () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._blockHandler && this.bitcoin && typeof this.bitcoin.removeListener === 'function') {
      this.bitcoin.removeListener('block', this._blockHandler);
      this._blockHandler = null;
    }
    await this._persistEpochChain();
    this._state.content.status = 'STOPPED';
    return this;
  }
}

module.exports = Beacon;
