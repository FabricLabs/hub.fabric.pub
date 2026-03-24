'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Hub = require('../services/hub');

const MIGRATION_TEST_PATH = path.join(__dirname, '../stores/hub-migration-test');

describe('Hub state migration', function () {
  this.timeout(30000);

  it('migrates fabricMessageTree to chain.tree when loading legacy state', async function () {
    const legacyTree = { leaves: 5, root: 'abc123' };
    const legacyState = {
      fabricMessageTree: legacyTree,
      genesisMessage: 'genesis-id-1',
      collections: {
        documents: {},
        contracts: {},
        messages: {
          'genesis-id-1': { id: 'genesis-id-1', seq: 0, type: 'GENESIS_MESSAGE', payload: { service: '@fabric/hub' } }
        }
      }
    };

    fs.mkdirSync(MIGRATION_TEST_PATH, { recursive: true });
    fs.writeFileSync(path.join(MIGRATION_TEST_PATH, 'STATE'), JSON.stringify(legacyState));

    const hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: MIGRATION_TEST_PATH },
      http: { hostname: 'localhost', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};
    hub.contract = { id: 'test', state: {}, deploy: () => {} };

    const methods = {};
    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: (name, handler) => { methods[name] = handler; },
      _addRoute: () => {},
      _addAllRoutes: () => {},
      _handleCall: async () => ({}),
      broadcast: () => {},
      start: async () => {},
      stop: async () => {},
      agent: { listenAddress: '127.0.0.1:7777', listening: true },
      listenAddress: '127.0.0.1:8080',
      webrtcPeers: new Map()
    };
    Object.defineProperty(hub.http, 'webrtcPeerList', {
      enumerable: true,
      get: () => []
    });
    hub.agent = {
      on: () => {},
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: {},
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {}
    };

    await hub.start();

    assert.ok(hub._state.content.chain, 'chain should exist');
    assert.strictEqual(hub._state.content.chain.genesis, 'genesis-id-1', 'chain.genesis should be migrated');
    assert.strictEqual(hub._state.content.fabricMessageTree, undefined, 'fabricMessageTree should be removed');
    assert.strictEqual(hub._state.content.genesisMessage, undefined, 'genesisMessage should be removed');
    assert.ok(hub._state.content.chain.tree, 'chain.tree should exist');

    await hub.stop().catch(() => {});
    try { fs.rmSync(MIGRATION_TEST_PATH, { recursive: true }); } catch (_) {}
  });

  it('migrates chain.messages object to collections.messages and chain.messages array', async function () {
    const msgObj = {
      'msg-1': { id: 'msg-1', seq: 1, type: 'GENESIS_MESSAGE', payload: {} },
      'msg-2': { id: 'msg-2', seq: 2, type: 'BitcoinBlock', payload: {} }
    };
    const legacyState = {
      chain: { tree: { leaves: 2, root: 'x' }, genesis: 'msg-1', messages: msgObj },
      collections: { documents: {}, contracts: {} }
    };

    const testPath = path.join(__dirname, '../stores/hub-migration-test2');
    fs.mkdirSync(testPath, { recursive: true });
    fs.writeFileSync(path.join(testPath, 'STATE'), JSON.stringify(legacyState));

    const hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: testPath },
      http: { hostname: 'localhost', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};
    hub.contract = { id: 'test', state: {}, deploy: () => {} };
    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: () => {},
      _addRoute: () => {},
      _addAllRoutes: () => {},
      _handleCall: async () => ({}),
      broadcast: () => {},
      start: async () => {},
      stop: async () => {},
      agent: { listenAddress: '127.0.0.1:7777', listening: true },
      listenAddress: '127.0.0.1:8080',
      webrtcPeers: new Map()
    };
    Object.defineProperty(hub.http, 'webrtcPeerList', { enumerable: true, get: () => [] });
    hub.agent = {
      on: () => {},
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: {},
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {}
    };

    await hub.start();

    assert.ok(hub._state.content.collections.messages, 'collections.messages should exist');
    const msg1 = hub._state.content.collections.messages['msg-1'];
    assert.ok(msg1, 'msg-1 should exist in collections.messages');
    assert.strictEqual(msg1.id, 'msg-1');
    assert.ok(Array.isArray(hub._state.content.chain.messages), 'chain.messages should be array');
    assert.deepStrictEqual(hub._state.content.chain.messages.sort(), ['msg-1', 'msg-2']);

    await hub.stop().catch(() => {});
    try { fs.rmSync(testPath, { recursive: true }); } catch (_) {}
  });
});
