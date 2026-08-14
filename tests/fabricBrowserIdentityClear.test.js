'use strict';

const assert = require('assert');

describe('clearFabricBrowserIdentityLocal', function () {
  afterEach(function () {
    delete global.window;
  });

  it('removes legacy key, nested fabric:state identity.local, session unlock, and resets store singleton', function () {
    const { resetFabricBrowserStateStore } = require('../functions/fabricBrowserState');

    const nestedState = {
      identity: {
        local: { id: 'should-go', xpub: 'xpubtest', passwordProtected: true }
      },
      hub: { address: 'keep-me' }
    };

    global.window = {
      sessionStorage: {
        _d: {},
        getItem (k) {
          return this._d[k] == null ? null : this._d[k];
        },
        setItem (k, v) {
          this._d[k] = String(v);
        },
        removeItem (k) {
          delete this._d[k];
        }
      },
      localStorage: {
        _d: {
          'fabric:state': JSON.stringify(nestedState),
          'fabric.identity.local': JSON.stringify({ id: 'legacy', xpub: 'xpublegacy' }),
          'fabric.identity.devSeedSuppressedFor': 'deadbeef'
        },
        getItem (k) {
          return this._d[k] == null ? null : this._d[k];
        },
        setItem (k, v) {
          this._d[k] = String(v);
        },
        removeItem (k) {
          delete this._d[k];
        }
      }
    };

    window.sessionStorage.setItem('fabric.identity.unlocked', '{"xprv":"secret"}');

    resetFabricBrowserStateStore();
    const { clearFabricBrowserIdentityLocal, readStorageJSON, store } = require('../functions/fabricBrowserState');

    clearFabricBrowserIdentityLocal();

    assert.strictEqual(window.localStorage._d['fabric.identity.local'], undefined);
    assert.strictEqual(window.localStorage._d['fabric.identity.devSeedSuppressedFor'], undefined);
    assert.strictEqual(window.sessionStorage._d['fabric.identity.unlocked'], undefined);

    const st = JSON.parse(window.localStorage._d['fabric:state']);
    assert.strictEqual(st.identity, undefined);
    assert.strictEqual(st.hub.address, 'keep-me');

    assert.strictEqual(readStorageJSON('fabric.identity.local', null), null);

    const s = store();
    assert.strictEqual(typeof s.GET('/identity/local'), 'undefined');
  });
});

describe('readStorageJSON fabric.identity.local merge', function () {
  afterEach(function () {
    delete global.window;
    try {
      const { resetFabricBrowserStateStore } = require('../functions/fabricBrowserState');
      resetFabricBrowserStateStore();
    } catch (e) {}
  });

  it('prefers legacy key when nested identity/local is empty but legacy has the identity', function () {
    const legacy = {
      id: 'id1',
      xpub: 'xpub9',
      passwordProtected: true,
      xprvEnc: 'enc',
      passwordSalt: 'salt'
    };
    global.window = {
      localStorage: {
        _d: {
          'fabric:state': JSON.stringify({ identity: { local: {} } }),
          'fabric.identity.local': JSON.stringify(legacy)
        },
        getItem (k) {
          return this._d[k] == null ? null : this._d[k];
        },
        setItem (k, v) {
          this._d[k] = String(v);
        },
        removeItem (k) {
          delete this._d[k];
        }
      }
    };

    const { resetFabricBrowserStateStore, readStorageJSON } = require('../functions/fabricBrowserState');
    resetFabricBrowserStateStore();
    const out = readStorageJSON('fabric.identity.local', null);
    assert.strictEqual(out && out.id, 'id1');
    assert.strictEqual(out && out.passwordProtected, true);
    assert.strictEqual(out && out.xprvEnc, 'enc');
  });
});
