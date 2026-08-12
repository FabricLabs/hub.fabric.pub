'use strict';

const assert = require('assert');

describe('applyFabricDevBrowserSeedBootstrap + mergeUnlockedSession', function () {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(function () {
    global.window = {
      FABRIC_DEV_BROWSER_SEED: phrase,
      FABRIC_DEV_BROWSER_IDENTITY: 'force',
      addEventListener () {},
      removeEventListener () {},
      localStorage: {
        _data: {},
        getItem (k) {
          return this._data[k] == null ? null : this._data[k];
        },
        setItem (k, v) {
          this._data[k] = String(v);
        },
        removeItem (k) {
          delete this._data[k];
        }
      },
      sessionStorage: {
        _data: {},
        getItem (k) {
          return this._data[k] == null ? null : this._data[k];
        },
        setItem (k, v) {
          this._data[k] = String(v);
        },
        removeItem (k) {
          delete this._data[k];
        }
      }
    };
  });

  afterEach(function () {
    delete global.window;
  });

  it('bootstraps from FABRIC_DEV_BROWSER_SEED and merges unlock into identity', function () {
    const {
      applyFabricDevBrowserSeedBootstrap,
      mergeUnlockedSessionIntoIdentity
    } = require('../functions/fabricBrowserIdentityDev');
    const r = applyFabricDevBrowserSeedBootstrap();
    assert.strictEqual(r.ok, true);
    assert.ok(r.identity && r.identity.xpub);
    const merged = mergeUnlockedSessionIntoIdentity({
      id: r.identity.id,
      xpub: r.identity.xpub,
      xprv: null
    });
    assert.ok(merged.xprv);
    assert.strictEqual(merged.xprv, r.identity.xprv);
  });

  it('skips when no seed is configured', function () {
    delete window.FABRIC_DEV_BROWSER_SEED;
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const r = applyFabricDevBrowserSeedBootstrap();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.skipped, true);
  });
});

describe('shouldAutoFundDesktopLocalKey', function () {
  afterEach(function () {
    delete global.window;
  });

  it('requires desktop shell, regtest, identity xpub, and zero balance', function () {
    const {
      shouldAutoFundDesktopLocalKey,
      AUTO_FAUCET_SESSION_KEY
    } = require('../functions/fundLocalKeyFromHubFaucet');

    global.window = {
      fabricDesktop: { isDesktopShell: true },
      sessionStorage: {
        _data: {},
        getItem (k) { return this._data[k] == null ? null : this._data[k]; },
        setItem (k, v) { this._data[k] = String(v); }
      }
    };

    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: { xpub: 'tpubExample' },
      clientBalance: { balanceSats: 0 },
      network: 'regtest'
    }), true);

    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: { xpub: 'tpubExample' },
      clientBalance: { balanceSats: 5000 },
      network: 'regtest'
    }), false);

    window.sessionStorage.setItem(AUTO_FAUCET_SESSION_KEY, '1');
    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: { xpub: 'tpubExample' },
      clientBalance: null,
      network: 'regtest'
    }), false);
  });

  it('respects FABRIC_DESKTOP_AUTO_FAUCET = false', function () {
    const { shouldAutoFundDesktopLocalKey } = require('../functions/fundLocalKeyFromHubFaucet');
    global.window = {
      fabricDesktop: { isDesktopShell: true },
      FABRIC_DESKTOP_AUTO_FAUCET: false,
      sessionStorage: {
        _data: {},
        getItem () { return null; },
        setItem () {}
      }
    };
    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: { xpub: 'tpubExample' },
      clientBalance: null,
      network: 'regtest'
    }), false);
  });
});
