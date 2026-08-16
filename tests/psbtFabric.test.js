'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const psbtFabric = require('../functions/psbtFabric');

bitcoin.initEccLib(ecc);

describe('psbtFabric', function () {
  it('combinePsbtBase64 merges PSBTs (BIP174 combine)', function () {
    const net = bitcoin.networks.regtest;
    const a = new bitcoin.Psbt({ network: net }).toBase64();
    const b = new bitcoin.Psbt({ network: net }).toBase64();
    const c = psbtFabric.combinePsbtBase64([a, b]);
    const d = psbtFabric.describePsbt(c);
    assert.strictEqual(d.inputCount, 0);
    assert.strictEqual(d.outputCount, 0);
  });

  it('psbtFromBase64 / psbtToBase64 roundtrip', function () {
    const net = bitcoin.networks.regtest;
    const p = new bitcoin.Psbt({ network: net });
    const b64 = psbtFabric.psbtToBase64(p);
    const q = psbtFabric.psbtFromBase64(b64);
    assert.strictEqual(q.toBase64(), b64);
  });

  it('sortPsbtInputBags uses BIP-69 display txid then vout', function () {
    const a = 'aa'.repeat(32);
    const b = 'ff'.repeat(32);
    const sorted = psbtFabric.sortPsbtInputBags([
      { hash: b, index: 1, witnessUtxo: { value: 2 } },
      { txid: a, vout: 0, witnessUtxo: { value: 1 } },
      { hash: a, index: 1, witnessUtxo: { value: 3 } }
    ]);
    assert.strictEqual(sorted[0].txid, a);
    assert.strictEqual(sorted[0].vout, 0);
    assert.strictEqual(sorted[1].hash, a);
    assert.strictEqual(sorted[1].index, 1);
    assert.strictEqual(sorted[2].hash, b);
    assert.ok(sorted[0].witnessUtxo.value === 1);
  });

  it('sortPsbtOutputBags sorts by amount then scriptPubKey', function () {
    const net = bitcoin.networks.regtest;
    const addr = 'bcrt1pr4wctwfz0uznz86ash62jret9gq8ysg82zlzl9kdmuvq066pjcmsa0plmz';
    const sorted = psbtFabric.sortPsbtOutputBags([
      { address: addr, value: 9000 },
      { address: addr, value: 1000 }
    ], net);
    assert.strictEqual(sorted[0].value, 1000);
    assert.strictEqual(sorted[1].value, 9000);
    assert.ok(Buffer.isBuffer(sorted[0].script));
    assert.ok(sorted[0].script.equals(sorted[1].script));
  });
});
