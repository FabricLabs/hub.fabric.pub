'use strict';

const assert = require('assert');
const inventoryRelay = require('../functions/inventoryRelay');

describe('inventoryRelay', function () {
  describe('shouldForwardP2pFileChunk', function () {
    it('returns false when no deliveryFabricId', function () {
      assert.strictEqual(inventoryRelay.shouldForwardP2pFileChunk({ id: 'x', contentBase64: 'YQ==' }, 'buyer1'), false);
    });

    it('returns false when recipient matches self', function () {
      assert.strictEqual(
        inventoryRelay.shouldForwardP2pFileChunk(
          { id: 'x', contentBase64: 'YQ==', deliveryFabricId: 'buyer1' },
          'buyer1'
        ),
        false
      );
    });

    it('returns true when delivery is another peer', function () {
      assert.strictEqual(
        inventoryRelay.shouldForwardP2pFileChunk(
          { id: 'x', contentBase64: 'YQ==', deliveryFabricId: 'buyer1', fileRelayTtl: 8 },
          'relay99'
        ),
        true
      );
    });
  });

  describe('decrementedFileRelayTtl', function () {
    it('returns null for missing or non-positive TTL', function () {
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({ fileRelayTtl: 0 }), null);
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({}), null);
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({ fileRelayTtl: NaN }), null);
    });

    it('clamps and decrements', function () {
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({ fileRelayTtl: 8 }), 7);
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({ fileRelayTtl: 20 }, 16), 15);
      assert.strictEqual(inventoryRelay.decrementedFileRelayTtl({ fileRelayTtl: 1 }), 0);
    });
  });
});
