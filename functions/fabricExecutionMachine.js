'use strict';

const { findOuterByName, findOuterByOpcodeDec } = require('./fabricMessageRegistry');

const DEFAULT_MAX_STEPS = 256;
const DEFAULT_MAX_STACK = 64;
const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_TRACE = 512;

/** Outer wire names that are transport keepalives — not allowed in Execution `FabricOpcode` steps. */
const NON_EXECUTION_FABRIC_TYPES = new Set(['Ping', 'Pong']);

function assertExecutableOuterType (entry) {
  if (!entry || !entry.name) return;
  if (NON_EXECUTION_FABRIC_TYPES.has(entry.name)) {
    throw new Error(`${entry.name} is a transport keepalive, not an Execution program opcode`);
  }
}

function assertPlainJson (value, depth, maxDepth) {
  if (depth > maxDepth) throw new Error('value exceeds max nesting depth');
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    if (t === 'number' && !Number.isFinite(value)) throw new Error('non-finite number not allowed');
    return;
  }
  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new Error('unsupported value type in Push');
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertPlainJson(value[i], depth + 1, maxDepth);
    return;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error('non-plain object in Push');
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) assertPlainJson(value[keys[i]], depth + 1, maxDepth);
  }
}

function resolveFabricEntry (step) {
  const hasName = step.fabricType != null && String(step.fabricType).trim() !== '';
  const hasOpcode = step.fabricOpcode != null && step.fabricOpcode !== '';
  let entry = null;
  if (hasName && hasOpcode) {
    const byName = findOuterByName(step.fabricType);
    const byOp = findOuterByOpcodeDec(step.fabricOpcode);
    if (!byName || !byOp || byName.opcodeDec !== byOp.opcodeDec) {
      throw new Error('fabricType and fabricOpcode disagree');
    }
    entry = byName;
  } else if (hasName) {
    entry = findOuterByName(step.fabricType);
    if (!entry) throw new Error(`unknown fabricType: ${step.fabricType}`);
  } else if (hasOpcode) {
    entry = findOuterByOpcodeDec(step.fabricOpcode);
    if (!entry) throw new Error(`unknown fabricOpcode: ${step.fabricOpcode}`);
  } else {
    throw new Error('FabricOpcode requires fabricType or fabricOpcode');
  }
  assertExecutableOuterType(entry);
  return entry;
}

/**
 * Run a sandboxed "program" of Fabric opcode metadata + stack ops. No eval, no I/O, no network.
 *
 * @param {Object} program - `{ version?: number, steps: Array<{ op: string, ... }> }`
 * @param {Object} [options]
 * @param {number} [options.maxSteps]
 * @param {number} [options.maxStack]
 * @param {number} [options.maxDepth] - max object nesting for Push values
 * @param {number} [options.maxTrace] - max trace entries
 * @returns {{ ok: boolean, stepsExecuted?: number, stack?: any[], trace?: any[], error?: string }}
 */
function runExecutionProgram (program, options = {}) {
  const steps = program && program.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'program.steps must be an array' };
  }

  const maxSteps = Math.min(Math.max(1, Number(options.maxSteps) || DEFAULT_MAX_STEPS), 4096);
  const maxStack = Math.min(Math.max(1, Number(options.maxStack) || DEFAULT_MAX_STACK), 256);
  const maxDepth = Math.min(Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_DEPTH), 64);
  const maxTrace = Math.min(Math.max(1, Number(options.maxTrace) || DEFAULT_MAX_TRACE), 8192);

  if (steps.length > maxSteps) {
    return { ok: false, error: `program exceeds maxSteps (${maxSteps})` };
  }

  const stack = [];
  const trace = [];

  function pushTrace (entry) {
    if (trace.length >= maxTrace) {
      if (trace.length === maxTrace) trace.push({ truncated: true });
      return;
    }
    trace.push(entry);
  }

  const ops = {
    FabricOpcode (step, pc) {
      const entry = resolveFabricEntry(step);
      const frame = {
        kind: 'fabric',
        name: entry.name,
        opcodeDec: entry.opcodeDec,
        stability: entry.stability,
        encoding: entry.encoding,
        notes: entry.notes
      };
      stack.push(frame);
      pushTrace({ pc, op: 'FabricOpcode', name: entry.name, opcodeDec: entry.opcodeDec });
    },
    Push (step, pc) {
      if (!Object.prototype.hasOwnProperty.call(step, 'value')) {
        throw new Error('Push requires value');
      }
      assertPlainJson(step.value, 0, maxDepth);
      stack.push(step.value);
      pushTrace({ pc, op: 'Push' });
    },
    Pop (_step, pc) {
      if (stack.length < 1) throw new Error('stack underflow');
      stack.pop();
      pushTrace({ pc, op: 'Pop' });
    },
    Dup (_step, pc) {
      if (stack.length < 1) throw new Error('stack underflow');
      stack.push(stack[stack.length - 1]);
      pushTrace({ pc, op: 'Dup' });
    },
    /**
     * Push a v1 envelope (`functions/fabricMessageEnvelope.js`) for the Hub to serialize into a wire Message
     * (`RunExecutionContract` → `fabricMessageWireHex`). Use `envelope.signers` for MuSig / multi-party flows.
     */
    DelegationSignRequest (step, pc) {
      if (!step || typeof step.envelope !== 'object' || !step.envelope) {
        throw new Error('DelegationSignRequest requires envelope object');
      }
      assertPlainJson(step.envelope, 0, maxDepth);
      stack.push({ kind: 'DelegationSignRequest', envelope: step.envelope });
      pushTrace({ pc, op: 'DelegationSignRequest' });
    }
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || typeof step !== 'object') {
        return { ok: false, error: `invalid step at index ${i}`, trace, stack };
      }
      const op = step.op;
      if (typeof op !== 'string' || !ops[op]) {
        return { ok: false, error: `unknown op "${op}" at index ${i}`, trace, stack };
      }
      ops[op](step, i);
      if (stack.length > maxStack) {
        return { ok: false, error: 'stack overflow', trace, stack };
      }
    }
    return {
      ok: true,
      stepsExecuted: steps.length,
      stack,
      trace
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      trace,
      stack
    };
  }
}

module.exports = {
  runExecutionProgram,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_STACK,
  NON_EXECUTION_FABRIC_TYPES
};
