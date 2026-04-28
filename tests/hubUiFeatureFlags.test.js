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

function setFabricUiFeatureFlags (featureFlags) {
  global.window.localStorage.setItem(
    'fabric:state',
    JSON.stringify({
      ui: { featureFlags }
    })
  );
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
        value: {
          advancedMode: true,
          bitcoinPayments: true,
          bitcoinCrowdfund: true
        }
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

  it('explicit peers true in storage is honored when advancedMode is off (beginner default does not override)', function () {
    setupWindowStorage();
    setFabricUiFeatureFlags({ peers: true });
    const f = flags.loadHubUiFeatureFlags();
    assert.strictEqual(f.peers, true);
  });

  it('empty {} in storage resets to bundled defaults (avoids malformed partial storage)', function () {
    setupWindowStorage();
    setFabricUiFeatureFlags({});
    const f = flags.loadHubUiFeatureFlags();
    assert.strictEqual(f.peers, true);
    assert.strictEqual(f.features, true);
    assert.strictEqual(f.activities, true);
    assert.strictEqual(f.sidechain, true);
    assert.strictEqual(f.bitcoinCrowdfund, true);
  });

  it('normalizeFlags honors peers false and explicit false for former always-on keys (UI-58)', function () {
    setupWindowStorage();
    flags.saveHubUiFeatureFlags({
      peers: false,
      features: false,
      activities: false,
      bitcoinExplorer: false,
      bitcoinInvoices: false
    });
    const f = flags.loadHubUiFeatureFlags();
    assert.strictEqual(f.peers, false);
    assert.strictEqual(f.features, false);
    assert.strictEqual(f.activities, false);
    assert.strictEqual(f.bitcoinExplorer, false);
    assert.strictEqual(f.bitcoinInvoices, false);
  });
});
