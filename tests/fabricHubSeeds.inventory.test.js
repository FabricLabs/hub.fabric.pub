'use strict';

const assert = require('assert');
const {
  isFabricHubOptionsPayload,
  fabricHubOptionsFeatures
} = require('../functions/fabricHttpOptions');
const {
  collectInventoryDocuments,
  mergeInventoryDocumentsIntoMap
} = require('../functions/documentInventoryList');

describe('fabricHttpOptions features', function () {
  it('marks Hub OPTIONS with peering as webrtc/rpc/peering', function () {
    const j = {
      '@type': 'ApplicationResourceContract',
      name: 'hub.fabric.pub',
      resources: {
        Service: { routes: { list: '/services', rpc: '/services/rpc' } }
      },
      services: { peering: { endpointBasePath: '/services/peering' } },
      methods: ['RegisterWebRTCPeer', 'ListWebRTCPeers', 'ListDocuments']
    };
    assert.strictEqual(isFabricHubOptionsPayload(j), true);
    const f = fabricHubOptionsFeatures(j);
    assert.strictEqual(f.webrtc, true);
    assert.strictEqual(f.rpc, true);
    assert.strictEqual(f.peering, true);
    assert.strictEqual(f.documents, true);
  });
});

describe('documentInventoryList', function () {
  it('flattens peer inventories and de-dupes by id', function () {
    const rows = collectInventoryDocuments({
      a: {
        id: 'peer-a',
        inventory: {
          documents: [
            { id: 'doc-1', name: 'one.txt', size: 4 },
            { id: 'doc-2', name: 'two.txt', size: 8 }
          ]
        }
      },
      b: {
        id: 'peer-b',
        inventory: {
          documents: [
            { id: 'doc-1', name: 'one.txt', size: 4, purchasePriceSats: 25 }
          ]
        }
      }
    });
    assert.strictEqual(rows.length, 2);
    const one = rows.find((d) => d.id === 'doc-1');
    assert.ok(one.isInventory);
    assert.ok(one.inventoryPeerIds.indexOf('peer-a') >= 0);
    assert.ok(one.inventoryPeerIds.indexOf('peer-b') >= 0);
  });

  it('merges inventories under existing local rows', function () {
    const map = mergeInventoryDocumentsIntoMap(
      { 'doc-1': { id: 'doc-1', name: 'local', isLocal: true, contentBase64: 'Zg==' } },
      [{ id: 'doc-1', name: 'remote', isInventory: true, inventoryPeerId: 'p1', inventoryPeerIds: ['p1'] }]
    );
    assert.strictEqual(map['doc-1'].isLocal, true);
    assert.strictEqual(map['doc-1'].contentBase64, 'Zg==');
    assert.strictEqual(map['doc-1'].isInventory, true);
  });
});
