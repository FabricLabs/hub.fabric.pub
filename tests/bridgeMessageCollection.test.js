'use strict';

const assert = require('assert');
const BridgeMessageCollection = require('../types/bridgeMessageCollection');

describe('BridgeMessageCollection', function () {
  it('loads and exports map deterministically', function () {
    const c = new BridgeMessageCollection();
    c.loadMap({
      a: { object: { created: 2 } },
      b: { object: { created: 1 } }
    });
    const out = c.exportMap();
    assert.ok(out.a);
    assert.ok(out.b);
  });

  it('replays in created order', function () {
    const c = new BridgeMessageCollection();
    c.loadMap({
      late: { object: { created: 9 } },
      early: { object: { created: 1 } }
    });
    const seen = [];
    const count = c.replay((id) => seen.push(id));
    assert.strictEqual(count, 2);
    assert.deepStrictEqual(seen, ['early', 'late']);
  });
});
