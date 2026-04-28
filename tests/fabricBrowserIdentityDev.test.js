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

  it('stores identity in localStorage (no session hydration; unlock in UI)', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const r = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(r.ok, true);
    assert.ok(r.identity && r.identity.masterXprv);
    assert.ok(r.identity.xprv);

    const parsed = JSON.parse(window.localStorage._data['fabric.identity.local']);
    assert.strictEqual(parsed.fabricIdentityMode, 'account');
    assert.strictEqual(parsed.id, r.identity.id);
    assert.strictEqual(parsed.xpub, r.identity.xpub);
    assert.strictEqual(String(parsed.masterXprv || '').trim(), String(r.identity.masterXprv || '').trim());
    assert.strictEqual(String(parsed.xprv || '').trim(), String(r.identity.masterXprv || '').trim());
  });

  it('refuses second store without force', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const r1 = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(r1.ok, true);
    const r2 = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: false });
    assert.strictEqual(r2.ok, false);
    assert.ok(r2.error && r2.error.includes('already'));
  });
});
