'use strict';

const assert = require('assert');
const { DEFAULT_HUB_SEED_PEERS, withDefaultSeedPeers } = require('../functions/hubDefaultPeers');

describe('hubDefaultPeers', function () {
  it('appends both playnet seeds when peers are omitted', function () {
    assert.deepStrictEqual(withDefaultSeedPeers(undefined), DEFAULT_HUB_SEED_PEERS.slice());
    assert.deepStrictEqual(withDefaultSeedPeers(['127.0.0.1:7778']), ['127.0.0.1:7778', 'hub.fabric.pub:7777', 'relay.goon.vc:7777']);
  });

  it('keeps an explicit caller list unchanged, including []', function () {
    assert.deepStrictEqual(withDefaultSeedPeers([], { callerSetPeers: true }), []);
    assert.deepStrictEqual(withDefaultSeedPeers(['127.0.0.1:7778'], { callerSetPeers: true }), ['127.0.0.1:7778']);
  });

  it('does not duplicate a seed already present with a pubkey prefix or other case', function () {
    const pubkeyed = `${'02'.padEnd(66, 'a')}@Relay.Goon.VC:7777`;
    const out = withDefaultSeedPeers([pubkeyed, 'HUB.FABRIC.PUB:7777']);
    assert.deepStrictEqual(out, [pubkeyed, 'HUB.FABRIC.PUB:7777']);
  });

  it('never mutates its input', function () {
    const input = ['127.0.0.1:7778'];
    withDefaultSeedPeers(input);
    assert.deepStrictEqual(input, ['127.0.0.1:7778']);
  });
});
