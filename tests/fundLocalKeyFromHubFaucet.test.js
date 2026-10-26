'use strict';

const assert = require('assert');

const WALLET_IDENTITY = { id: 'dev', wallet: { segwit: { xpub: 'tpubExample' } } };

describe('shouldAutoFundDesktopLocalKey', function () {
  afterEach(function () {
    delete global.window;
  });

  it('requires desktop shell, regtest, an identity wallet, and zero balance', function () {
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
      identity: WALLET_IDENTITY,
      clientBalance: { balanceSats: 0 },
      network: 'regtest'
    }), true);

    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: WALLET_IDENTITY,
      clientBalance: { balanceSats: 5000 },
      network: 'regtest'
    }), false);

    window.sessionStorage.setItem(AUTO_FAUCET_SESSION_KEY, '1');
    assert.strictEqual(shouldAutoFundDesktopLocalKey({
      identity: WALLET_IDENTITY,
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
      identity: WALLET_IDENTITY,
      clientBalance: null,
      network: 'regtest'
    }), false);
  });
});
