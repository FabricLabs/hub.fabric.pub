'use strict';

const Contract = require('@fabric/core/types/contract');
const Remote = require('@fabric/core/types/remote');

class Registry extends Contract {
  constructor (input = {}) {
    super(input);

    this.settings = Object.assign({
      state: {
        contracts: {}
      }
    }, input);

    this.insight = new Remote({ authority: 'insight.fabric.pub' });

    this._state = {
      content: this.settings.state
    };

    return this;
  }

  async start () {
    super.start();

    const tip = await this.insight._GET('/api/BTC/mainnet/block/tip');
    console.log('tip:', tip);
  }
}

module.exports = Registry;
