'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const { buildAcpCrowdfundDonationPsbt } = require('../functions/crowdfundingAcpTemplate');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

describe('crowdfundingAcpTemplate', () => {
  it('builds outputs-only PSBT to a regtest address', () => {
    const kp = ecpair.makeRandom({ network: bitcoin.networks.regtest });
    const pay = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network: bitcoin.networks.regtest });
    const out = buildAcpCrowdfundDonationPsbt({
      networkName: 'regtest',
      campaignAddress: pay.address,
      donationOutputSats: 10_000
    });
    assert.ok(out.psbtBase64 && out.psbtBase64.length > 20);
    const recheck = new bitcoin.Psbt({ network: bitcoin.networks.regtest });
    recheck.addOutput({ address: pay.address, value: 10000 });
    assert.strictEqual(out.psbtBase64, recheck.toBase64());
    assert.strictEqual(recheck.data.inputs.length, 0);
    assert.strictEqual(recheck.data.outputs.length, 1);
  });
});
