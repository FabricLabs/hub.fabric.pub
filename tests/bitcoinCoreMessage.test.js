'use strict';

const assert = require('assert');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const bip32 = require('bip32').BIP32Factory(ecc);
const { verifyMessage, bitcoinMessageHash } = require('../functions/bitcoinCoreMessage');

bitcoin.initEccLib(ecc);

function coreStyleSign (message, privateKeyBuffer, compressed) {
  const hash = Uint8Array.from(bitcoinMessageHash(message));
  const sk = Uint8Array.from(privateKeyBuffer);
  const { signature, recoveryId } = ecc.signRecoverable(hash, sk);
  const sig65 = Buffer.alloc(65);
  sig65[0] = 27 + recoveryId + (compressed ? 4 : 0);
  Buffer.from(signature).copy(sig65, 1);
  return sig65.toString('base64');
}

describe('bitcoinCoreMessage', function () {
  const priv = Buffer.from('4141414141414141414141414141414141414141414141414141414141414141', 'hex');
  const node = bip32.fromPrivateKey(priv, Buffer.alloc(32));

  it('verifyMessage accepts regtest P2PKH for a Core-style signature', function () {
    const net = bitcoin.networks.regtest;
    const { address } = bitcoin.payments.p2pkh({ pubkey: node.publicKey, network: net });
    const msg = 'fabric hub verifymessage compat';
    const b64 = coreStyleSign(msg, node.privateKey, true);
    assert.strictEqual(verifyMessage(address, b64, msg, 'regtest'), true);
  });

  it('verifyMessage accepts regtest P2WPKH (v0 witness)', function () {
    const net = bitcoin.networks.regtest;
    const { address } = bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network: net });
    const msg = 'fabric hub verifymessage compat';
    const b64 = coreStyleSign(msg, node.privateKey, true);
    assert.strictEqual(verifyMessage(address, b64, msg, 'regtest'), true);
  });

  it('verifyMessage rejects wrong message', function () {
    const net = bitcoin.networks.regtest;
    const { address } = bitcoin.payments.p2pkh({ pubkey: node.publicKey, network: net });
    const b64 = coreStyleSign('expected', node.privateKey, true);
    assert.strictEqual(verifyMessage(address, b64, 'other text', 'regtest'), false);
  });
});
