'use strict';

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const psbtFabric = require('../functions/psbtFabric');

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
});
