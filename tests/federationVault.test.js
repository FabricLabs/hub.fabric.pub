'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const federationVault = require('../functions/federationVault');

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

describe('federationVault', () => {
  const pkA = '034718b5fb1d66aa4aa95411cbf1638326e287391a4c17cb0da79ca79c005ab2aa';
  const pkB = '0272564d38fbca7c70493f2e161ab2abb8a82869b2edb4730f8fb6a704ba6b0ef9';
  const pkC = '02e631cc67fe292573c58bceaae027066ea082e79ec350e1f7dc6d929bb6da4c6c';

  it('buildFederationVaultFromPolicy is deterministic for key order and 2-of-3', () => {
    const v1 = federationVault.buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pkC, pkA, pkB],
      threshold: 2,
      networkName: 'regtest'
    });
    const v2 = federationVault.buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pkA, pkB, pkC],
      threshold: 2,
      networkName: 'regtest'
    });
    assert.strictEqual(v1.address, v2.address);
    assert.strictEqual(v1.threshold, 2);
    assert.strictEqual(v1.validatorsSortedHex.length, 3);
    assert.ok(v1.address.startsWith('bcrt1'));
    assert.ok(/^[0-9a-f]+$/i.test(v1.multisigScript.toString('hex')));
  });

  it('dedupes identical pubkeys', () => {
    const built = federationVault.buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pkA, pkA],
      threshold: 1,
      networkName: 'regtest'
    });
    assert.strictEqual(built.validatorsSortedHex.length, 1);
  });

  it('prepareVaultWithdrawalPsbt builds base64 PSBT for 1-of-1 vault', () => {
    const built = federationVault.buildFederationVaultFromPolicy({
      validatorPubkeysHex: [pkA],
      threshold: 1,
      networkName: 'regtest'
    });
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0);
    tx.addOutput(built.output, 100000);
    const hex = tx.toHex();
    const dest = bitcoin.payments.p2wpkh({
      pubkey: ecpair.makeRandom().publicKey,
      network: bitcoin.networks.regtest
    }).address;
    const r = federationVault.prepareVaultWithdrawalPsbt({
      networkName: 'regtest',
      fundedTxHex: hex,
      vaultAddress: built.address,
      multisigScript: built.multisigScript,
      destinationAddress: dest,
      feeSats: 1000
    });
    assert.ok(r.psbtBase64 && r.psbtBase64.length > 40);
    assert.strictEqual(r.inputSats, 100000);
    assert.strictEqual(r.destSats, 99000);
  });
});
