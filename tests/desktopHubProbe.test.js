'use strict';

const assert = require('assert');
const {
  isFabricHubSettingsListPayload,
  isFabricHubOptionsPayload
} = require('../scripts/desktopHubProbe');

describe('scripts/desktopHubProbe', () => {
  describe('isFabricHubSettingsListPayload', () => {
    it('accepts Hub GET /settings shape', () => {
      assert.strictEqual(
        isFabricHubSettingsListPayload({
          success: true,
          settings: {},
          configured: false,
          needsSetup: true
        }),
        true
      );
      assert.strictEqual(
        isFabricHubSettingsListPayload({
          success: true,
          settings: { FOO: 'bar' },
          configured: true,
          needsSetup: false
        }),
        true
      );
    });

    it('rejects inconsistent setup flags', () => {
      assert.strictEqual(
        isFabricHubSettingsListPayload({
          success: true,
          settings: {},
          configured: true,
          needsSetup: true
        }),
        false
      );
    });

    it('rejects HTML or arbitrary JSON', () => {
      assert.strictEqual(isFabricHubSettingsListPayload(null), false);
      assert.strictEqual(isFabricHubSettingsListPayload({ success: true }), false);
      assert.strictEqual(
        isFabricHubSettingsListPayload({ success: true, settings: [], configured: false, needsSetup: true }),
        false
      );
    });
  });

  describe('isFabricHubOptionsPayload (regression)', () => {
    it('still matches hub name', () => {
      assert.strictEqual(isFabricHubOptionsPayload({ name: 'hub.fabric.pub' }), true);
    });
  });
});
