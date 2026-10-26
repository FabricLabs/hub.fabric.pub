'use strict';

// BIP78 receiver contribution (replaces the old ANYONECANPAY "Hub boost",
// which added a Hub coin and sent all of it to the miner).

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const BIP32Factory = require('bip32').default;
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const {
  contributeReceiverInput,
  parseBip78Params,
  chooseContribution,
  scriptTypeOf
} = require('../functions/payjoinReceiverContribution');
const {
  buildOriginalSignedPayjoinPsbt,
  checkPayjoinProposal,
  signOurPayjoinInputs,
  finalizeAndExtractHex,
  payjoinEndpointWithParams
} = require('../functions/payjoinBrowserWallet');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);
const network = bitcoin.networks.regtest;

function fundingTx (script, value) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0, 0xffffffff);
  tx.addOutput(script, BigInt(value));
  return tx;
}

function valueOfInput (psbt, i) {
  return Number(psbt.data.inputs[i].witnessUtxo.value);
}

/** A sender wallet (one P2WPKH coin), a receiver address, and a mocked Hub wallet. */
function fixture (opts = {}) {
  const root = bip32.fromSeed(crypto.randomBytes(32), network);
  const senderKey = root.derive(0).derive(0);
  const senderPay = bitcoin.payments.p2wpkh({ pubkey: senderKey.publicKey, network });
  const senderPrev = fundingTx(senderPay.output, opts.senderValue || 300000);
  const prevHex = { [senderPrev.getId()]: senderPrev.toHex() };

  const receiverAddress = bitcoin.payments.p2wpkh({ pubkey: ecpair.makeRandom({ network }).publicKey, network }).address;
  const changeAddress = bitcoin.payments.p2wpkh({ pubkey: root.derive(1).derive(0).publicKey, network }).address;

  const hubKp = ecpair.makeRandom({ network });
  const hubPay = bitcoin.payments.p2wpkh({ pubkey: hubKp.publicKey, network });
  const hubCoins = (opts.hubValues || [90000, 160000, 400000]).map((value) => ({ tx: fundingTx(hubPay.output, value), value }));

  const calls = [];
  const svc = {
    network: 'regtest',
    async _makeRPCRequest (method, params) {
      calls.push({ method, params });
      if (method === 'testmempoolaccept') return [{ allowed: opts.mempoolAllowed !== false, 'reject-reason': 'bad-txns' }];
      if (method === 'listunspent') {
        return hubCoins.map((c) => ({
          txid: c.tx.getId(),
          vout: 0,
          amount: c.value / 1e8,
          scriptPubKey: Buffer.from(hubPay.output).toString('hex'),
          spendable: true,
          solvable: true,
          safe: true
        }));
      }
      if (method === 'walletprocesspsbt') {
        assert.strictEqual(params[2], 'ALL');
        const psbt = bitcoin.Psbt.fromBase64(params[0], { network });
        psbt.txInputs.forEach((txInput, i) => {
          const txid = Buffer.from(txInput.hash).reverse().toString('hex');
          if (hubCoins.some((c) => c.tx.getId() === txid)) {
            psbt.signInput(i, hubKp, [bitcoin.Transaction.SIGHASH_ALL]);
            psbt.finalizeInput(i);
          }
        });
        return { psbt: psbt.toBase64(), complete: false };
      }
      if (method === 'lockunspent') return true;
      throw new Error(`unexpected RPC ${method}`);
    }
  };

  async function original (sendAmountSats = 100000) {
    return buildOriginalSignedPayjoinPsbt({
      xprv: root.toBase58(),
      xpub: root.neutered().toBase58(),
      networkName: 'regtest',
      utxos: [{ txid: senderPrev.getId(), vout: 0, amountSats: opts.senderValue || 300000, desc: 'wpkh([00000000]tpub/0/0)#x' }],
      payAddress: receiverAddress,
      sendAmountSats,
      changeAddress,
      getPrevTxHex: async (txid) => prevHex[txid],
      feeSatPerVbyte: 2
    });
  }

  return { root, svc, calls, receiverAddress, changeAddress, hubCoins, original };
}

