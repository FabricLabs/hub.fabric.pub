'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Hub = require('../services/hub');
const { HUB_START_PHASES } = require('../functions/hubLifecycle');
const documentContentKey = require('../functions/documentContentKey');

describe('Hub Document Market accumulate + republish', function () {
  this.timeout(120000);

  async function makeHub (market = {}) {
    const fsStore = new Map();
    const hub = new Hub({
      debug: false,
      persistent: false,
      skipStartPhases: HUB_START_PHASES.slice(),
      fs: { path: './stores/hub-test-docmarket-' + crypto.randomBytes(8).toString('hex') },
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

  async function holdBlob (hub, fileId, extra = {}) {
    await hub.fs.publish(`documents/${fileId}.json`, Object.assign({
      id: fileId,
      name: 'held.txt',
      mime: 'text/plain',
      size: 4,
      sha256: fileId,
      contentBase64: Buffer.from('held').toString('base64')
    }, extra));
    hub._state.documents = hub._state.documents || {};
    hub._state.documents[fileId] = {
      id: fileId,
      name: extra.name || 'held.txt',
      mime: extra.mime || 'text/plain',
      sha256: fileId,
      size: extra.size != null ? extra.size : 4
    };
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
    hub.agent.knownPeers[peerId] = { alias: 'Ops' };
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
    assert.strictEqual(saved[0].peerAlias, 'Ops');

    const self = hub._accumulatePeerDocumentInventory({
      actor: { id: 'hub-self-id' },
      object: { items: [{ id: fileId, purchasePriceSats: 1, published: true }] }
    }, { name: '127.0.0.1:1' });
    assert.deepStrictEqual(self, []);

    const snap = hub._documentMarketSnapshot();
    assert.strictEqual(snap.accumulatePeerInventories, true);
    assert.ok(snap.offerCount >= 1);
    await hub.stop().catch(() => {});
  });

  it('republishes a held blob at cost plus markup and keeps inventory local-only', async function () {
    const hub = await makeHub();
    const fileId = 'ee'.repeat(32);
    await holdBlob(hub, fileId);

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
    assert.strictEqual(local.costBasisSats, undefined);
    assert.strictEqual(local.contentBase64, undefined);

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

  it('raises an underpriced local listing and skips a scan of ids without blobs', async function () {
    const hub = await makeHub();
    const fileId = 'aa'.repeat(32);
    await holdBlob(hub, fileId);
    hub._ensureResourceCollections();
    hub._state.content.collections.documents[fileId] = {
      id: fileId,
      published: new Date().toISOString(),
      purchasePriceSats: 50
    };
    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + '11'.repeat(32) },
      object: { items: [{ id: fileId, purchasePriceSats: 100, published: true }] }
    }, { name: '10.0.0.4:7777' });
    const raised = await hub._maybeRepublishHeldDocumentsFromMarket();
    assert.ok(raised.some((row) => row.document && row.document.purchasePriceSats === 110));
    await hub.stop().catch(() => {});
  });

  it('GetDocument returns peer-only metadata without blobs or cost basis', async function () {
    const hub = await makeHub();
    const fileId = 'ab'.repeat(32);
    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + '99'.repeat(32) },
      object: {
        items: [{
          id: fileId,
          name: 'ghost.txt',
          mime: 'text/plain',
          purchasePriceSats: 10,
          published: true,
          contentBase64: 'AAAA',
          costBasisSats: 1
        }]
      }
    }, { name: '10.3.3.3:7777' });

    const missingId = await hub._getDocumentPayload('');
    assert.strictEqual(missingId.message, 'id required');
    assert.strictEqual(missingId.document, null);

    const got = await hub._getDocumentPayload({ id: fileId });
    assert.strictEqual(got.type, 'GetDocumentResult');
    assert.strictEqual(got.local, false);
    assert.ok(got.document);
    assert.strictEqual(got.document.local, false);
    assert.strictEqual(got.document.purchasePriceSats, 10);
    assert.strictEqual(got.document.contentBase64, undefined);
    assert.strictEqual(got.document.costBasisSats, undefined);
    assert.ok(Array.isArray(got.document.offers));
    assert.ok(got.document.offers.length >= 1);

    const absent = await hub._getDocumentPayload('00'.repeat(32));
    assert.strictEqual(absent.document, null);
    assert.match(String(absent.message), /not found/i);
    await hub.stop().catch(() => {});
  });

  it('GetDocument of a held file strips stuffed costBasisSats', async function () {
    const hub = await makeHub();
    const fileId = 'cc'.repeat(32);
    await holdBlob(hub, fileId, { costBasisSats: 99999, purchasePriceSats: 110 });
    hub._accumulatePeerDocumentInventory({
      actor: { id: '02' + '22'.repeat(32) },
      object: { items: [{ id: fileId, purchasePriceSats: 100, published: true }] }
    }, { name: '10.4.4.4:7777' });
    const got = await hub._getDocumentPayload(fileId);
    assert.ok(got.document);
    assert.strictEqual(got.document.costBasisSats, undefined);
    assert.ok(got.document.contentBase64);
    const decorated = hub._decorateDocumentWithMarketOffers({
      id: fileId,
      purchasePriceSats: 110,
      costBasisSats: 100,
      local: true
    });
    assert.strictEqual(decorated.costBasisSats, undefined);
    assert.strictEqual(decorated.bestPeerPriceSats, 100);
    await hub.stop().catch(() => {});
  });

  it('treats sealed documents as local blobs and broken JSON as missing', async function () {
    const hub = await makeHub();
    const sealedId = 'dd'.repeat(32);
    await hub.fs.publish(`documents/${sealedId}.json`, {
      id: sealedId,
      name: 'sealed.bin',
      mime: 'application/octet-stream',
      encryption: { scheme: documentContentKey.SCHEME }
    });
    assert.strictEqual(hub._hasLocalDocumentBlob(sealedId), true);

    const brokenId = 'ee'.repeat(32);
    await hub.fs.publish(`documents/${brokenId}.json`, '{not-json');
    assert.strictEqual(hub._hasLocalDocumentBlob(brokenId), false);

    const gotBroken = await hub._getDocumentPayload(brokenId);
    assert.strictEqual(gotBroken.document, null);
    assert.ok(gotBroken.message);
    await hub.stop().catch(() => {});
  });

  it('decorate without accumulate still omits private fields', async function () {
    const hub = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    const row = hub._decorateDocumentWithMarketOffers({
      id: 'aa'.repeat(32),
      purchasePriceSats: 110,
      costBasisSats: 100,
      local: true
    });
    assert.strictEqual(row.costBasisSats, undefined);
    assert.strictEqual(row.offers, undefined);
    await hub.stop().catch(() => {});
  });

  it('inventory refresh uses connected sockets then GenericMessage fallback with cooldown', async function () {
    const hub = await makeHub();
    const asked = [];
    hub.agent.connections['10.5.5.5:7777'] = { _writeFabric: () => {} };
    hub.agent.requestPeerInventory = (addr, opts) => {
      asked.push({ addr, opts });
      return true;
    };
    const viaPeer = hub._refreshConnectedDocumentInventories();
    assert.strictEqual(viaPeer.requested, 1);
    assert.deepStrictEqual(viaPeer.peers, ['10.5.5.5:7777']);
    assert.strictEqual(asked[0].opts.kind, 'documents');

    const hub2 = await makeHub();
    const envelopes = [];
    hub2.agent.connections['10.6.6.6:7777'] = { _writeFabric: () => {} };
    hub2._sendGenericFabricEnvelopeToPeer = (addr, payload) => {
      envelopes.push({ addr, payload });
    };
    const fallback = hub2._refreshConnectedDocumentInventories();
    assert.strictEqual(fallback.requested, 1);
    assert.strictEqual(envelopes[0].payload.type, 'FABRIC_DOCUMENT_OFFER');
    assert.strictEqual(hub2._requestDocumentInventoryFromPeer('10.6.6.6:7777', 'again'), false);
    assert.strictEqual(envelopes.length, 1, 'cooldown must skip a second request within 15s');

    const off = await makeHub({ accumulatePeerInventories: false, republishWithMarkup: false });
    assert.strictEqual(off._requestDocumentInventoryFromPeer('10.6.6.6:7777'), false);
    assert.strictEqual(off._refreshConnectedDocumentInventories().requested, 0);

    await hub.stop().catch(() => {});
    await hub2.stop().catch(() => {});
    await off.stop().catch(() => {});
  });
});
