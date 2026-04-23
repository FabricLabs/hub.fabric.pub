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

  it('stores identity and writes full unlocked snapshot to sessionStorage', function () {
    const { storeUnlockedIdentityFromMnemonic } = require('../functions/fabricBrowserIdentityDev');
    const r = storeUnlockedIdentityFromMnemonic({ seed: phrase, force: true });
    assert.strictEqual(r.ok, true);
    assert.ok(r.identity && r.identity.id);
    assert.ok(r.identity.xpub);
    assert.ok(r.identity.xprv);

    const raw = window.sessionStorage.getItem('fabric.identity.unlocked');
    assert.ok(raw);
    const snap = JSON.parse(raw);
    assert.strictEqual(snap.id, r.identity.id);
    assert.strictEqual(snap.xpub, r.identity.xpub);
    assert.strictEqual(snap.xprv, r.identity.xprv);
    assert.strictEqual(snap.passwordProtected, false);
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
