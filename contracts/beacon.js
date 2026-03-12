'use strict';

const merge = require('lodash.merge');
const Actor = require('@fabric/core/types/actor');

class Beacon extends Actor {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      name: 'HUB:BEACON',
      debug: false,
      interval: 60000
    }, settings);

    this.bitcoin = null;
    this.timer = null;
    this._state = {
      content: {
        clock: 0,
        status: 'STOPPED',
        lastBlockHash: null,
        height: 0
      }
    };

    return this;
  }

  get state () {
    return this._state.content;
  }

  async createEpoch () {
    if (!this.bitcoin) throw new Error('Beacon has no Bitcoin service attached.');

    const address = await this.bitcoin.getUnusedAddress();
    const generated = await this.bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
    const blockHash = Array.isArray(generated) ? generated[0] : generated;
    const height = await this.bitcoin._makeRPCRequest('getblockcount', []);

    this._state.content.clock += 1;
    this._state.content.lastBlockHash = blockHash || null;
    this._state.content.height = Number(height || 0);

    const epoch = {
      clock: this._state.content.clock,
      blockHash: this._state.content.lastBlockHash,
      height: this._state.content.height,
      timestamp: new Date().toISOString()
    };

    this.emit('epoch', epoch);
    return epoch;
  }

  async start () {
    if (this._state.content.status === 'RUNNING') return this;
    this._state.content.status = 'RUNNING';

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

    this._state.content.status = 'STOPPED';
    return this;
  }
}

module.exports = Beacon;
