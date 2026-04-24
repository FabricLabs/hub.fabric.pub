'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const cf = require('../functions/crowdfundingTaproot');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

function trim64 (buf) {
  if (!Buffer.isBuffer(buf)) return buf;
  return buf.length >= 64 ? buf.subarray(0, 64) : buf;
}

function sortTapSigsByPositionDesc (leafScript, tapScriptSig, leafHash) {
  const lh = leafHash;
  const sigs = (tapScriptSig || []).filter((t) => t.leafHash.equals(lh));
  return sigs
    .map((tss) => {
      const fake33 = Buffer.concat([Buffer.from([0x02]), tss.pubkey]);
      const positionInScript = psbtutils.pubkeyPositionInScript(fake33, leafScript);
      return { tss, positionInScript };
    })
    .sort((a, b) => b.positionInScript - a.positionInScript)
    .map((x) => trim64(x.tss.signature));
}

function sortTapSigsByPubkeyAsc (tapScriptSig, leafHash) {
  const sigs = (tapScriptSig || []).filter((t) => t.leafHash.equals(leafHash));
  return sigs
    .slice()
    .sort((a, b) => a.pubkey.compare(b.pubkey))
    .map((t) => trim64(t.signature));
}

describe('crowdfundingTaproot', function () {
  this.timeout(10000);
  it('buildCrowdfundP2tr produces stable bcrt1 address for regtest', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const a = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 100000,
      minContributionSats: 1000,
      refundLocktimeHeight: 500000
    });
    assert.ok(a.address.startsWith('bcrt1p'), 'regtest taproot bech32m');
    assert.ok(a.payoutScript.length > 10);
    assert.ok(a.refundScript.length > 10);
    assert.strictEqual(a.goalSats, 100000);
    assert.strictEqual(a.minContributionSats, 1000);
  });

  it('prepareCrowdfundPayoutPsbt requires sum inputs >= goal', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 100000,
      minContributionSats: 500,
      refundLocktimeHeight: 999999
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 2), 0, 0xffffffff);
    tx.addOutput(built.output, 50000);
    assert.throws(() => cf.prepareCrowdfundPayoutPsbt({
      networkName: 'regtest',
      inputs: [{ txHex: tx.toHex(), vout: 0 }],
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      destinationAddress: built.address,
      feeSats: 1000,
      goalSats: 100000
    }), /below campaign goal/);
  });

  it('payout PSBT signs with arbiter + beneficiary and extracts', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 50000,
      minContributionSats: 100,
      refundLocktimeHeight: 888888
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 3), 0, 0xffffffff);
    tx.addOutput(built.output, 60000);
    const { psbt } = cf.prepareCrowdfundPayoutPsbt({
      networkName: 'regtest',
      inputs: [{ txHex: tx.toHex(), vout: 0 }],
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      destinationAddress: built.address,
      feeSats: 2000,
      goalSats: 50000
    });
    cf.signAllInputsWithKey(psbt, arb.privateKey);
    cf.signAllInputsWithKey(psbt, ben.privateKey);
    cf.finalizeCrowdfundPayoutPsbt(psbt);
    const { txHex, txid } = cf.extractPsbtTransaction(psbt);
    assert.ok(txid.length === 64);
    assert.ok(txHex.length > 100);
  });

  it('payout witness stack orders signatures by script pubkey position (desc), not lexicographic pubkey', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 50000,
      minContributionSats: 100,
      refundLocktimeHeight: 888888
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 3), 0, 0xffffffff);
    tx.addOutput(built.output, 60000);
    const { psbt } = cf.prepareCrowdfundPayoutPsbt({
      networkName: 'regtest',
      inputs: [{ txHex: tx.toHex(), vout: 0 }],
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      destinationAddress: built.address,
      feeSats: 2000,
      goalSats: 50000
    });
    cf.signAllInputsWithKey(psbt, arb.privateKey);
    cf.signAllInputsWithKey(psbt, ben.privateKey);
    const leaf = (psbt.data.inputs[0].tapLeafScript || [])[0];
    const lh = bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
    const tss = psbt.data.inputs[0].tapScriptSig || [];
    const byPos = sortTapSigsByPositionDesc(leaf.script, tss, lh);
    const byPub = sortTapSigsByPubkeyAsc(tss, lh);
    if (byPos[0].equals(byPub[0]) && byPos[1].equals(byPub[1])) {
      assert.fail('expected k0/k1 script order to differ from lexicographic pubkey order for this test');
    }
    cf.finalizeCrowdfundPayoutPsbt(psbt);
    const extracted = psbt.extractTransaction();
    const w = extracted.ins[0].witness;
    assert.ok(Array.isArray(w) && w.length >= 4, 'tapscript witness has sigs + script + control');
    assert.ok(byPos[0].equals(w[0]), 'first witness sig must match position-descending order');
    assert.ok(byPos[1].equals(w[1]), 'second witness sig must match position-descending order');
  });

  it('prepareCrowdfundPayoutPsbt accepts multiple synthetic inputs to same vault', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 80000,
      minContributionSats: 1000,
      refundLocktimeHeight: 900000
    });
    const tx1 = new bitcoin.Transaction();
    tx1.addInput(Buffer.alloc(32, 5), 0, 0xffffffff);
    tx1.addOutput(built.output, 40000);
    const tx2 = new bitcoin.Transaction();
    tx2.addInput(Buffer.alloc(32, 6), 0, 0xffffffff);
    tx2.addOutput(built.output, 45000);
    const prep = cf.prepareCrowdfundPayoutPsbt({
      networkName: 'regtest',
      inputs: [
        { txHex: tx1.toHex(), vout: 0 },
        { txHex: tx2.toHex(), vout: 0 }
      ],
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      destinationAddress: built.address,
      feeSats: 5000,
      goalSats: 80000
    });
    assert.strictEqual(prep.inputCount, 2);
    assert.strictEqual(prep.totalInputSats, 85000);
    assert.strictEqual(prep.psbt.data.inputs.length, 2);
  });

  it('prepareCrowdfundPayoutPsbt throws when fee leaves destination below dust', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 50000,
      minContributionSats: 100,
      refundLocktimeHeight: 888888
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 7), 0, 0xffffffff);
    tx.addOutput(built.output, 60000);
    assert.throws(() => cf.prepareCrowdfundPayoutPsbt({
      networkName: 'regtest',
      inputs: [{ txHex: tx.toHex(), vout: 0 }],
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      destinationAddress: built.address,
      feeSats: 59500,
      goalSats: 50000
    }), /dust|below dust/i);
  });

  it('refund PSBT signs with arbiter only', () => {
    const arb = ecpair.makeRandom();
    const ben = ecpair.makeRandom();
    const built = cf.buildCrowdfundP2tr({
      networkName: 'regtest',
      beneficiaryPubkeyCompressed: ben.publicKey,
      arbiterPubkeyCompressed: arb.publicKey,
      goalSats: 40000,
      minContributionSats: 100,
      refundLocktimeHeight: 777777
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 4), 0, 0xffffffff);
    tx.addOutput(built.output, 25000);
    const { psbt } = cf.prepareCrowdfundRefundPsbt({
      networkName: 'regtest',
      fundedTxHex: tx.toHex(),
      paymentAddress: built.address,
      payoutScript: built.payoutScript,
      refundScript: built.refundScript,
      refundLocktimeHeight: built.refundLocktimeHeight,
      destinationAddress: built.address,
      feeSats: 1000
    });
    cf.signAllInputsWithKey(psbt, arb.privateKey);
    cf.finalizeCrowdfundRefundPsbt(psbt);
    const out = cf.extractPsbtTransaction(psbt);
    assert.ok(out.txid.length === 64);
  });
});
