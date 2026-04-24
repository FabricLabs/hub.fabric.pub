'use strict';

const assert = require('assert');
const merge = require('lodash.merge');
const Hub = require('../services/hub');
const settings = require('../settings/local');

describe('Hub _bitcoinP2pAddNodesList', function () {
  this.timeout(30000);

  it('includes hub.fabric.pub:18444 on regtest by default', function () {
    const hub = new Hub(merge({}, settings, {
      port: 0,
      bitcoin: merge({}, settings.bitcoin, { enable: false, network: 'regtest' }),
      http: { listen: false }
    }));
    const list = hub._bitcoinP2pAddNodesList();
    assert.ok(list.includes('hub.fabric.pub:18444'), list.join(','));
  });

  it('omits playnet default when FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1', function () {
    const prev = process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER;
    process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
    try {
      const hub = new Hub(merge({}, settings, {
        port: 0,
        bitcoin: merge({}, settings.bitcoin, { enable: false, network: 'regtest', p2pAddNodes: [] }),
        http: { listen: false }
      }));
      const list = hub._bitcoinP2pAddNodesList();
      assert.ok(!list.includes('hub.fabric.pub:18444'), list.join(','));
    } finally {
      if (prev === undefined) delete process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER;
      else process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = prev;
    }
  });

  it('does not inject playnet default on mainnet', function () {
    const hub = new Hub(merge({}, settings, {
      port: 0,
      bitcoin: merge({}, settings.bitcoin, { enable: false, network: 'mainnet', p2pAddNodes: [] }),
      http: { listen: false }
    }));
    const list = hub._bitcoinP2pAddNodesList();
    assert.ok(!list.includes('hub.fabric.pub:18444'), list.join(','));
  });
});
