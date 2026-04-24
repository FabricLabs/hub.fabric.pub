'use strict';

const assert = require('assert');
const {
  readHubAdminTokenFromBrowser,
  saveHubAdminTokenToBrowser
} = require('../functions/hubAdminTokenBrowser');

describe('hubAdminTokenBrowser', () => {
  const realWindow = global.window;
  const realLS = global.localStorage;

  afterEach(() => {
    global.window = realWindow;
    global.localStorage = realLS;
  });

  it('readHubAdminTokenFromBrowser prefers prop over localStorage', () => {
    global.window = {
      localStorage: {
        getItem (k) {
          return k === 'fabric.hub.adminToken' ? 'from-ls' : null;
        }
      }
    };
    assert.strictEqual(readHubAdminTokenFromBrowser('from-prop'), 'from-prop');
  });

  it('readHubAdminTokenFromBrowser falls back to localStorage', () => {
    global.window = {
      localStorage: {
        getItem (k) {
          return k === 'fabric.hub.adminToken' ? 'abc' : null;
        }
      }
    };
    assert.strictEqual(readHubAdminTokenFromBrowser(null), 'abc');
    assert.strictEqual(readHubAdminTokenFromBrowser(''), 'abc');
  });

  it('saveHubAdminTokenToBrowser writes and dispatches event', () => {
    let dispatched = false;
    global.window = {
      localStorage: {
        _m: new Map(),
        getItem (k) {
          return this._m.get(k) || null;
        },
        setItem (k, v) {
          this._m.set(k, v);
        }
      },
      dispatchEvent (e) {
        if (e && e.type === 'fabricHubAdminTokenSaved') dispatched = true;
      }
    };
    assert.strictEqual(saveHubAdminTokenToBrowser('  tok  '), true);
    assert.strictEqual(global.window.localStorage.getItem('fabric.hub.adminToken'), 'tok');
    assert.strictEqual(dispatched, true);
  });

  it('saveHubAdminTokenToBrowser rejects empty', () => {
    global.window = { localStorage: { setItem () { throw new Error('no'); } }, dispatchEvent () {} };
    assert.strictEqual(saveHubAdminTokenToBrowser('   '), false);
  });
});
