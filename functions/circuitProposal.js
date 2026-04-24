'use strict';

/**
 * Minimal **garbled circuit** (Yao-style, AES-256-GCM).
 *
 * Companion to high-level “circuit proposal” flows: the garbler emits fixed tables;
 * the evaluator, holding one label per input wire, obtains only the output wire label.
 * Mapping that label back to a bit is garbler-side (`decodeWireBit`).
 *
 * **Scope:** honest-but-curious; **no oblivious transfer** — {@link inputLabelsForEvaluator}
 * simulates OT by selecting labels from the garbler’s secret material. For production
 * MPC, combine with OT + consistent encoding.
 */

const crypto = require('crypto');

const LABEL_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const NOT_SALT = Buffer.from('circuitProposal:not', 'utf8');

function randomLabel () {
  return crypto.randomBytes(LABEL_BYTES);
}

function deriveKey2 (a, b) {
  return crypto.createHash('sha256').update(Buffer.concat([a, b])).digest();
}

function deriveKey1 (a) {
  return crypto.createHash('sha256').update(Buffer.concat([a, NOT_SALT])).digest();
}

function symEncrypt (plaintext, key32) {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32, iv, { authTagLength: GCM_TAG_BYTES });
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
}

function symDecrypt (blob, key32) {
  if (!Buffer.isBuffer(blob) || blob.length < GCM_IV_BYTES + GCM_TAG_BYTES) return null;
  const iv = blob.subarray(0, GCM_IV_BYTES);
  const tag = blob.subarray(blob.length - GCM_TAG_BYTES);
  const data = blob.subarray(GCM_IV_BYTES, blob.length - GCM_TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key32, iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (_) {
    return null;
  }
}

/** @returns {{ label0: Buffer, label1: Buffer }} */
function newWirePair () {
  return { label0: randomLabel(), label1: randomLabel() };
}

/** Rows i = 2*va + vb for va,vb ∈ {0,1}. */
function garbleBinaryGateRows (left, right, out, truthFn) {
  const rows = [];
  for (let va = 0; va <= 1; va++) {
    for (let vb = 0; vb <= 1; vb++) {
      const outBit = truthFn(va, vb);
      const outLabel = outBit ? out.label1 : out.label0;
      const la = va ? left.label1 : left.label0;
      const lb = vb ? right.label1 : right.label0;
      rows.push(symEncrypt(outLabel, deriveKey2(la, lb)));
    }
  }
  return rows;
}

function evalBinaryGateRows (rows, labelA, labelB) {
  if (!Array.isArray(rows) || rows.length !== 4) return null;
  const key = deriveKey2(labelA, labelB);
  for (let i = 0; i < 4; i++) {
    const pt = symDecrypt(rows[i], key);
    if (pt && pt.length === LABEL_BYTES) return pt;
  }
  return null;
}

function garbleNotRows (inp, out) {
  return [
    symEncrypt(out.label1, deriveKey1(inp.label0)),
    symEncrypt(out.label0, deriveKey1(inp.label1))
  ];
}

function evalNotRows (rows, inLabel) {
  if (!Array.isArray(rows) || rows.length !== 2) return null;
  const key = deriveKey1(inLabel);
  for (const row of rows) {
    const pt = symDecrypt(row, key);
    if (pt && pt.length === LABEL_BYTES) return pt;
  }
  return null;
}

/**
 * @typedef {{ type: 'AND'|'NAND'|'NOT', in: number[], out: number }} GateSpec
 */

/**
 * Garble a small netlist. Wire ids `0 .. numInputWires-1` are inputs; other ids are outputs of gates in order.
 *
 * @param {{ numInputWires: number, gates: GateSpec[] }} spec
 * @returns {Object} Garbler-held secret (includes all wire label pairs).
 */
function garbleCircuit (spec) {
  const numIn = Number(spec.numInputWires);
  if (!Number.isFinite(numIn) || numIn < 1) throw new Error('numInputWires must be >= 1.');
  const gates = Array.isArray(spec.gates) ? spec.gates : [];
  const wires = [];

  for (let i = 0; i < numIn; i++) wires[i] = newWirePair();

  const garbledGates = [];
  for (const g of gates) {
    const type = String(g.type || '').toUpperCase();
    const outId = Number(g.out);
    if (!Number.isFinite(outId)) throw new Error('gate.out must be a number.');
    if (wires[outId]) throw new Error(`Wire ${outId} already assigned.`);
    const outPair = newWirePair();
    wires[outId] = outPair;

    if (type === 'NOT') {
      const a = Number(g.in[0]);
      if (!wires[a]) throw new Error(`NOT: missing input wire ${a}.`);
      garbledGates.push({ type: 'NOT', in: [a], out: outId, rows: garbleNotRows(wires[a], outPair) });
      continue;
    }

    if (type === 'AND') {
      const a = Number(g.in[0]);
      const b = Number(g.in[1]);
      if (!wires[a] || !wires[b]) throw new Error(`AND: missing input wire ${a} or ${b}.`);
      const rows = garbleBinaryGateRows(wires[a], wires[b], outPair, (va, vb) => va & vb);
      garbledGates.push({ type: 'AND', in: [a, b], out: outId, rows });
      continue;
    }

    if (type === 'NAND') {
      const a = Number(g.in[0]);
      const b = Number(g.in[1]);
      if (!wires[a] || !wires[b]) throw new Error(`NAND: missing input wire ${a} or ${b}.`);
      const rows = garbleBinaryGateRows(wires[a], wires[b], outPair, (va, vb) => (va & vb) ^ 1);
      garbledGates.push({ type: 'NAND', in: [a, b], out: outId, rows });
      continue;
    }

    throw new Error(`Unsupported gate type: ${g.type}`);
  }

  return {
    version: 1,
    numInputWires: numIn,
    garbledGates,
    /** Garbler-only: index → { label0, label1 }. */
    wirePairs: wires
  };
}

/**
 * Payload safe to send to an evaluator (ciphertext tables only).
 * @param {Object} garbled - from {@link garbleCircuit}
 */
function toEvaluatorPackage (garbled) {
  return {
    version: garbled.version,
    numInputWires: garbled.numInputWires,
    garbledGates: garbled.garbledGates.map((g) => ({
      type: g.type,
      in: g.in.slice(),
      out: g.out,
      rows: g.rows.map((r) => r.toString('base64'))
    }))
  };
}

/**
 * @param {Object} pkg - JSON-friendly package from {@link toEvaluatorPackage}
 * @returns {Object} same structure with Buffer rows
 */
function fromEvaluatorPackage (pkg) {
  return {
    version: pkg.version,
    numInputWires: pkg.numInputWires,
    garbledGates: pkg.garbledGates.map((g) => ({
      type: g.type,
      in: g.in.slice(),
      out: g.out,
      rows: g.rows.map((b64) => Buffer.from(b64, 'base64'))
    }))
  };
}

/**
 * Simulates OT: one label per input bit (garbler side).
 * @param {Object} garbled - full {@link garbleCircuit} result
 * @param {number[]} bits - length numInputWires, entries 0 or 1
 * @returns {Map<number, Buffer>}
 */
function inputLabelsForEvaluator (garbled, bits) {
  const n = garbled.numInputWires;
  if (!Array.isArray(bits) || bits.length !== n) throw new Error(`bits must have length ${n}.`);
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const b = bits[i] ? 1 : 0;
    if (b !== 0 && b !== 1) throw new Error('Each bit must be 0 or 1.');
    const pair = garbled.wirePairs[i];
    if (!pair) throw new Error(`Missing wire pair ${i}.`);
    m.set(i, b ? pair.label1 : pair.label0);
  }
  return m;
}

