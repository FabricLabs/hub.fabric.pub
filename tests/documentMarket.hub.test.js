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
    assert.ok(!local.costBasisSats, 'outbound inventory must not advertise operator cost basis');

    const held = await hub._getDocumentPayload(fileId);
    assert.strictEqual(held.type, 'GetDocumentResult');
    assert.ok(held.document);
    assert.strictEqual(held.document.purchasePriceSats, 110);
    assert.strictEqual(held.document.costBasisSats, undefined);
    assert.ok(held.document.contentBase64);
    assert.ok(Array.isArray(held.document.offers));
    assert.ok(held.document.offers.some((o) => o.local !== true && o.purchasePriceSats === 100));
    assert.strictEqual(held.document.bestPeerPriceSats, 100);

    const market = require('../functions/documentInventoryMarket');
    const listed = market.mergeCatalog(
      [{
        id: fileId,
        purchasePriceSats: 110,
        costBasisSats: 100,
        published: true
      }],
      market.listOffers(hub._documentOffersMap()),
      { includeRemoteOnly: true }
    );
    const row = listed.find((d) => d.id === fileId);
    assert.ok(row);
    assert.strictEqual(row.purchasePriceSats, 110);
    assert.strictEqual(row.costBasisSats, undefined);
    await hub.stop().catch(() => {});
  });

  it('GetDocument returns peer-only metadata without a blob or cost basis', async function () {
    const hub = await makeHub();
    const fileId = 'aa'.repeat(32);
    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + '11'.repeat(32) },
      object: {
        items: [{
          id: fileId,
          name: 'ghost.txt',
          mime: 'text/plain',
          purchasePriceSats: 40,
          published: true,
          contentBase64: Buffer.from('should-not-store').toString('base64')
        }]
      }
    }, { name: '10.0.0.9:7777' });

    const missing = await hub._getDocumentPayload(fileId);
    assert.strictEqual(missing.local, false);
    assert.ok(missing.document);
    assert.strictEqual(missing.document.local, false);
    assert.strictEqual(missing.document.name, 'ghost.txt');
    assert.strictEqual(missing.document.purchasePriceSats, 40);
    assert.strictEqual(missing.document.contentBase64, undefined);
    assert.strictEqual(missing.document.costBasisSats, undefined);
    assert.ok(Array.isArray(missing.document.offers));
    assert.strictEqual(missing.document.offers[0].purchasePriceSats, 40);

    const unknown = await hub._getDocumentPayload('bb'.repeat(32));
    assert.strictEqual(unknown.document, null);
    assert.match(String(unknown.message), /not found/i);
    await hub.stop().catch(() => {});
  });

  it('RefreshDocumentMarket queries connected peers when accumulate is on', async function () {
    const hub = await makeHub();
    const asked = [];
    hub.agent.requestPeerInventory = (addr, opts) => {
      asked.push({ addr, opts });
      return true;
    };
    hub.agent.connections = {
      '10.0.0.4:7777': { _writeFabric: () => {} },
      dead: {}
    };
    const out = hub._refreshConnectedDocumentInventories();
    assert.strictEqual(out.requested, 1);
    assert.deepStrictEqual(out.peers, ['10.0.0.4:7777']);
    assert.strictEqual(asked[0].opts.kind, 'documents');

    const off = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    off.agent.requestPeerInventory = () => true;
    off.agent.connections = { '10.0.0.5:7777': { _writeFabric: () => {} } };
    const idle = off._refreshConnectedDocumentInventories();
    assert.strictEqual(idle.requested, 0);
    await hub.stop().catch(() => {});
    await off.stop().catch(() => {});
  });

  it('treats contentBase64 and sealed encryption as a local blob, not metadata-only rows', async function () {
    const hub = await makeHub();
    const plainId = '12'.repeat(32);
    const sealedId = '13'.repeat(32);
    const ghostId = '14'.repeat(32);
    await hub.fs.publish(`documents/${plainId}.json`, {
      id: plainId,
      contentBase64: Buffer.from('ok').toString('base64')
    });
    await hub.fs.publish(`documents/${sealedId}.json`, {
      id: sealedId,
      encryption: { scheme: 'aes-256-gcm-content-v1', contentSha256: 'ab'.repeat(32) }
    });
    await hub.fs.publish(`documents/${ghostId}.json`, '{not-json');
    hub._state.documents = {
      [plainId]: { id: plainId, name: 'ok.txt' },
      [sealedId]: { id: sealedId, name: 'sealed.bin' },
      [ghostId]: { id: ghostId, name: 'broken.json' },
      ['15'.repeat(32)]: { id: '15'.repeat(32), name: 'missing.txt' }
    };
    assert.strictEqual(hub._hasLocalDocumentBlob(plainId), true);
    assert.strictEqual(hub._hasLocalDocumentBlob(sealedId), true);
    assert.strictEqual(hub._hasLocalDocumentBlob(ghostId), false);
    assert.strictEqual(hub._hasLocalDocumentBlob('15'.repeat(32)), false);
    const items = hub._collectLocalDocumentInventoryItems();
    assert.ok(items.some((row) => row.id === plainId));
    assert.ok(items.some((row) => row.id === sealedId));
    assert.ok(!items.some((row) => row.id === ghostId));
    await hub.stop().catch(() => {});
  });

  it('raises an underpriced local listing and scans offers when ids are omitted', async function () {
    const hub = await makeHub();
    const fileId = '16'.repeat(32);
    await hub.fs.publish(`documents/${fileId}.json`, {
      id: fileId,
      name: 'held.txt',
      mime: 'text/plain',
      sha256: fileId,
      contentBase64: Buffer.from('held').toString('base64')
    });
    hub._state.documents = { [fileId]: { id: fileId, name: 'held.txt', sha256: fileId } };
    const first = await hub._publishHeldDocumentAtPrice(fileId, 50);
    assert.strictEqual(first.status, 'success');
    assert.strictEqual(first.document.purchasePriceSats, 50);

    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + '22'.repeat(32) },
      object: { items: [{ id: fileId, purchasePriceSats: 100, published: true }] }
    }, { name: '10.9.9.9:7777' });

    const raised = await hub._maybeRepublishHeldDocumentsFromMarket();
    assert.strictEqual(raised.length, 1);
    assert.strictEqual(raised[0].document.purchasePriceSats, 110);
    assert.strictEqual(raised[0].costBasisSats, 100);

    const missing = await hub._publishHeldDocumentAtPrice('', 10);
    assert.strictEqual(missing.status, 'error');
    const absent = await hub._publishHeldDocumentAtPrice('17'.repeat(32), 10);
    assert.strictEqual(absent.status, 'error');

    const idle = await makeHub({ accumulatePeerInventories: true, republishWithMarkup: false });
    const skipped = await idle._maybeRepublishHeldDocumentsFromMarket([fileId]);
    assert.deepStrictEqual(skipped, []);
    await hub.stop().catch(() => {});
    await idle.stop().catch(() => {});
  });

  it('GetDocument requires an id and decorate still strips cost basis when market is off', async function () {
    const hub = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    const empty = await hub._getDocumentPayload('');
    assert.strictEqual(empty.document, null);
    assert.match(String(empty.message), /id required/i);
    const decorated = hub._decorateDocumentWithMarketOffers({
      id: '18'.repeat(32),
      purchasePriceSats: 110,
      costBasisSats: 100
    });
    assert.strictEqual(decorated.purchasePriceSats, 110);
    assert.strictEqual(decorated.costBasisSats, undefined);
    await hub.stop().catch(() => {});
  });

  it('requests inventory over the GenericMessage fallback and respects cooldown', async function () {
    const hub = await makeHub();
    const sent = [];
    hub._sendGenericFabricEnvelopeToPeer = (addr, payload) => {
      sent.push({ addr, payload });
    };
    hub.agent.connections = { '10.0.0.8:7777': { _writeFabric: () => {} } };
    assert.strictEqual(hub._requestDocumentInventoryFromPeer('10.0.0.8:7777', 'refresh'), true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].payload.object.kind, 'documents');
    assert.strictEqual(hub._requestDocumentInventoryFromPeer('10.0.0.8:7777', 'refresh'), false);
    assert.strictEqual(hub._requestDocumentInventoryFromPeer('missing:1'), false);

    const off = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    off.agent.connections = { '10.0.0.8:7777': { _writeFabric: () => {} } };
    assert.strictEqual(off._requestDocumentInventoryFromPeer('10.0.0.8:7777'), false);

    const fallback = await makeHub();
    const envelopes = [];
    fallback._sendGenericFabricEnvelopeToPeer = (addr, payload) => envelopes.push({ addr, payload });
    fallback.agent.connections = { '10.4.4.4:7777': { _writeFabric: () => {} } };
    const out = fallback._refreshConnectedDocumentInventories();
    assert.strictEqual(out.requested, 1);
    assert.deepStrictEqual(out.peers, ['10.4.4.4:7777']);
    assert.strictEqual(envelopes[0].payload.object.reason, 'refresh');
    await hub.stop().catch(() => {});
    await off.stop().catch(() => {});
    await fallback.stop().catch(() => {});
  });

  it('copies a known-peer alias onto accumulated offers', async function () {
    const hub = await makeHub();
    const peerId = '02' + '33'.repeat(32);
    const fileId = '19'.repeat(32);
    hub.agent.knownPeers[peerId] = { alias: 'Ops' };
    const saved = hub._accumulatePeerDocumentInventory({
      actor: { id: peerId },
      object: { items: [{ id: fileId, name: 'ops.txt', purchasePriceSats: 8, published: true }] }
    }, { name: '10.3.3.3:7777' });
    assert.strictEqual(saved[0].peerAlias, 'Ops');
    await hub.stop().catch(() => {});
  });
});
