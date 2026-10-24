'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDesktopSecureStore } = require('../functions/desktopSecureStore');
const {
  hydrateDesktopSecureStorage,
  readStorageString,
  removeStorageKey,
  resetDesktopSecureStorage,
  resetFabricBrowserStateStore,
  writeStorageString
} = require('../functions/fabricBrowserState');

const KEY = 'fabric.hub.adminToken';

function memoryStorage (initial = {}) {
  return {
    _d: { ...initial },
    getItem (k) { return this._d[k] == null ? null : this._d[k]; },
    setItem (k, v) { this._d[k] = String(v); },
    removeItem (k) { delete this._d[k]; }
  };
}

function memoryBridge (initial = {}, available = true) {
  const data = { ...initial };
  return {
    data,
    available: async () => available,
    get: async (k) => data[k] || '',
    set: async (k, v) => { data[k] = v; return true; },
    remove: async (k) => { delete data[k]; return true; }
  };
}

describe('desktop secure store (main process file)', function () {
  let dir;
  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-secure-'));
  });
  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeStore () {
    return createDesktopSecureStore({
      filePath: path.join(dir, 'secure-store.json'),
      encrypt: (v) => Buffer.from(v, 'utf8').reverse(),
      decrypt: (b) => Buffer.from(b).reverse().toString('utf8')
    });
  }

  it('round-trips an allowed key without writing plaintext', function () {
    const s = makeStore();
    s.set(KEY, 'token-abc');
    assert.strictEqual(makeStore().get(KEY), 'token-abc');
    const raw = fs.readFileSync(path.join(dir, 'secure-store.json'), 'utf8');
    assert.ok(!raw.includes('token-abc'));
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(path.join(dir, 'secure-store.json')).mode & 0o777, 0o600);
    }
    s.remove(KEY);
    assert.strictEqual(s.get(KEY), '');
  });

  it('refuses keys outside the allowlist', function () {
    const s = makeStore();
    assert.throws(() => s.set('fabric.identity.local', 'x'), /Not a desktop secure key/);
    assert.throws(() => s.get('anything'), /Not a desktop secure key/);
  });

  it('returns empty when the ciphertext cannot be decrypted', function () {
    const s = createDesktopSecureStore({
      filePath: path.join(dir, 'secure-store.json'),
      encrypt: (v) => Buffer.from(v),
      decrypt: () => { throw new Error('keychain changed'); }
    });
    s.set(KEY, 'x');
    assert.strictEqual(s.get(KEY), '');
  });
});

describe('desktop secure storage (renderer cache)', function () {
  afterEach(function () {
    resetDesktopSecureStorage();
    resetFabricBrowserStateStore();
    delete global.window;
  });

  it('migrates a plaintext token out of localStorage and serves it from memory', async function () {
    global.window = {
      localStorage: memoryStorage({
        'fabric:state': JSON.stringify({ hub: { adminToken: 'old-token' } }),
        [KEY]: 'old-token'
      })
    };
    resetFabricBrowserStateStore();
    const bridge = memoryBridge();

    assert.strictEqual(await hydrateDesktopSecureStorage(bridge), true);
    assert.strictEqual(bridge.data[KEY], 'old-token');
    assert.strictEqual(window.localStorage._d[KEY], undefined);
    assert.ok(!String(window.localStorage._d['fabric:state'] || '').includes('old-token'));
    assert.strictEqual(readStorageString(KEY), 'old-token');

    writeStorageString(KEY, 'new-token');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(readStorageString(KEY), 'new-token');
    assert.strictEqual(bridge.data[KEY], 'new-token');
    assert.strictEqual(window.localStorage._d[KEY], undefined);

    removeStorageKey(KEY);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(readStorageString(KEY), '');
    assert.strictEqual(bridge.data[KEY], undefined);
  });

  it('prefers the secure copy over a stale plaintext one', async function () {
    global.window = { localStorage: memoryStorage({ [KEY]: 'stale' }) };
    resetFabricBrowserStateStore();
    const bridge = memoryBridge({ [KEY]: 'sealed' });
    await hydrateDesktopSecureStorage(bridge);
    assert.strictEqual(readStorageString(KEY), 'sealed');
    assert.strictEqual(window.localStorage._d[KEY], undefined);
  });

  it('leaves browser storage alone when the shell has no secure store', async function () {
    global.window = { localStorage: memoryStorage({ [KEY]: 'plain' }) };
    resetFabricBrowserStateStore();
    assert.strictEqual(await hydrateDesktopSecureStorage(), false);
    assert.strictEqual(await hydrateDesktopSecureStorage(memoryBridge({}, false)), false);
    assert.strictEqual(readStorageString(KEY), 'plain');
    writeStorageString(KEY, 'plain-2');
    assert.strictEqual(window.localStorage._d[KEY], 'plain-2');
  });
});