describe('payjoinReceiverContribution (BIP78)', function () {
  it('adds one Hub coin, raises the receiver output, and keeps the fee rate', async function () {
    const f = fixture();
    const built = await f.original();
    const before = bitcoin.Psbt.fromBase64(built.psbtBase64, { network });
    const receiverScript = bitcoin.address.toOutputScript(f.receiverAddress, network);
    const receiverBefore = Number(before.txOutputs.find((o) => Buffer.from(o.script).equals(Buffer.from(receiverScript))).value);

    const out = await contributeReceiverInput({
      psbtBase64: built.psbtBase64,
      bitcoin: f.svc,
      receiverAddress: f.receiverAddress,
      networkName: 'regtest',
      params: parseBip78Params({})
    });

    // the coin closest to the payment (100k) is the 90k one
    assert.strictEqual(out.contributedValueSats, 90000);
    assert.strictEqual(out.receiverOutputBeforeSats, receiverBefore);
    assert.ok(out.receiverOutputAfterSats > receiverBefore, 'receiver output must increase');
    assert.strictEqual(out.receiverOutputAfterSats, receiverBefore + 90000 - out.additionalFeeSats);
    assert.strictEqual(out.senderFeeContributionSats, 0);
    assert.ok(out.additionalFeeSats > 0 && out.additionalFeeSats < 500, 'only the extra input\'s fee');
    assert.strictEqual(out.proposalFeeSats, out.originalFeeSats + out.additionalFeeSats);
    assert.ok(f.calls.some((c) => c.method === 'testmempoolaccept'));
    assert.ok(f.calls.some((c) => c.method === 'lockunspent'));

    const proposal = bitcoin.Psbt.fromBase64(out.psbtBase64, { network });
    assert.strictEqual(proposal.txInputs.length, 2);
    assert.strictEqual(proposal.txOutputs.length, before.txOutputs.length);
    const sender = proposal.data.inputs.find((_, i) => i !== out.inputIndex);
    assert.ok(!sender.partialSig && !sender.finalScriptWitness, 'sender signatures are cleared');
    assert.ok(proposal.data.inputs[out.inputIndex].finalScriptWitness, 'Hub input is signed');

    // the fee the network sees did not absorb the Hub coin
    const totalIn = proposal.data.inputs.reduce((t, _, i) => t + valueOfInput(proposal, i), 0);
    const totalOut = proposal.txOutputs.reduce((t, o) => t + Number(o.value), 0);
    assert.strictEqual(totalIn - totalOut, out.proposalFeeSats);
    assert.ok(totalIn - totalOut < 90000);
  });

  it('round-trips through the sender: check, re-sign with SIGHASH_ALL, finalize', async function () {
    const f = fixture();
    const built = await f.original();
    const out = await contributeReceiverInput({
      psbtBase64: built.psbtBase64,
      bitcoin: f.svc,
      receiverAddress: f.receiverAddress,
      networkName: 'regtest',
      params: parseBip78Params({
        additionalfeeoutputindex: String(built.params.additionalFeeOutputIndex),
        maxadditionalfeecontribution: String(built.params.maxAdditionalFeeContribution)
      }),
      random: () => 0
    });
    assert.strictEqual(out.inputIndex, 0, 'inserted where the random draw says');
    assert.ok(out.senderFeeContributionSats > 0, 'sender change pays the extra input fee it allowed');
    assert.ok(out.senderFeeContributionSats <= built.params.maxAdditionalFeeContribution);

    const checked = checkPayjoinProposal(built.psbtBase64, out.psbtBase64, {
      networkName: 'regtest',
      payAddress: f.receiverAddress,
      params: built.params
    });
    assert.strictEqual(checked.receiverInputs, 1);
    assert.strictEqual(checked.senderFeeContributionSats, out.senderFeeContributionSats);

    const signed = signOurPayjoinInputs(out.psbtBase64, built.ourInputs, f.root.toBase58(), f.root.neutered().toBase58(), 'regtest');
    const tx = bitcoin.Transaction.fromHex(finalizeAndExtractHex(signed, 'regtest'));
    assert.strictEqual(tx.ins.length, 2);
    tx.ins.forEach((input) => {
      const sig = input.witness[0];
      assert.strictEqual(sig[sig.length - 1], bitcoin.Transaction.SIGHASH_ALL);
    });
  });

  it('sender check catches a proposal that lowers the payment or takes extra fee', async function () {
    const f = fixture();
    const built = await f.original();
    const out = await contributeReceiverInput({ psbtBase64: built.psbtBase64, bitcoin: f.svc, receiverAddress: f.receiverAddress, networkName: 'regtest' });
    const tampered = bitcoin.Psbt.fromBase64(out.psbtBase64, { network });
    const changeScript = Buffer.from(bitcoin.address.toOutputScript(f.changeAddress, network));
    tampered.data.globalMap.unsignedTx.tx.outs.forEach((o) => {
      if (Buffer.from(o.script).equals(changeScript)) o.value -= 1000n;
    });
    assert.throws(() => checkPayjoinProposal(built.psbtBase64, tampered.toBase64(), {
      networkName: 'regtest', payAddress: f.receiverAddress, params: {}
    }), /took from our output|more fee/);
  });

  it('refuses an original that pays no fee', async function () {
    const f = fixture();
    const kp = ecpair.makeRandom({ network });
    const pay = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network });
    const prev = fundingTx(pay.output, 100000);
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({ hash: prev.getId(), index: 0, witnessUtxo: { script: pay.output, value: 100000n } });
    psbt.addOutput({ address: f.receiverAddress, value: 100000n });
    psbt.signInput(0, kp);
    psbt.finalizeAllInputs();
    await assert.rejects(contributeReceiverInput({
      psbtBase64: psbt.toBase64(), bitcoin: f.svc, receiverAddress: f.receiverAddress, networkName: 'regtest'
    }), (err) => err.code === 'original-psbt-rejected' && /no fee/.test(err.message));
    assert.ok(!f.calls.some((c) => c.method === 'listunspent'), 'no Hub coin revealed');
  });

  it('refuses unsigned originals, ones not paying the session, and ones the mempool rejects', async function () {
    const f = fixture();
    const built = await f.original();
    const unsigned = bitcoin.Psbt.fromBase64(built.psbtBase64, { network });
    delete unsigned.data.inputs[0].finalScriptWitness;
    await assert.rejects(contributeReceiverInput({
      psbtBase64: unsigned.toBase64(), bitcoin: f.svc, receiverAddress: f.receiverAddress, networkName: 'regtest'
    }), /not signed/);

    const other = bitcoin.payments.p2wpkh({ pubkey: ecpair.makeRandom({ network }).publicKey, network }).address;
    await assert.rejects(contributeReceiverInput({
      psbtBase64: built.psbtBase64, bitcoin: f.svc, receiverAddress: other, networkName: 'regtest'
    }), /session address/);

    const g = fixture({ mempoolAllowed: false });
    const b2 = await g.original();
    await assert.rejects(contributeReceiverInput({
      psbtBase64: b2.psbtBase64, bitcoin: g.svc, receiverAddress: g.receiverAddress, networkName: 'regtest'
    }), /would not be accepted/);
  });

  it('chooses a coin of the sender\'s script type, nearest the payment, never one already in the tx', function () {
    const p2wpkh = '0014' + '11'.repeat(20);
    const p2tr = '5120' + '22'.repeat(32);
    const rows = [
      { txid: 'aa'.repeat(32), vout: 0, amount: 0.001, scriptPubKey: p2tr },
      { txid: 'bb'.repeat(32), vout: 0, amount: 0.0011, scriptPubKey: p2wpkh },
      { txid: 'cc'.repeat(32), vout: 1, amount: 0.002, scriptPubKey: p2wpkh },
      { txid: 'dd'.repeat(32), vout: 0, amount: 0.0001, scriptPubKey: p2wpkh, spendable: false }
    ];
    assert.strictEqual(chooseContribution(rows, { paymentSats: 100000, senderType: 'p2wpkh' }).txid, 'bb'.repeat(32));
    assert.strictEqual(chooseContribution(rows, { paymentSats: 100000, senderType: 'p2tr' }).txid, 'aa'.repeat(32));
    assert.strictEqual(chooseContribution(rows, {
      paymentSats: 100000, senderType: 'p2wpkh', exclude: new Set([`${'bb'.repeat(32)}:0`])
    }).txid, 'cc'.repeat(32));
    assert.strictEqual(scriptTypeOf(Buffer.from(p2tr, 'hex')), 'p2tr');
  });

  it('parses BIP78 query parameters and rejects other versions', function () {
    const p = parseBip78Params({ v: '1', additionalfeeoutputindex: '1', maxadditionalfeecontribution: '136', minfeerate: '2', disableoutputsubstitution: 'true' });
    assert.deepStrictEqual(p, { version: 1, additionalFeeOutputIndex: 1, maxAdditionalFeeContribution: 136, minFeeRate: 2, disableOutputSubstitution: true });
    assert.throws(() => parseBip78Params({ v: '2' }), /unsupported BIP78 version/);
    assert.strictEqual(
      payjoinEndpointWithParams('https://hub.test/s/1/proposals', { additionalFeeOutputIndex: 1, maxAdditionalFeeContribution: 136 }),
      'https://hub.test/s/1/proposals?v=1&additionalfeeoutputindex=1&maxadditionalfeecontribution=136'
    );
  });
});
