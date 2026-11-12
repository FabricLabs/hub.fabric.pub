'use strict';

const assert = require('assert');

function memoryStorage () {
  return {
    _data: {},
    getItem (k) { return this._data[k] == null ? null : this._data[k]; },
    setItem (k, v) { this._data[k] = String(v); },
    removeItem (k) { delete this._data[k]; }
  };
}

describe('fabricBrowserIdentityDev.applyFabricDevBrowserSeedBootstrap', function () {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(function () {
    global.window = {
      FABRIC_DEV_BROWSER_SEED: phrase,
      addEventListener () {},
      removeEventListener () {},
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage()
    };
    try { require('../functions/fabricBrowserState').resetFabricBrowserStateStore(); } catch (_) {}
  });

  afterEach(function () {
    delete global.window;
  });

  it('derives an unlocked account identity in memory and writes nothing to storage', function () {
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const r = applyFabricDevBrowserSeedBootstrap({ network: 'regtest' });
    assert.strictEqual(r.ok, true);
    assert.ok(r.identity.xprv, 'identity leaf private key');
    assert.ok(r.identity.masterXprv, 'master kept in memory for account switching');
    assert.strictEqual(r.identity.fabricAccountIndex, 0);
    assert.strictEqual(r.identity.network, 'regtest');
    assert.strictEqual(r.identity.devSeed, true);
    assert.strictEqual(r.identity.xpub, undefined, 'no identity xpub on the identity');
    assert.ok(/^tpub/.test(r.identity.wallet.segwit.xpub), 'testnet wallet xpub');
    assert.deepStrictEqual(window.localStorage._data, {});
    assert.deepStrictEqual(window.sessionStorage._data, {});
  });

  it('derives a different identity on another network for the same account', function () {
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const regtest = applyFabricDevBrowserSeedBootstrap({ network: 'regtest' });
    const mainnet = applyFabricDevBrowserSeedBootstrap({ network: 'mainnet' });
    assert.notStrictEqual(regtest.identity.id, mainnet.identity.id);
    assert.ok(/^xpub/.test(mainnet.identity.wallet.segwit.xpub));
  });

  it('uses the BIP39 passphrase in derivation', function () {
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const plain = applyFabricDevBrowserSeedBootstrap();
    window.FABRIC_DEV_BROWSER_PASSPHRASE = 'test-bip39-extension-passphrase';
    const salted = applyFabricDevBrowserSeedBootstrap();
    assert.notStrictEqual(salted.identity.id, plain.identity.id);
  });

  it('skips when no seed is configured', function () {
    delete window.FABRIC_DEV_BROWSER_SEED;
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const r = applyFabricDevBrowserSeedBootstrap();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.skipped, true);
  });

  it('leaves a stored identity alone unless forced', function () {
    const { applyFabricDevBrowserSeedBootstrap } = require('../functions/fabricBrowserIdentityDev');
    const r = applyFabricDevBrowserSeedBootstrap({ hasStoredIdentity: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'stored-identity');
    window.FABRIC_DEV_BROWSER_IDENTITY = 'force';
    assert.strictEqual(applyFabricDevBrowserSeedBootstrap({ hasStoredIdentity: true }).ok, true);
  });

  it('stays off after Remove identity wipes that seed, even when forced', function () {
    const {
      applyFabricDevBrowserSeedBootstrap,
      suppressActiveDevSeed,
      isDevSeedSuppressed
    } = require('../functions/fabricBrowserIdentityDev');
    const { clearFabricBrowserIdentityLocal } = require('../functions/fabricBrowserState');
    window.FABRIC_DEV_BROWSER_IDENTITY = 'force';
    clearFabricBrowserIdentityLocal();
    suppressActiveDevSeed();
    clearFabricBrowserIdentityLocal();
    assert.strictEqual(isDevSeedSuppressed(phrase), true);
    const r = applyFabricDevBrowserSeedBootstrap();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.suppressed, true);
  });

  it('a wipe marker for one seed does not block another', function () {
    const {
      applyFabricDevBrowserSeedBootstrap,
      suppressDevSeed,
      clearDevSeedSuppression
    } = require('../functions/fabricBrowserIdentityDev');
    suppressDevSeed('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');
    assert.strictEqual(applyFabricDevBrowserSeedBootstrap().ok, true);
    suppressDevSeed(phrase);
    assert.strictEqual(applyFabricDevBrowserSeedBootstrap().ok, false);
    clearDevSeedSuppression();
    assert.strictEqual(applyFabricDevBrowserSeedBootstrap().ok, true);
  });
});
