'use strict';

const assert = require('assert');
const Hub = require('../services/hub');
const { bitcoinBlockDocumentId } = require('../functions/bitcoinBlockDocument');

describe('Hub _ensureBitcoinBlockPublishedDocument', function () {
  this.timeout(60000);

  it('writes document file and published catalog entry', async function () {
    const fsStore = new Map();
    const hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: './stores/hub-test-bkdoc' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false, documentBlocks: true },
      payjoin: { enable: false }
    });

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};

    hub.contract = { id: 'test-contract', state: {}, deploy: () => {} };

    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => (fsStore.has(name) ? fsStore.get(name) : null),
      publish: async (name, value) => {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        fsStore.set(name, serialized);
      },
      addToChain: async () => true
    };

    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: () => {},
      _addRoute: () => {},
      _addAllRoutes: () => {},
      broadcast: () => {},
      start: async () => {},
      agent: { listenAddress: '127.0.0.1:7777', listening: true }
    };

    hub.agent = {
      on: () => {},
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-test-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: {},
      knownPeers: [],
      relayFrom: () => {}
    };

    await hub.start();
    hub._pushNetworkStatus = () => {};

    const block = {
      hash: 'aa'.repeat(32),
      height: 42,
      time: 1,
      tx: [{ txid: 'bb'.repeat(32) }],
      merkleroot: 'cc'.repeat(32),
      nTx: 1
    };

    await hub._ensureBitcoinBlockPublishedDocument(block, 'regtest');

    const id = bitcoinBlockDocumentId(block, 'regtest');
    const docKey = `documents/${id}.json`;
    assert.ok(fsStore.has(docKey), 'document JSON persisted');
    const row = hub._state.content.collections.documents[id];
    assert.ok(row, 'published row');
    assert.ok(row.published, 'published timestamp');
    assert.ok(String(row.name || '').includes('Bitcoin block'), 'name mentions block');

    await Promise.race([
      hub.stop(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop timeout')), 8000))
    ]).catch(() => {});
  });
});
