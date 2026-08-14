'use strict';

/**
 * Hub ExecutionRun digests — re-export core bridge so local and hub share bytes.
 *
 * @see @fabric/core/functions/executionRunBridge
 */

let bridge = null;
try {
  bridge = require('@fabric/core/functions/executionRunBridge');
} catch (_) {
  bridge = null;
}

function _bridge () {
  if (!bridge) {
    throw new Error('@fabric/core/functions/executionRunBridge required — npm run link:fabric');
  }
  return bridge;
}

function computeExecutionRunCommitmentHex (contractId, result) {
  return _bridge().computeExecutionRunCommitmentHex(contractId, result);
}

function buildExecutionRunOutput (opts) {
  return _bridge().buildExecutionRunOutput(opts);
}

module.exports = {
  computeExecutionRunCommitmentHex,
  buildExecutionRunOutput,
  EXECUTION_RUN_COMMITMENT_KIND: 'ExecutionRun',
  FABRIC_PROGRAM_RUN_KIND: 'FabricProgramRun'
};
