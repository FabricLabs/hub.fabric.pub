'use strict';

const assert = require('assert');

describe('fabricBrowserIdentityDev.storeUnlockedIdentityFromMnemonic', function () {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(function () {
    global.window = {
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
        }
      }
    };
  });

  afterEach(function () {
    delete global.window;
  });

  it('stores watch-only identity in localStorage and unlocked key in sessionStorage', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const r = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(r.ok, true);
    assert.ok(r.identity && r.identity.masterXprv);
    assert.ok(r.identity.xprv);

    const parsed = JSON.parse(window.localStorage._data['fabric.identity.local']);
    assert.strictEqual(parsed.fabricIdentityMode, 'account');
    assert.strictEqual(parsed.id, r.identity.id);
    assert.strictEqual(parsed.xpub, r.identity.xpub);
    assert.strictEqual(typeof parsed.masterXprv, 'undefined');
    assert.strictEqual(typeof parsed.xprv, 'undefined');
    const unlocked = JSON.parse(window.sessionStorage._data['fabric.identity.unlocked']);
    assert.strictEqual(String(unlocked.id), String(r.identity.id));
    assert.strictEqual(String(unlocked.xpub), String(r.identity.xpub));
    assert.strictEqual(String(unlocked.xprv), String(r.identity.xprv));
  });

  it('refuses second store without force', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const r1 = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(r1.ok, true);
    const r2 = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: false });
    assert.strictEqual(r2.ok, false);
    assert.ok(r2.error && r2.error.includes('already'));
  });

  it('uses optional BIP39 extension passphrase in derivation (different identity id than without)', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const rNoPass = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(rNoPass.ok, true);
    const idNoPass = rNoPass.identity.id;

    window.localStorage._data = {};
    window.sessionStorage._data = {};
    const rWithPass = storeUnlockedIdentityFromMnemonic({
      seed: phrase,
      passphrase: 'test-bip39-extension-passphrase',
      force: true
    });
    assert.strictEqual(rWithPass.ok, true);
    assert.notStrictEqual(rWithPass.identity.id, idNoPass, 'BIP39 passphrase must change derived keys (BIP-39 salt)');
    assert.notStrictEqual(rWithPass.identity.xpub, rNoPass.identity.xpub);
  });
});
