'use strict';

const assert = require('assert');
const flags = require('../functions/hubUiFeatureFlags');

function setupWindowStorage () {
  const local = Object.create(null);
  global.window = {
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(local, k) ? local[k] : null),
      setItem: (k, v) => { local[k] = String(v); },
      removeItem: (k) => { delete local[k]; }
    },
    dispatchEvent: () => {}
  };
  global.CustomEvent = function MockCustomEvent (name, init) {
    this.type = name;
    this.detail = init && init.detail;
  };
}

describe('hubUiFeatureFlags', function () {
  afterEach(function () {
    delete global.window;
    delete global.fetch;
    delete global.CustomEvent;
  });

  it('fetchPersistedHubUiFeatureFlags hydrates local flags from /settings', async function () {
    setupWindowStorage();
    flags.saveHubUiFeatureFlags({ bitcoinPayments: false, bitcoinCrowdfund: false });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        setting: 'HUB_UI_FEATURE_FLAGS',
        value: { bitcoinPayments: true, bitcoinCrowdfund: true }
      })
    });

    const next = await flags.fetchPersistedHubUiFeatureFlags();
    assert.strictEqual(next.bitcoinPayments, true);
    assert.strictEqual(next.bitcoinCrowdfund, true);
    assert.strictEqual(flags.loadHubUiFeatureFlags().bitcoinPayments, true);
  });

  it('persistHubUiFeatureFlags requires admin token for disk save', async function () {
    setupWindowStorage();
    const result = await flags.persistHubUiFeatureFlags({ bitcoinPayments: true }, '');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.persisted, false);
    assert.strictEqual(flags.loadHubUiFeatureFlags().bitcoinPayments, true, 'local cache still updates');
  });
});
