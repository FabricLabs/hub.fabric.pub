'use strict';

const assert = require('assert');
const {
  pruneStatusFromBlockchainInfo,
  isDocumentHeightPruned
} = require('../functions/bitcoinPruneInventory');

describe('bitcoinPruneInventory', function () {
  it('non-pruned chain has null pruneHeight', function () {
    const s = pruneStatusFromBlockchainInfo({ blocks: 900000, pruned: false });
    assert.strictEqual(s.pruned, false);
    assert.strictEqual(s.pruneHeight, null);
  });

  it('pruned chain exposes pruneHeight', function () {
    const s = pruneStatusFromBlockchainInfo({ blocks: 900100, pruned: true, pruneheight: 899000 });
    assert.strictEqual(s.pruned, true);
    assert.strictEqual(s.pruneHeight, 899000);
  });

  it('isDocumentHeightPruned compares doc height to prune floor', function () {
    assert.strictEqual(isDocumentHeightPruned(1000, 500), true);
    assert.strictEqual(isDocumentHeightPruned(1000, 1000), false);
    assert.strictEqual(isDocumentHeightPruned(1000, 2000), false);
    assert.strictEqual(isDocumentHeightPruned(null, 500), false);
  });
});
