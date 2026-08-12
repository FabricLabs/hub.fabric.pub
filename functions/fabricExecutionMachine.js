'use strict';

/**
 * Hub execution contracts — thin wrapper over `@fabric/core` Machine/Program
 * runner (`fabric-execution` language).
 *
 * Injects Hub message-registry FabricOpcode resolution so ChatMessage etc.
 * resolve to canonical outer types (Ping/Pong remain rejected).
 *
 * @see @fabric/core/functions/executionProgramRunner
 */

const { findOuterByName, findOuterByOpcodeDec } = require('./fabricMessageRegistry');

let runner = null;
try {
  runner = require('@fabric/core/functions/executionProgramRunner');
} catch (_) {
  runner = null;
}

function _runner () {
  if (!runner) {
    throw new Error('@fabric/core/functions/executionProgramRunner required — npm run link:fabric');
  }
  return runner;
}

/** Outer wire names that are transport keepalives — not allowed in FabricOpcode steps. */
const NON_EXECUTION_FABRIC_TYPES = new Set(['Ping', 'Pong']);

function assertExecutableOuterType (entry) {
  if (!entry || !entry.name) return;
  if (NON_EXECUTION_FABRIC_TYPES.has(entry.name)) {
    throw new Error(`${entry.name} is a transport keepalive, not an Execution program opcode`);
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
 * Run a sandboxed Fabric execution program on core Machine/Program.
 *
 * @param {Object} program - `{ version?: number, steps: Array<{ op: string, ... }> }`
 * @param {Object} [options]
 * @returns {{ ok: boolean, stepsExecuted?: number, stack?: any[], trace?: any[], error?: string, programHash?: string, runCommitmentHex?: string, program?: object }}
 */
function runExecutionProgram (program, options = {}) {
  return _runner().runExecutionProgram(program, Object.assign({}, options, {
    resolveFabricEntry
  }));
}

function executionProgramDigest (program) {
  const { executionProgramFromHub } = _runner();
  return executionProgramFromHub(program).programHash;
}

// Install Hub resolver as core default when this module loads.
try {
  _runner().setFabricEntryResolver(resolveFabricEntry);
} catch (_) { /* core not linked yet */ }

module.exports = {
  runExecutionProgram,
  executionProgramDigest,
  resolveFabricEntry,
  DEFAULT_MAX_STEPS: 256,
  DEFAULT_MAX_STACK: 64,
  NON_EXECUTION_FABRIC_TYPES
};

try {
  const r = _runner();
  module.exports.DEFAULT_MAX_STEPS = r.DEFAULT_MAX_STEPS;
  module.exports.DEFAULT_MAX_STACK = r.DEFAULT_MAX_STACK;
} catch (_) { /* defaults above */ }
