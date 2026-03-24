'use strict';

const assert = require('assert');
const crypto = require('crypto');
const documentOfferEscrow = require('../functions/documentOfferEscrow');
const inventoryHtlc = require('../functions/inventoryHtlc');

describe('documentOfferEscrow', function () {
  it('buildDocumentOfferEscrow matches inventory HTLC address (deliverer=seller)', function () {
    const deliverer = Buffer.concat([Buffer.from([0x02]), crypto.randomBytes(32)]);
    const initiator = Buffer.concat([Buffer.from([0x03]), crypto.randomBytes(32)]);
    const preimage = crypto.randomBytes(32);
    const paymentHashHex = inventoryHtlc.hash256(preimage).toString('hex');
    const refundLockHeight = 900_000;
    const a = documentOfferEscrow.buildDocumentOfferEscrow({
      networkName: 'regtest',
      delivererPubkeyHex: deliverer.toString('hex'),
      initiatorRefundPubkeyHex: initiator.toString('hex'),
      paymentHashHex,
      refundLockHeight,
      amountSats: 50_000,
      label: 'test-offer'
    });
    const b = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: deliverer,
      buyerRefundPubkeyCompressed: initiator,
      paymentHash32: Buffer.from(paymentHashHex, 'hex'),
      refundLocktimeHeight: refundLockHeight
    });
    assert.strictEqual(a.paymentAddress, b.address);
    assert.strictEqual(a.claimScriptHex, b.claimScript.toString('hex'));
    assert.strictEqual(a.refundScriptHex, b.refundScript.toString('hex'));
    assert.ok(a.bitcoinUri && a.bitcoinUri.includes('amount='), 'BIP21 amount');
  });
});
