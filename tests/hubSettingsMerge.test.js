'use strict';

const assert = require('assert');
const merge = require('lodash.merge');
const { hubSettingsMerge } = require('../functions/hubSettingsMerge');

describe('hubSettingsMerge', () => {
  it('replaces peers from the rightmost layer that defines peers', () => {
    const local = { peers: ['hub.fabric.pub:7777'], bitcoin: { enable: true } };
    const isolated = hubSettingsMerge(local, { peers: [], bitcoin: { enable: false } });
    assert.deepStrictEqual(isolated.peers, []);
    assert.strictEqual(isolated.bitcoin.enable, false);
  });

  it('matches broken lodash.merge behavior we avoid', () => {
    const local = { peers: ['a', 'b'] };
    const broken = merge({}, local, { peers: [] });
    assert.ok(broken.peers.length > 0, 'lodash.merge keeps seed peers (documents bug)');
    const fixed = hubSettingsMerge(local, { peers: [] });
    assert.deepStrictEqual(fixed.peers, []);
  });
});
