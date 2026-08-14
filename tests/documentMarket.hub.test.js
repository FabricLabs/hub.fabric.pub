'use strict';

const assert = require('assert');
const Hub = require('../services/hub');
const { HUB_START_PHASES } = require('../functions/hubLifecycle');

describe('Hub Document Market accumulate + republish', function () {
  this.timeout(30000);

  async function makeHub (market = {}) {
    const fsStore = new Map();
    const hub = new Hub({
      debug: false,
      persistent: false,
      skipStartPhases: HUB_START_PHASES.slice(),
      fs: { path: './stores/hub-test-docmarket' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0, listen: false },
      bitcoin: { enable: false },
      payjoin: { enable: false },
      documents: {
        market: Object.assign({
          accumulatePeerInventories: true,
          republishWithMarkup: true,
          markupBps: 1000,
          markupSats: 0
        }, market)
      }
    });
    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub.recordActivity = () => {};
    hub._appendFabricMessage = async () => {};
    hub._refreshChainState = () => ({});
    hub._pushNetworkStatus = () => {};
    hub._sealDocumentForPricedPublish = async (id, parsed) => ({ parsed, key: Buffer.alloc(32) });
    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => (fsStore.has(name) ? fsStore.get(name) : null),
      publish: async (name, value) => {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        fsStore.set(name, serialized);
      }
    };
    hub.agent = {
      on: () => {},
      identity: { id: 'hub-self-id' },
      connections: {},
      knownPeers: {}
    };
    await hub.start();
    hub._fsStore = fsStore;
    return hub;
  }

  it('does not accumulate when the feature is off', async function () {
    const hub = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    const saved = hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + 'aa'.repeat(32) },
      object: { kind: 'documents', items: [{ id: 'ab'.repeat(32), purchasePriceSats: 10, published: true }] }
    }, { name: '127.0.0.1:9' });
    assert.deepStrictEqual(saved, []);
    assert.strictEqual(hub._documentMarketSnapshot().accumulatePeerInventories, false);
    await hub.stop().catch(() => {});
  });

  it('accumulates a peer snapshot and skips this hub\'s own actor', async function () {
    const hub = await makeHub();
    const fileId = 'cd'.repeat(32);
    const peerId = '02' + 'bb'.repeat(32);
    const saved = hub._accumulatePeerDocumentInventory({
      actor: { id: peerId },
      object: {
        kind: 'documents',
        items: [{ id: fileId, name: 'ops.txt', purchasePriceSats: 100, published: true, mime: 'text/plain' }]
      }
    }, { name: '10.0.0.2:7777' });
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].documentId, fileId);
    assert.strictEqual(saved[0].purchasePriceSats, 100);

    const self = hub._accumulatePeerDocumentInventory({
      actor: { id: 'hub-self-id' },
      object: { items: [{ id: fileId, purchasePriceSats: 1, published: true }] }
    }, { name: '127.0.0.1:1' });
    assert.deepStrictEqual(self, []);

    const offers = hub._documentOffersMap();
    const listed = Object.values(offers);
    assert.ok(listed.some((o) => o.peerPubkey === peerId.toLowerCase() || o.peerPubkey === peerId));
    await hub.stop().catch(() => {});
  });

  it('republishes a held blob at cost plus markup and keeps inventory local-only', async function () {
    const hub = await makeHub();
    const fileId = 'ee'.repeat(32);
    await hub.fs.publish(`documents/${fileId}.json`, {
      id: fileId,
      name: 'held.txt',
      mime: 'text/plain',
      size: 4,
      sha256: fileId,
      contentBase64: Buffer.from('held').toString('base64')
    });
    hub._state.documents = hub._state.documents || {};
    hub._state.documents[fileId] = {
      id: fileId,
      name: 'held.txt',
      mime: 'text/plain',
      sha256: fileId,
      size: 4
    };

    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + 'cc'.repeat(32) },
      object: {
        items: [{ id: fileId, name: 'held.txt', purchasePriceSats: 100, published: true }]
      }
    }, { name: '192.168.1.8:7777' });

    const changed = await hub._maybeRepublishHeldDocumentsFromMarket([fileId]);
    assert.strictEqual(changed.length, 1);
    assert.strictEqual(changed[0].document.purchasePriceSats, 110);
    assert.strictEqual(changed[0].costBasisSats, 100);

    const items = hub._collectLocalDocumentInventoryItems();
    const local = items.find((row) => row.id === fileId);
    assert.ok(local);
    assert.strictEqual(local.purchasePriceSats, 110);

    const remoteOnlyId = 'ff'.repeat(32);
    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + 'dd'.repeat(32) },
      object: {
        items: [{ id: remoteOnlyId, name: 'ghost.txt', purchasePriceSats: 5, published: true }]
      }
    }, { name: '192.168.1.9:7777' });
    hub._mergeFabricResyncInventoryItems([{
      id: remoteOnlyId,
      name: 'ghost.txt',
      mime: 'text/plain',
      purchasePriceSats: 5,
      published: true
    }]);
    const after = hub._collectLocalDocumentInventoryItems();
    assert.ok(!after.some((row) => row.id === remoteOnlyId), 'must not advertise files this hub cannot fulfill');
    await hub.stop().catch(() => {});
  });
});
