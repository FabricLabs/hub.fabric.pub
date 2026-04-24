'use strict';

const assert = require('assert');
const { createFabricBrowserStore } = require('../functions/fabricBrowserStore');

function createMemoryStorage () {
  const data = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

describe('fabricBrowserStore', function () {
  let prevWindow;
  let storage;

  beforeEach(function () {
    prevWindow = global.window;
    storage = createMemoryStorage();
    global.window = { localStorage: storage };
  });

  afterEach(function () {
    global.window = prevWindow;
  });

  it('supports GET/PUT/DELETE over JSON-pointer paths', function () {
    const store = createFabricBrowserStore({
      storageKey: 'fabric:test:state',
      initialState: { documents: {} }
    });

    store.PUT('/documents/doc-1', { id: 'doc-1', name: 'hello' });
    assert.deepStrictEqual(store.GET('/documents/doc-1'), { id: 'doc-1', name: 'hello' });

    store.DELETE('/documents/doc-1');
    assert.strictEqual(store.GET('/documents/doc-1'), undefined);
  });

  it('supports PATCH with Fabric-style analog ops', function () {
    const store = createFabricBrowserStore({
      storageKey: 'fabric:test:patch',
      initialState: { settings: { retries: 1, mode: 'slow' } }
    });

    store.PATCH({ op: 'set', path: '/settings/retries', value: 3 });
    store.PATCH({ op: 'merge', path: '/settings', value: { mode: 'fast', debug: true } });
    store.PATCH({ op: 'unset', path: '/settings/debug' });

    assert.deepStrictEqual(store.GET('/settings'), { retries: 3, mode: 'fast' });
  });

  it('reloads persisted state from localStorage', function () {
    const a = createFabricBrowserStore({
      storageKey: 'fabric:test:persist',
      initialState: { messages: {} }
    });
    a.PUT('/messages/m1', { id: 'm1', content: 'hello' });

    const b = createFabricBrowserStore({
      storageKey: 'fabric:test:persist',
      initialState: { messages: {} }
    });
    assert.deepStrictEqual(b.GET('/messages/m1'), { id: 'm1', content: 'hello' });
  });
});

