'use strict';

const assert = require('assert');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');

describe('fabricExecutionMachine', function () {
  it('runs FabricOpcode and stack ops', function () {
    const r = runExecutionProgram({
      version: 1,
      steps: [
        { op: 'FabricOpcode', fabricType: 'ChatMessage' },
        { op: 'Push', value: { x: 1 } },
        { op: 'Dup' },
        { op: 'Pop' }
      ]
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stepsExecuted, 4);
    assert.strictEqual(r.stack.length, 2);
    assert.strictEqual(r.stack[0].name, 'ChatMessage');
    assert.deepStrictEqual(r.stack[1], { x: 1 });
  });

  it('resolves fabricOpcode by decimal', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricOpcode: 103 }]
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stack[0].name, 'ChatMessage');
    assert.strictEqual(r.stack[0].opcodeDec, 103);
  });

  it('rejects Ping and Pong in FabricOpcode steps', function () {
    assert.strictEqual(runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricType: 'Ping' }]
    }).ok, false);
    assert.strictEqual(runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricType: 'Pong' }]
    }).ok, false);
    assert.strictEqual(runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricOpcode: 18 }]
    }).ok, false);
    assert.strictEqual(runExecutionProgram({
      steps: [{ op: 'FabricOpcode', fabricOpcode: 19 }]
    }).ok, false);
  });

  it('rejects unknown op', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'Evil', code: 'process.exit(1)' }]
    });
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes('unknown op'));
  });

  it('rejects stack underflow', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'Pop' }]
    });
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes('underflow'));
  });

  it('enforces maxSteps', function () {
    const steps = [];
    for (let i = 0; i < 20; i++) steps.push({ op: 'Push', value: i });
    const r = runExecutionProgram({ steps }, { maxSteps: 5 });
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes('maxSteps'));
  });

  it('rejects non-plain Push values', function () {
    const r = runExecutionProgram({
      steps: [{ op: 'Push', value: new Date() }]
    });
    assert.strictEqual(r.ok, false);
  });

  it('DelegationSignRequest pushes envelope for hub wire Message', function () {
    const author32 = 'cc'.repeat(32);
    const envelope = {
      '@fabric/MessageEnvelope': '1',
      encryption: 'none',
      author: { kind: 'taproot_contract_pubkey_hash', hex: author32 },
      signers: [],
      display: { prompt: 'Execution contract asks you to sign:' },
      intent: 'demo'
    };
    const r = runExecutionProgram({
      steps: [{ op: 'DelegationSignRequest', envelope }]
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.stack.length, 1);
    assert.strictEqual(r.stack[0].kind, 'DelegationSignRequest');
    assert.deepStrictEqual(r.stack[0].envelope, envelope);
  });
});
