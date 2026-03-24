'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const { addHubWalletInputAndSign } = require('../functions/payjoinAcpBoost');
const { SIGHASH_ALL_ANYONECANPAY } = require('../functions/payjoinBrowserWallet');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

describe('payjoinAcpBoost.addHubWalletInputAndSign', () => {
  it('appends a Hub wallet UTXO and returns merged PSBT (mocked RPC)', async () => {
    const network = bitcoin.networks.regtest;
    const hubKp = ecpair.makeRandom({ network });
    const hubPay = bitcoin.payments.p2wpkh({ pubkey: hubKp.publicKey, network });
    const hubValue = 200000;

    const prevTx = new bitcoin.Transaction();
    prevTx.addInput(Buffer.alloc(32, 0xab), 0xffffffff, 0xffffffff);
    prevTx.addOutput(hubPay.output, hubValue);
    const hubTxid = prevTx.getId();
    const hubPrevHex = prevTx.toHex();

    const payerKp = ecpair.makeRandom({ network });
    const payerPay = bitcoin.payments.p2wpkh({ pubkey: payerKp.publicKey, network });
    const payerPrev = new bitcoin.Transaction();
    payerPrev.addInput(Buffer.alloc(32, 0xcd), 0xffffffff, 0xffffffff);
    payerPrev.addOutput(payerPay.output, 150000);
    const payerTxid = payerPrev.getId();
    const payerPrevHex = payerPrev.toHex();

    const destScript = bitcoin.payments.p2wpkh({
      pubkey: ecpair.makeRandom({ network }).publicKey,
      network
    }).output;

    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: payerTxid,
      index: 0,
      witnessUtxo: { script: payerPay.output, value: 150000 },
      sighashType: SIGHASH_ALL_ANYONECANPAY
    });
    psbt.addOutput({ script: destScript, value: 100000 });
    psbt.signInput(0, payerKp, [SIGHASH_ALL_ANYONECANPAY]);
    const payerPsbt = psbt.toBase64();

    const bitcoinSvc = {
      network: 'regtest',
      async _makeRPCRequest (method, args) {
        if (method === 'listunspent') {
          return [{ txid: hubTxid, vout: 0, spendable: true, safe: true, amount: hubValue / 1e8 }];
        }
        if (method === 'getrawtransaction') {
          const id = args[0];
          if (id === hubTxid) return hubPrevHex;
          if (id === payerTxid) return payerPrevHex;
          throw new Error('unknown txid');
        }
        if (method === 'walletprocesspsbt') {
          return { psbt: args[0], complete: false };
        }
        throw new Error(`unexpected RPC ${method}`);
      }
    };

    const out = await addHubWalletInputAndSign({
      psbtBase64: payerPsbt,
      bitcoin: bitcoinSvc,
      networkName: 'regtest'
    });

    assert.strictEqual(out.addedOutpoint, `${hubTxid}:0`);
    assert.strictEqual(out.addedValueSats, hubValue);
    assert.strictEqual(out.complete, false);

    const merged = bitcoin.Psbt.fromBase64(out.psbtBase64, { network });
    assert.strictEqual(merged.data.inputs.length, 2);
    assert.ok(merged.data.inputs[0].partialSig && merged.data.inputs[0].partialSig.length);
    assert.strictEqual(
      merged.data.inputs[0].partialSig[0].signature[merged.data.inputs[0].partialSig[0].signature.length - 1],
      SIGHASH_ALL_ANYONECANPAY
    );
  });
});
