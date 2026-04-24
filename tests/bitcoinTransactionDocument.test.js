'use strict';

const assert = require('assert');
const {
  buildBitcoinTransactionSummary,
  bitcoinTransactionDocumentId,
  bitcoinTransactionDocumentBuffer
} = require('../functions/bitcoinTransactionDocument');

describe('bitcoinTransactionDocument', function () {
  const hex = '0200000001' + '00'.repeat(32) + 'ffffffff0100f2052a0100000017' + '00'.repeat(10);
  const tx = {
    txid: 'aa'.repeat(32),
    version: 2,
    locktime: 0,
    vin: [{ coinbase: '00', sequence: 4294967295 }],
    vout: [],
    size: 120,
    hex
  };
  const blockHash = 'bb'.repeat(32);
  const height = 42;

  it('canonical summary is network + raw hex only', function () {
    const s = buildBitcoinTransactionSummary(tx, blockHash, height, 'regtest');
    assert.strictEqual(s.type, 'BitcoinTransaction');
    assert.strictEqual(s.schemaVersion, 3);
    assert.strictEqual(s.network, 'regtest');
    assert.strictEqual(s.hex, hex.toLowerCase());
    assert.strictEqual(s.fee, undefined);
    assert.strictEqual(s.vin, undefined);
    assert.strictEqual(s.blockhash, undefined);
    assert.strictEqual(s.blockHeight, undefined);
  });

  it('stable id and buffer; ignores block context and verbose-only fields', function () {
    const id1 = bitcoinTransactionDocumentId(tx, blockHash, height, 'regtest');
    const id2 = bitcoinTransactionDocumentId(tx, 'cc'.repeat(32), 99, 'regtest');
    assert.strictEqual(id1, id2);
    assert.strictEqual(id1.length, 64);
    const noisy = { ...tx, fee: 0.0001, blockhash: 'dd'.repeat(32), confirmations: 6 };
    assert.strictEqual(bitcoinTransactionDocumentId(noisy, blockHash, height, 'regtest'), id1);
    const b1 = bitcoinTransactionDocumentBuffer(tx, blockHash, height, 'regtest');
    const b2 = bitcoinTransactionDocumentBuffer(tx, 'cc'.repeat(32), 7, 'regtest');
    assert.ok(b1 && b2);
    assert.ok(b1.equals(b2));
  });

  it('changes id when network changes', function () {
    const a = bitcoinTransactionDocumentId(tx, blockHash, height, 'regtest');
    const b = bitcoinTransactionDocumentId(tx, blockHash, height, 'mainnet');
    assert.notStrictEqual(a, b);
  });

  it('returns null when hex missing', function () {
    const bad = { txid: 'aa'.repeat(32) };
    assert.strictEqual(buildBitcoinTransactionSummary(bad, blockHash, height, 'regtest'), null);
    assert.strictEqual(bitcoinTransactionDocumentBuffer(bad, blockHash, height, 'regtest'), null);
    assert.strictEqual(bitcoinTransactionDocumentId(bad, blockHash, height, 'regtest'), null);
  });
});
