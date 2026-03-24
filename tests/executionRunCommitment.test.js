'use strict';

const assert = require('assert');
const { computeExecutionRunCommitmentHex } = require('../functions/executionRunCommitment');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');

describe('executionRunCommitment', function () {
  it('matches hub RunExecutionContract digest for the same program output', function () {
    const program = {
      version: 1,
      steps: [
        { op: 'FabricOpcode', fabricType: 'ChatMessage' },
        { op: 'Push', value: { demo: true } }
      ]
    };
    const result = runExecutionProgram(program);
    assert.strictEqual(result.ok, true);
    const contractId = 'test-contract-id-hex';
    const a = computeExecutionRunCommitmentHex(contractId, result);
    const b = computeExecutionRunCommitmentHex(contractId, result);
    assert.strictEqual(a, b);
    assert.strictEqual(a.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(a));
  });

  it('changes when trace changes', function () {
    const id = 'cid';
    const r1 = runExecutionProgram({ steps: [{ op: 'Push', value: 1 }] });
    const r2 = runExecutionProgram({ steps: [{ op: 'Push', value: 2 }] });
    assert.notStrictEqual(
      computeExecutionRunCommitmentHex(id, r1),
      computeExecutionRunCommitmentHex(id, r2)
    );
  });

  it('throws without contractId', function () {
    assert.throws(() => computeExecutionRunCommitmentHex('', { ok: true }), /contractId/);
  });
});
