'use strict';

const assert = require('assert');
const { gateExecutionRegistryCreate } = require('../functions/executionRegistryGate');
const { computeExecutionRunCommitmentHex, buildExecutionRunOutput } = require('../functions/executionRunCommitment');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');

describe('executionRegistryGate L1 payment paths', function () {
  const digest = 'ab'.repeat(32);
  const program = { version: 1, steps: [{ op: 'Push', value: 1 }] };
  const pending = {
    address: 'bcrt1ptestampleinvoice000000000000000000000',
    amountSats: 2500,
    program
  };

  it('skips payment when Bitcoin disabled', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: false,
      computedDigest: digest
    });
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.skipPayment, true);
  });

  it('fails without programDigest when Bitcoin enabled', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: ''
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'DIGEST_REQUIRED');
  });

  it('fails on programDigest mismatch', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: 'cd'.repeat(32)
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'DIGEST_MISMATCH');
  });

  it('fails when no pending invoice', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: digest,
      pending: null
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'NO_INVOICE');
  });

  it('fails when program bytes differ from invoice', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: digest,
      pending,
      program: { version: 1, steps: [{ op: 'Push', value: 99 }] },
      stableStringify: JSON.stringify,
      txid: 'aa'.repeat(32),
      paymentVerified: true
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'PROGRAM_MISMATCH');
  });

  it('fails without txid', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: digest,
      pending,
      program,
      stableStringify: JSON.stringify,
      txid: '',
      paymentVerified: true
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'TXID_REQUIRED');
  });

  it('fails when L1 payment verification is false', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: digest,
      pending,
      program,
      stableStringify: JSON.stringify,
      txid: 'aa'.repeat(32),
      paymentVerified: false
    });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'PAYMENT_FAILED');
    assert.match(g.message, /L1 payment verification failed/i);
  });

  it('succeeds when invoice paid and verified', function () {
    const g = gateExecutionRegistryCreate({
      bitcoinEnabled: true,
      computedDigest: digest,
      clientDigest: digest,
      pending,
      program,
      stableStringify: JSON.stringify,
      txid: 'aa'.repeat(32),
      paymentVerified: true
    });
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.verifiedInvoiceMeta.invoiceAddress, pending.address);
    assert.strictEqual(g.verifiedInvoiceMeta.invoiceAmountSats, 2500);
  });
});

describe('executionRunCommitment forward FabricProgramRun', function () {
  it('buildExecutionRunOutput exposes programHash + dual digests', function () {
    const program = {
      version: 1,
      steps: [
        { op: 'FabricOpcode', fabricType: 'ChatMessage' },
        { op: 'Push', value: { demo: true } }
      ]
    };
    const result = runExecutionProgram(program);
    assert.strictEqual(result.ok, true);
    const programHash = '11'.repeat(32);
    const out = buildExecutionRunOutput({
      contractId: 'hub-cid',
      programHash,
      result
    });
    assert.strictEqual(out.programHash, programHash);
    assert.ok(out.executionRunCommitmentHex);
    assert.ok(out.fabricProgramRunCommitmentHex);
    assert.strictEqual(out.runCommitmentHex, out.fabricProgramRunCommitmentHex);
    assert.strictEqual(
      computeExecutionRunCommitmentHex('hub-cid', result),
      out.executionRunCommitmentHex
    );
  });
});
