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

    // Seed-merge rules live in tests/hubDefaultPeers.test.js; this only checks the wiring.
    it('seeds relay.goon.vc when peers are omitted', function () {
      const prev = process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS;
      process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS = '1';
      try {
        const seeded = new Hub();
        assert.ok(seeded.settings.peers.includes('relay.goon.vc:7777'));
        assert.ok(seeded.settings.peers.includes('hub.fabric.pub:7777'));
      } finally {
        if (prev == null) delete process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS;
        else process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS = prev;
      }
    });
  });
});
