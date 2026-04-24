'use strict';

const assert = require('assert');
const txContractLabels = require('../functions/txContractLabels');

describe('txContractLabels', function () {
  it('mergeLabelsOntoTransactions attaches fabricContract', function () {
    const txs = [{ txid: 'AA' + 'b'.repeat(62), value: 1 }];
    const map = {};
    map[`aa${'b'.repeat(62)}`] = { types: ['storage_contract'], meta: { documentId: 'doc1' } };
    const out = txContractLabels.mergeLabelsOntoTransactions(txs, map);
    assert.strictEqual(out[0].fabricContract.types[0], 'storage_contract');
    assert.ok(out[0].fabricContract.label.includes('Storage'));
  });

  it('buildInvoiceTxLabels maps invoice txids', function () {
    const m = txContractLabels.buildInvoiceTxLabels([
      { id: 'inv1', txids: ['a'.repeat(64)], memo: 'test' }
    ]);
    assert.deepStrictEqual(m['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'].types, ['fabric_invoice']);
  });

  it('mergeServerAndLocalLabels merges types', function () {
    const txs = [{
      txid: 'c'.repeat(64),
      fabricContract: { types: ['payjoin'], label: 'Payjoin', meta: {} }
    }];
    const local = {};
    local['c'.repeat(64)] = { types: ['fabric_invoice'], meta: { invoiceId: 'x' } };
    const out = txContractLabels.mergeServerAndLocalLabels(txs, local);
    assert.ok(out[0].fabricContract.types.includes('payjoin'));
    assert.ok(out[0].fabricContract.types.includes('fabric_invoice'));
  });
});
