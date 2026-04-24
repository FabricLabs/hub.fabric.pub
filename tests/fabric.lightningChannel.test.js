'use strict';

/**
 * Unit tests for Hub's LightningChannel (extends @fabric/core Channel).
 *
 * For full stack tests with lightningd + bitcoind, see the upstream package:
 *   fabric/tests/lightning/fabric.lightning.js
 *   fabric/tests/lightning/lightning.service.unit.js (skips when `which lightningd` fails)
 *
 * Inventory P2TR HTLC coverage: tests/inventoryHTLC.test.js (Fabric L1 protocol).
 */

const assert = require('assert');
const LightningChannel = require('../types/lightningChannel');
const Channel = require('@fabric/core/types/channel');

describe('types/lightningChannel', function () {
  it('extends Fabric Channel', function () {
    const lc = new LightningChannel({});
    assert.ok(lc instanceof Channel);
    assert.ok(typeof lc.add === 'function');
    assert.ok(typeof lc.open === 'function');
    assert.ok(typeof lc.close === 'function');
  });

  it('stores CLN identifiers in lightning snapshot', function () {
    const lc = new LightningChannel({
      peerId: '03' + 'a'.repeat(64),
      shortChannelId: '1x2x3',
      clnChannelId: 'chan-internal'
    });
    const ln = lc.lightning;
    assert.strictEqual(ln.peerId.length, 66);
    assert.strictEqual(ln.shortChannelId, '1x2x3');
    assert.strictEqual(ln.clnChannelId, 'chan-internal');
    assert.strictEqual(ln.status, 'unknown');
  });

  it('setLightningState merges and returns snapshot', function () {
    const lc = new LightningChannel({ peerId: '03' + 'b'.repeat(64) });
    const out = lc.setLightningState({ status: 'active', shortChannelId: '5x0x1' });
    assert.strictEqual(out.status, 'active');
    assert.strictEqual(out.shortChannelId, '5x0x1');
    assert.strictEqual(lc.lightning.status, 'active');
  });

  it('aliases remoteNodeId and channelId in constructor', function () {
    const lc = new LightningChannel({
      remoteNodeId: '03cc',
      channelId: 'abc123'
    });
    assert.strictEqual(lc.lightning.peerId, '03cc');
    assert.strictEqual(lc.lightning.clnChannelId, 'abc123');
  });

  it('inherits Channel balance updates', function () {
    const lc = new LightningChannel({});
    lc.add(5000);
    assert.strictEqual(lc.balance, 5000);
  });
});
