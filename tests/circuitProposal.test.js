'use strict';

const assert = require('assert');
const circuit = require('../functions/circuitProposal');

describe('functions/circuitProposal', function () {
  it('demoNand2 matches truth table', function () {
    for (const b0 of [0, 1]) {
      for (const b1 of [0, 1]) {
        const { outBit, expected } = circuit.demoNand2(b0, b1);
        assert.strictEqual(outBit, expected, `NAND(${b0},${b1})`);
      }
    }
  });

  it('AND then NOT composes', function () {
    const g = circuit.garbleCircuit({
      numInputWires: 2,
      gates: [
        { type: 'AND', in: [0, 1], out: 2 },
        { type: 'NOT', in: [2], out: 3 }
      ]
    });
    const pkg = circuit.fromEvaluatorPackage(circuit.toEvaluatorPackage(g));
    for (const b0 of [0, 1]) {
      for (const b1 of [0, 1]) {
        const inputs = circuit.inputLabelsForEvaluator(g, [b0, b1]);
        const labels = circuit.evaluateGarbledCircuit(pkg, inputs);
        const bit = circuit.decodeWireBit(g, 3, labels.get(3));
        const expectedNand = b0 && b1 ? 0 : 1;
        assert.strictEqual(bit, expectedNand);
      }
    }
  });
});
