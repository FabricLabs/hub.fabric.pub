'use strict';

const assert = require('assert');
const Beacon = require('../contracts/beacon');

describe('Beacon reorg / prune', function () {
  it('keeps epochs with height <= new inclusive tip', function () {
    const b = new Beacon();
    b._epochChain = [
      { type: 'BEACON_EPOCH', payload: { clock: 1, height: 9, blockHash: 'aa' } },
      { type: 'BEACON_EPOCH', payload: { clock: 2, height: 10, blockHash: 'bb' } }
    ];
    b._state.content.height = 10;
    b._pruneEpochChain(9);
    assert.strictEqual(b._epochChain.length, 1);
    assert.strictEqual(b._epochChain[0].payload.height, 9);
    assert.strictEqual(b._state.content.clock, 1);
  });

  it('records removed beacon clocks for sidechain snapshot prune', function () {
    const b = new Beacon();
    b._epochChain = [
      { type: 'BEACON_EPOCH', payload: { clock: 10, height: 5 } },
      { type: 'BEACON_EPOCH', payload: { clock: 11, height: 6 } }
    ];
    let reorgInfo = null;
    b.on('reorg', (i) => { reorgInfo = i; });
    b._pruneEpochChain(5);
    assert.ok(reorgInfo);
    assert.deepStrictEqual(reorgInfo.removedBeaconClocks, [11]);
  });
});
