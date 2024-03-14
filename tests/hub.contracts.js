'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('hub.fabric.pub', function () {
  describe('Hub', function () {
    it('provides a valid contract', function () {
      const hub = new Hub();
      assert.ok(hub);
      assert.ok(hub.contract);
    });
  });
});