/**
 * @param {Object} pkg - from {@link fromEvaluatorPackage}
 * @param {Map<number,Buffer>} wireLabels - input labels; extended as gates run
 * @returns {Map<number, Buffer>}
 */
function evaluateGarbledCircuit (pkg, wireLabels) {
  const labels = new Map(wireLabels);

  for (const g of pkg.garbledGates) {
    const t = String(g.type || '').toUpperCase();
    if (t === 'NOT') {
      const la = labels.get(g.in[0]);
      if (!la) throw new Error(`NOT: missing label for wire ${g.in[0]}.`);
      const out = evalNotRows(g.rows, la);
      if (!out) throw new Error('NOT: decryption failed.');
      labels.set(g.out, out);
      continue;
    }
    if (t === 'AND' || t === 'NAND') {
      const la = labels.get(g.in[0]);
      const lb = labels.get(g.in[1]);
      if (!la || !lb) throw new Error(`${t}: missing input labels.`);
      const out = evalBinaryGateRows(g.rows, la, lb);
      if (!out) throw new Error(`${t}: decryption failed.`);
      labels.set(g.out, out);
      continue;
    }
    throw new Error(`Unknown gate ${t}.`);
  }
  return labels;
}

/**
 * Garbler maps an evaluated output label to a semantic bit.
 * @param {Object} garbled - full {@link garbleCircuit}
 * @param {number} wireId
 * @param {Buffer} label
 * @returns {number|null} 0, 1, or null
 */
function decodeWireBit (garbled, wireId, label) {
  const pair = garbled.wirePairs[wireId];
  if (!pair || !label) return null;
  if (Buffer.compare(label, pair.label0) === 0) return 0;
  if (Buffer.compare(label, pair.label1) === 0) return 1;
  return null;
}

/**
 * @returns {{ outBit: number, expected: number }}
 */
function demoNand2 (b0, b1) {
  const g = garbleCircuit({
    numInputWires: 2,
    gates: [{ type: 'NAND', in: [0, 1], out: 2 }]
  });
  const ev = fromEvaluatorPackage(toEvaluatorPackage(g));
  const inputs = inputLabelsForEvaluator(g, [b0 ? 1 : 0, b1 ? 1 : 0]);
  const labels = evaluateGarbledCircuit(ev, inputs);
  const outLabel = labels.get(2);
  const outBit = decodeWireBit(g, 2, outLabel);
  const expected = b0 && b1 ? 0 : 1;
  return { outBit, expected };
}

module.exports = {
  LABEL_BYTES,
  randomLabel,
  newWirePair,
  deriveKey2,
  deriveKey1,
  garbleBinaryGateRows,
  evalBinaryGateRows,
  garbleNotRows,
  evalNotRows,
  garbleCircuit,
  toEvaluatorPackage,
  fromEvaluatorPackage,
  inputLabelsForEvaluator,
  evaluateGarbledCircuit,
  decodeWireBit,
  demoNand2
};
