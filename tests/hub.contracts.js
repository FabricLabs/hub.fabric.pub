'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('hub.fabric.pub', function () {
  describe('Hub', function () {
    this.timeout(30000);

    it('provides a valid contract', function () {
      const hub = new Hub();
      assert.ok(hub);
      assert.ok(hub.contract);
    });

    it('seeds relay.goon.vc when peers are omitted and keeps an explicit list', function () {
      const prev = process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS;
      process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS = '1';
      try {
        const seeded = new Hub();
        assert.ok(seeded.settings.peers.includes('relay.goon.vc:7777'));
        assert.ok(seeded.settings.peers.includes('hub.fabric.pub:7777'));
        const empty = new Hub({ peers: [] });
        assert.deepStrictEqual(empty.settings.peers, []);
        const localOnly = new Hub({ peers: ['127.0.0.1:7778'] });
        assert.deepStrictEqual(localOnly.settings.peers, ['127.0.0.1:7778']);
      } finally {
        if (prev == null) delete process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS;
        else process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS = prev;
      }
    });
  });
});
