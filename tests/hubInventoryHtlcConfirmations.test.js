'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

const BUYER = 'buyer:7777';
const TXID = 'ab'.repeat(32);

/**
 * A seller Hub with one quoted sale, a stubbed chain and a connected buyer.
 * `chain.confirmations` and `chain.tip` drive what the payment check sees.
 */
function sellerHub (minPaymentConfirmations, chain = {}) {
  const hub = Object.create(Hub.prototype);
  hub.settings = minPaymentConfirmations == null ? { documents: {} } : { documents: { minPaymentConfirmations } };
  hub.fs = { readFile: () => null, publish: async () => {} };
  hub._inventoryHtlcLoaded = true;
  hub._inventoryHtlcById = new Map([['s1', {
    settlementId: 's1',
    documentId: 'doc1',
    status: 'AWAITING_FUNDING',
    paymentAddress: 'bcrt1qpay',
    amountSats: 1000,
    quoteHeight: 100,
    refundLockHeight: 244,
    preimageHex: '11'.repeat(32),
    paymentHashHex: '22'.repeat(32),
    requesterConnection: BUYER
  }]]);
  hub.agent = { connections: { [BUYER]: {} } };
  const state = Object.assign({ tip: 101, confirmations: 0 }, chain);
  hub._getBitcoinService = () => ({ _makeRPCRequest: async (m) => (m === 'getblockcount' ? state.tip : null) });
  hub.scans = [];
  hub._l1PaymentVerificationDetail = async (_b, _t, _a, _s, opts) => {
    hub.scans.push(opts && opts.fromHeight);
    return state.gone
      ? { verified: false, confirmations: 0 }
      : { verified: true, confirmations: state.confirmations, hex: null };
  };
  hub._mergePersistedTxLabel = () => {};
  hub._claimDeliveredInventoryHtlcs = async () => [];
  hub.sent = [];
  hub.reveals = [];
  hub._sendDocumentToPeerAddress = async (addr, documentId) => {
    hub.sent.push({ addr, documentId });
    return { status: 'success' };
  };
  hub._sendHtlcKeyRevealToPeer = (addr, reveal) => { hub.reveals.push({ addr, reveal }); };
  return { hub, state };
}

