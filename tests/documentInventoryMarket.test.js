'use strict';

const assert = require('assert');
const market = require('../functions/documentInventoryMarket');

describe('documentInventoryMarket', function () {
  it('is off by default and republish implies accumulate', function () {
    const off = market.normalizeMarketPolicy({}, {});
    assert.strictEqual(off.accumulatePeerInventories, false);
    assert.strictEqual(off.republishWithMarkup, false);
    assert.strictEqual(off.markupBps, 1000);

    const on = market.normalizeMarketPolicy({
      documents: { market: { republishWithMarkup: true, markupBps: 250, markupSats: 7 } }
    }, {});
    assert.strictEqual(on.accumulatePeerInventories, true);
    assert.strictEqual(on.republishWithMarkup, true);
    assert.strictEqual(on.markupBps, 250);
    assert.strictEqual(on.markupSats, 7);
  });

  it('computes markup list price from bps plus flat sats', function () {
    assert.strictEqual(market.markupListPrice(100, { markupBps: 1000, markupSats: 0 }), 110);
    assert.strictEqual(market.markupListPrice(0, { markupBps: 1000, markupSats: 25 }), 25);
    assert.strictEqual(market.markupListPrice(1, { markupBps: 1000, markupSats: 0 }), 2);
    assert.strictEqual(market.markupListPrice(50, { markupBps: 0, markupSats: 0, minPriceSats: 80 }), 80);
  });

  it('replaces a peer snapshot and sorts cheapest first', function () {
    const map = {};
    const peerA = { peerPubkey: '02' + 'aa'.repeat(32), peerAlias: 'Wing' };
    const peerB = { peerPubkey: '02' + 'bb'.repeat(32), peerAlias: 'Ops' };
    const fileId = 'ab'.repeat(32);
    market.replacePeerOffers(map, peerA, [{
      id: fileId,
      name: 'brief.txt',
      mime: 'text/plain',
      purchasePriceSats: 25,
      published: true,
      size: 12
    }]);
    market.replacePeerOffers(map, peerB, [{
      id: fileId,
      name: 'brief.txt',
      mime: 'text/plain',
      rateSats: 10,
      published: true,
      size: 12
    }]);
    market.replacePeerOffers(map, peerA, []);
    const offers = market.offersForDocument(map, fileId);
    assert.strictEqual(offers.length, 1);
    assert.strictEqual(offers[0].peerAlias, 'Ops');
    assert.strictEqual(offers[0].purchasePriceSats, 10);

    const catalog = market.mergeCatalog([], market.listOffers(map));
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].local, false);
    assert.strictEqual(catalog[0].source, 'peer');
    assert.strictEqual(catalog[0].purchasePriceSats, 10);
  });

  it('decorates a local catalog row with cheapest remote without dropping the local listing', function () {
    const fileId = 'cd'.repeat(32);
    const map = {};
    market.replacePeerOffers(map, { peerPubkey: '02' + 'cc'.repeat(32), peerAlias: 'Relay' }, [{
      id: fileId,
      name: 'block.json',
      purchasePriceSats: 500,
      published: true
    }]);
    const merged = market.mergeCatalog([{
      id: fileId,
      name: 'block.json',
      purchasePriceSats: 1000,
      published: true
    }], market.listOffers(map), { includeRemoteOnly: true });
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].source, 'local');
    assert.strictEqual(merged[0].bestPeerPriceSats, 500);
    assert.ok(merged[0].offerCount >= 2);
  });

  it('republishes unpublished local files at cost plus markup', function () {
    const d = market.republishDecision({
      hasLocalFile: true,
      published: false,
      remoteOffers: [{ purchasePriceSats: 100, local: false }],
      policy: { republishWithMarkup: true, markupBps: 1000, markupSats: 5 }
    });
    assert.strictEqual(d.action, 'publish');
    assert.strictEqual(d.costBasisSats, 100);
    assert.strictEqual(d.purchasePriceSats, 115);
  });

  it('raises an underpriced listing and never lowers an operator price', function () {
    const raise = market.republishDecision({
      hasLocalFile: true,
      published: true,
      publishedPriceSats: 50,
      remoteOffers: [{ purchasePriceSats: 100 }],
      policy: { republishWithMarkup: true, markupBps: 1000, markupSats: 0 }
    });
    assert.strictEqual(raise.action, 'raise');
    assert.strictEqual(raise.purchasePriceSats, 110);

    const keep = market.republishDecision({
      hasLocalFile: true,
      published: true,
      publishedPriceSats: 5000,
      remoteOffers: [{ purchasePriceSats: 100 }],
      policy: { republishWithMarkup: true, markupBps: 1000, markupSats: 0 }
    });
    assert.strictEqual(keep.action, 'skip');
    assert.strictEqual(keep.reason, 'already-at-or-above-markup');

    const lower = market.republishDecision({
      hasLocalFile: true,
      published: true,
      publishedPriceSats: 5000,
      remoteOffers: [{ purchasePriceSats: 100 }],
      policy: {
        republishWithMarkup: true,
        markupBps: 1000,
        markupSats: 0,
        neverLowerExistingPrice: false
      }
    });
    assert.strictEqual(lower.action, 'raise');
    assert.strictEqual(lower.purchasePriceSats, 110);
  });

  it('does not invent a listing without a local blob or on free published docs', function () {
    const noFile = market.republishDecision({
      hasLocalFile: false,
      remoteOffers: [{ purchasePriceSats: 10 }],
      policy: { republishWithMarkup: true, markupBps: 1000 }
    });
    assert.strictEqual(noFile.action, 'skip');
    assert.strictEqual(noFile.reason, 'no-local-file');

    const free = market.republishDecision({
      hasLocalFile: true,
      published: true,
      publishedPriceSats: 0,
      remoteOffers: [{ purchasePriceSats: 10 }],
      policy: { republishWithMarkup: true, markupBps: 1000 }
    });
    assert.strictEqual(free.action, 'skip');
    assert.strictEqual(free.reason, 'unpriced-published');
  });

  it('requestConnectedInventories calls requestPeerInventory per live socket', function () {
    const asked = [];
    const peer = {
      connections: {
        '127.0.0.1:9': { _writeFabric: () => {} },
        dead: {}
      },
      requestPeerInventory (addr, opts) {
        asked.push({ addr, opts });
        return true;
      }
    };
    const out = market.requestConnectedInventories(peer);
    assert.strictEqual(out.requested, 1);
    assert.deepStrictEqual(out.peers, ['127.0.0.1:9']);
    assert.strictEqual(asked[0].opts.kind, 'documents');
  });

  it('reads policy from env when settings omit market flags', function () {
    const fromEnv = market.normalizeMarketPolicy({}, {
      FABRIC_DOCUMENT_MARKET_ACCUMULATE: '1',
      FABRIC_DOCUMENT_MARKET_MARKUP_BPS: '2500',
      FABRIC_DOCUMENT_MARKET_MARKUP_SATS: '3',
      FABRIC_DOCUMENT_MARKET_MIN_PRICE_SATS: '40'
    });
    assert.strictEqual(fromEnv.accumulatePeerInventories, true);
    assert.strictEqual(fromEnv.republishWithMarkup, false);
    assert.strictEqual(fromEnv.markupBps, 2500);
    assert.strictEqual(fromEnv.markupSats, 3);
    assert.strictEqual(fromEnv.minPriceSats, 40);
  });

  it('parses inventory items from GenericMessage and FABRIC offer envelopes', function () {
    const id = 'ef'.repeat(32);
    const fromObject = market.itemsFromInventoryMessage({
      object: { kind: 'documents', items: [{ id, purchasePriceSats: 9, name: 'a.txt' }] }
    });
    assert.strictEqual(fromObject.length, 1);
    assert.strictEqual(fromObject[0].id, id);

    const fromDocuments = market.itemsFromInventoryMessage({
      documents: [{ id, rateSats: 4 }]
    });
    assert.strictEqual(fromDocuments[0].rateSats, 4);

    assert.deepStrictEqual(market.itemsFromInventoryMessage(null), []);
  });

  it('omits remote-only rows when includeRemoteOnly is false', function () {
    const map = {};
    const fileId = '11'.repeat(32);
    market.replacePeerOffers(map, { peerPubkey: '02' + 'dd'.repeat(32) }, [{
      id: fileId,
      name: 'only-remote.txt',
      purchasePriceSats: 8,
      published: true
    }]);
    const hidden = market.mergeCatalog([], market.listOffers(map), { includeRemoteOnly: false });
    assert.strictEqual(hidden.length, 0);
  });

  it('formatPrice and peerLabel cover free, unset, and truncated pubkeys', function () {
    assert.strictEqual(market.formatPrice({ purchasePriceSats: 0 }), 'free');
    assert.strictEqual(market.formatPrice({}), 'unset');
    assert.ok(market.formatPrice({ purchasePriceSats: 1000 }).includes('1'));
    const pk = '02' + 'ab'.repeat(32);
    const label = market.peerLabel({ peerPubkey: pk });
    assert.ok(label.includes('…') || label.includes('\u2026'));
    assert.strictEqual(market.peerLabel({ local: true, peerAlias: 'me' }), 'me');
  });

  it('skips republish when the feature is off or no remote offers exist', function () {
    assert.strictEqual(market.republishDecision({
      hasLocalFile: true,
      remoteOffers: [{ purchasePriceSats: 10 }],
      policy: { republishWithMarkup: false }
    }).reason, 'disabled');
    assert.strictEqual(market.republishDecision({
      hasLocalFile: true,
      remoteOffers: [],
      policy: { republishWithMarkup: true, markupBps: 1000 }
    }).reason, 'no-remote-offers');
  });
});
