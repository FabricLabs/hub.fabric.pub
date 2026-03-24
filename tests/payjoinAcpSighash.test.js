'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const { extractFabricPayjoinSessionIdFromPjUrl, SIGHASH_ALL_ANYONECANPAY } = require('../functions/payjoinBrowserWallet');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

describe('payjoin ACP helpers', () => {
  it('extractFabricPayjoinSessionIdFromPjUrl parses session id', () => {
    const sid = extractFabricPayjoinSessionIdFromPjUrl('http://127.0.0.1:8080/services/payjoin/sessions/abc123/proposals');
    assert.strictEqual(sid, 'abc123');
  });

  it('SIGHASH_ALL_ANYONECANPAY is 0x81', () => {
    assert.strictEqual(SIGHASH_ALL_ANYONECANPAY, 0x81);
  });

  it('P2WPKH PSBT partialSig encodes 0x81', () => {
    const network = bitcoin.networks.regtest;
    const kp = ecpair.makeRandom({ network });
    const pay = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network });
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: Buffer.alloc(32, 1),
      index: 0,
      witnessUtxo: { script: pay.output, value: 50000 },
      sighashType: SIGHASH_ALL_ANYONECANPAY
    });
    psbt.addOutput({ script: pay.output, value: 10000 });
    psbt.signInput(0, kp, [SIGHASH_ALL_ANYONECANPAY]);
    const psig = psbt.data.inputs[0].partialSig && psbt.data.inputs[0].partialSig[0];
    assert.ok(psig && psig.signature && psig.signature.length >= 1);
    const sighashByte = psig.signature[psig.signature.length - 1];
    assert.strictEqual(sighashByte, 0x81);
  });
});
