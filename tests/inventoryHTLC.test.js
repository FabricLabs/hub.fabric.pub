'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const inventoryHtlc = require('../functions/inventoryHtlc');
const publishedDocumentEnvelope = require('../functions/publishedDocumentEnvelope');

const ecpair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

describe('inventoryHtlc', function () {
  it('buildHtlcFundingHints produces BIP21 bitcoin: URI', function () {
    const h = inventoryHtlc.buildHtlcFundingHints({
      paymentAddress: 'bcrt1pv25g0waah5e7rhkdcrmnanexxsng93uew5xe8tzzpuq5ckkwzltsalzjxr',
      amountSats: 100_000,
      label: 'Test doc'
    });
    assert.strictEqual(h.amountBtc, '0.00100000');
    assert.ok(h.bitcoinUri.startsWith('bitcoin:bcrt1'), 'bitcoin: prefix');
    assert.ok(h.bitcoinUri.includes('amount=0.00100000'), 'amount param');
    assert.ok(h.bitcoinUri.includes('label='), 'label param');
  });

  it('HTLC payment hash matches CreatePurchaseInvoice contentHash (DocumentPublish envelope preimage)', function () {
    const docId = 'docfixture1';
    const parsed = {
      contentBase64: Buffer.from('hello fabric htlc', 'utf8').toString('base64'),
      name: 'fixture',
      mime: 'text/plain',
      size: 17,
      sha256: docId,
      id: docId
    };
    const env = publishedDocumentEnvelope.documentPublishEnvelopeBuffer(docId, parsed);
    const env2 = publishedDocumentEnvelope.documentPublishEnvelopeBuffer(docId, parsed);
    assert.ok(env.equals(env2), 'envelope bytes deterministic');
    const preimage = publishedDocumentEnvelope.inventoryHtlcPreimage32(docId, parsed);
    assert.strictEqual(preimage.toString('hex'), crypto.createHash('sha256').update(env).digest('hex'));
    const paymentHashHex = crypto.createHash('sha256').update(preimage).digest('hex');
    const purchaseContentHashHex = publishedDocumentEnvelope.purchaseContentHashHex(docId, parsed);
    assert.strictEqual(paymentHashHex, purchaseContentHashHex);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    assert.strictEqual(paymentHash32.toString('hex'), paymentHashHex);
  });

  it('builds a regtest P2TR address for script-path HTLC', function () {
    // Valid-looking compressed pubkeys (not necessarily on-curve for this smoke test — bitcoinjs may still accept; use simple pattern)
    const seller = Buffer.concat([Buffer.from([0x02]), crypto.randomBytes(32)]);
    const buyer = Buffer.concat([Buffer.from([0x03]), crypto.randomBytes(32)]);
    const h = crypto.randomBytes(32);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller,
      buyerRefundPubkeyCompressed: buyer,
      paymentHash32: h,
      refundLocktimeHeight: 1000
    });
    assert.ok(built.address && built.address.startsWith('bcrt1'), 'expect regtest bech32m');
    assert.strictEqual(built.paymentHashHex, h.toString('hex'));
  });

  it('prepareInventoryHtlcSellerClaimPsbt + sign extracts valid claim tx hex', function () {
    const seller = ecpair.makeRandom();
    const buyer = ecpair.makeRandom();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: 1_000_000
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 1), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 50_000);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: buyer.publicKey,
      network: bitcoin.networks.regtest
    }).address;
    const bundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      preimage32: preimage,
      destinationAddress: destAddr,
      feeSats: 1500
    });
    const { txHex, txid } = inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(bundle, seller.privateKey);
    assert.ok(/^[0-9a-f]{64}$/i.test(txid), 'txid hex');
    assert.ok(txHex.length > 100, 'serialized tx');
    const parsed = bitcoin.Transaction.fromHex(txHex);
    assert.strictEqual(parsed.ins.length, 1);
    assert.strictEqual(parsed.outs.length, 1);
  });

  it('prepareInventoryHtlcBuyerRefundPsbt + sign extracts valid refund tx hex', function () {
    const seller = ecpair.makeRandom();
    const buyer = ecpair.makeRandom();
    const preimage = crypto.randomBytes(32);
    const paymentHash32 = inventoryHtlc.hash256(preimage);
    const lockHeight = 500_000;
    const built = inventoryHtlc.buildInventoryHtlcP2tr({
      networkName: 'regtest',
      sellerPubkeyCompressed: seller.publicKey,
      buyerRefundPubkeyCompressed: buyer.publicKey,
      paymentHash32,
      refundLocktimeHeight: lockHeight
    });
    const fundingTx = new bitcoin.Transaction();
    fundingTx.version = 2;
    fundingTx.addInput(Buffer.alloc(32, 2), 0, 0xffffffff);
    fundingTx.addOutput(built.output, 80_000);
    const destAddr = bitcoin.payments.p2wpkh({
      pubkey: seller.publicKey,
      network: bitcoin.networks.regtest
    }).address;
    const bundle = inventoryHtlc.prepareInventoryHtlcBuyerRefundPsbt({
      networkName: 'regtest',
      fundedTxHex: fundingTx.toHex(),
      paymentAddress: built.address,
      claimScript: built.claimScript,
      refundScript: built.refundScript,
      refundLocktimeHeight: lockHeight,
      destinationAddress: destAddr,
      feeSats: 2000
    });
    const { txHex, txid } = inventoryHtlc.signAndExtractInventoryHtlcBuyerRefund(bundle, buyer.privateKey);
    assert.ok(/^[0-9a-f]{64}$/i.test(txid), 'txid hex');
    const parsed = bitcoin.Transaction.fromHex(txHex);
    assert.strictEqual(parsed.locktime, lockHeight);
    assert.strictEqual(parsed.ins[0].sequence, 0xfffffffe);
    assert.strictEqual(parsed.ins.length, 1);
    assert.strictEqual(parsed.outs.length, 1);
  });
});