describe('Inventory HTLC delivery waits for confirmations', function () {
  it('defaults to one confirmation and reads FABRIC_DOCUMENT_MIN_CONFIRMATIONS', function () {
    assert.strictEqual(sellerHub(null).hub._documentMinPaymentConfirmations(), 1);
    assert.strictEqual(sellerHub(0).hub._documentMinPaymentConfirmations(), 0);
    assert.strictEqual(sellerHub(3).hub._documentMinPaymentConfirmations(), 3);
    assert.strictEqual(sellerHub('nonsense').hub._documentMinPaymentConfirmations(), 1);
  });

  it('records an unconfirmed payment as pending and sends nothing', async function () {
    const { hub } = sellerHub(1);
    const r = await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    assert.strictEqual(r.status, 'pending', r.message);
    assert.strictEqual(r.confirmations, 0);
    assert.strictEqual(r.required, 1);
    assert.strictEqual(r.retryWithSameTxid, true);
    assert.strictEqual(r.settlementId, 's1', 'every result names its settlement');
    const unknown = await hub._confirmInventoryHtlcPayment({ settlementId: 'nope', txid: TXID });
    assert.strictEqual(unknown.status, 'error');
    assert.strictEqual(unknown.settlementId, 'nope');
    assert.strictEqual(hub.sent.length, 0);
    assert.strictEqual(hub.reveals.length, 0);
    const s = hub._inventoryHtlcById.get('s1');
    assert.strictEqual(s.status, 'FUNDED_PENDING_SEND');
    assert.strictEqual(s.fundedTxid, TXID);
  });

  it('delivers on the next block once the payment confirms', async function () {
    const { hub, state } = sellerHub(1);
    await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });

    // A block without the payment changes nothing.
    state.tip = 102;
    let results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results[0].status, 'pending');
    assert.strictEqual(hub.sent.length, 0);

    state.tip = 103;
    state.confirmations = 1;
    results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'success', results[0].message);
    assert.deepStrictEqual(hub.sent, [{ addr: BUYER, documentId: 'doc1' }]);
    assert.strictEqual(hub.reveals.length, 1);
    assert.strictEqual(hub._inventoryHtlcById.get('s1').status, 'COMPLETED');

    // Completed sales are not tried again.
    assert.deepStrictEqual(await hub._deliverConfirmedHtlcPayments(), []);
    assert.strictEqual(hub.sent.length, 1);
  });

  it('delivers a mempool payment at once when the minimum is 0', async function () {
    const { hub } = sellerHub(0);
    const r = await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    assert.strictEqual(r.status, 'success', r.message);
    assert.strictEqual(r.keyRevealed, true);
    assert.strictEqual(hub.sent.length, 1);
  });

  it('keeps a pending sale undelivered once it is inside the refund-lock margin', async function () {
    const { hub, state } = sellerHub(1);
    await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    state.confirmations = 1;
    state.tip = 244 - 3;
    const results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results[0].status, 'error');
    assert.match(results[0].message, /refund lock/);
    assert.strictEqual(hub.sent.length, 0);
    assert.strictEqual(hub._inventoryHtlcById.get('s1').status, 'FUNDED_PENDING_SEND');
  });

  it('waits for the buyer to reconnect, then delivers on a later block', async function () {
    const { hub, state } = sellerHub(1);
    await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    state.confirmations = 1;
    delete hub.agent.connections[BUYER];
    hub._resolvePeerAddress = () => null;
    let results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results[0].status, 'error');
    assert.strictEqual(results[0].funded, true);
    assert.strictEqual(hub.sent.length, 0);

    hub.agent.connections[BUYER] = {};
    results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results[0].status, 'success', results[0].message);
    assert.strictEqual(hub.sent.length, 1);
  });

  it('sends once when the block hook and a buyer confirm overlap', async function () {
    const { hub, state } = sellerHub(1);
    await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    state.confirmations = 1;
    const [a, b] = await Promise.all([
      hub._deliverConfirmedHtlcPayments(),
      hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID })
    ]);
    assert.strictEqual(hub.sent.length, 1);
    assert.ok([a[0].status, b.status].includes('success'));
  });

  it('looks for a recorded payment only in the blocks since the last check', async function () {
    const { hub, state } = sellerHub(1);
    await hub._confirmInventoryHtlcPayment({ settlementId: 's1', txid: TXID });
    assert.deepStrictEqual(hub.scans, [100], 'a new payment is looked for from the quote');
    // Replaced: the payment never turns up, and each block retries it.
    state.gone = true;
    state.tip = 140;
    let results = await hub._deliverConfirmedHtlcPayments();
    assert.strictEqual(results[0].status, 'error');
    state.tip = 141;
    results = await hub._deliverConfirmedHtlcPayments();
    assert.deepStrictEqual(hub.scans, [100, 100, 139], 'later checks start just below the last tip seen');
    assert.strictEqual(hub.sent.length, 0);
    assert.strictEqual(hub._inventoryHtlcById.get('s1').status, 'FUNDED_PENDING_SEND');
  });

  it('holds a direct purchase claim until its payment confirms', function () {
    const { hub } = sellerHub(1);
    const pending = hub._purchaseClaimPending({ verified: true, confirmations: 0 }, 'doc1', TXID);
    assert.strictEqual(pending.status, 'pending');
    assert.strictEqual(pending.required, 1);
    assert.strictEqual(hub._purchaseClaimPending({ verified: true, confirmations: 1 }, 'doc1', TXID), null);
    assert.strictEqual(sellerHub(0).hub._purchaseClaimPending({ verified: true, confirmations: 0 }, 'doc1', TXID), null);
  });
});
