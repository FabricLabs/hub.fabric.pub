'use strict';

const assert = require('assert');
const {
  compareDocumentsByHostOfferThenPurchasePrice,
  maxOpenHostOfferSatsForDocument,
  proposalMatchesDocument
} = require('../functions/sortDocumentsByHostOfferThenPrice');

describe('sortDocumentsByHostOfferThenPrice', function () {
  it('matches proposals by document id or sha256', function () {
    const doc = { id: 'actor-1', sha256: 'abc' };
    assert.strictEqual(proposalMatchesDocument({ documentId: 'actor-1', status: 'pending' }, doc), true);
    assert.strictEqual(proposalMatchesDocument({ documentId: 'abc', status: 'pending' }, doc), true);
    assert.strictEqual(proposalMatchesDocument({ documentId: 'other', document: { sha256: 'abc' }, status: 'pending' }, doc), true);
    assert.strictEqual(proposalMatchesDocument({ documentId: 'nope', status: 'pending' }, doc), false);
  });

  it('ignores bonded/rejected proposals for host-offer score', function () {
    const doc = { id: 'd1' };
    const proposals = {
      a: { id: 'a', documentId: 'd1', amountSats: 5000, status: 'bonded' },
      b: { id: 'b', documentId: 'd1', amountSats: 9000, status: 'pending' }
    };
    assert.strictEqual(maxOpenHostOfferSatsForDocument(doc, proposals), 9000);
  });

  it('sorts: offers before no-offer; higher offer first; then cheaper purchase; then newer', function () {
    const t0 = '2020-01-01T00:00:00.000Z';
    const t1 = '2021-01-01T00:00:00.000Z';
    const noOfferCheap = { id: 'a', purchasePriceSats: 100, created: t0 };
    const noOfferExpensive = { id: 'b', purchasePriceSats: 500, created: t1 };
    const offerLow = { id: 'c', purchasePriceSats: 1, created: t0 };
    const offerHigh = { id: 'd', purchasePriceSats: 999, created: t0 };
    const proposals = {
      p1: { id: 'p1', documentId: 'c', amountSats: 1000, status: 'pending' },
      p2: { id: 'p2', documentId: 'd', amountSats: 5000, status: 'pending' }
    };
    const sorted = [noOfferCheap, offerLow, noOfferExpensive, offerHigh].sort((a, b) =>
      compareDocumentsByHostOfferThenPurchasePrice(a, b, proposals)
    );
    assert.deepStrictEqual(sorted.map((d) => d.id), ['d', 'c', 'a', 'b']);

    const sameOfferA = { id: 'x', purchasePriceSats: 200, created: t0 };
    const sameOfferB = { id: 'y', purchasePriceSats: 50, created: t1 };
    const props2 = {
      px: { id: 'px', documentId: 'x', amountSats: 3000, status: 'accepted' },
      py: { id: 'py', documentId: 'y', amountSats: 3000, status: 'pending' }
    };
    const sorted2 = [sameOfferA, sameOfferB].sort((a, b) =>
      compareDocumentsByHostOfferThenPurchasePrice(a, b, props2)
    );
    assert.deepStrictEqual(sorted2.map((d) => d.id), ['y', 'x']);

    const noPriceNew = { id: 'n1', created: t1 };
    const noPriceOld = { id: 'n2', created: t0 };
    const sorted3 = [noPriceOld, noPriceNew].sort((a, b) =>
      compareDocumentsByHostOfferThenPurchasePrice(a, b, {})
    );
    assert.deepStrictEqual(sorted3.map((d) => d.id), ['n1', 'n2']);
  });
});
