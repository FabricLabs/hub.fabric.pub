'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub bitcoin public height', function () {
  it('coerces string height and falls back to blockchain.blocks', function () {
    this.timeout(45000);
    const hub = new Hub({
      port: 0,
      peers: [],
      bitcoin: { enable: false },
      http: { listen: false }
    });

    const a = hub._sanitizeBitcoinStatusForPublic({
      available: true,
      status: 'ONLINE',
      network: 'regtest',
      height: '42',
      bestHash: 'abc'
    });
    assert.strictEqual(a.height, 42);

    const b = hub._sanitizeBitcoinStatusForPublic({
      available: true,
      network: 'regtest',
      blockchain: { blocks: 99 }
    });
    assert.strictEqual(b.height, 99);
  });
});
