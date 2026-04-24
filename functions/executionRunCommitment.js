'use strict';

const crypto = require('crypto');
const DistributedExecution = require('./fabricDistributedExecution');

const KIND = 'ExecutionRun';

/**
 * Deterministic SHA-256 (hex) over the hub execution result — same bytes for local vs hub if
 * {@link runExecutionProgram} output matches.
 *
 * @param {string} contractId
 * @param {{ ok: boolean, stepsExecuted?: number, error?: string, trace?: any[], stack?: any[] }} result
 * @returns {string} 64-char lowercase hex
 */
function computeExecutionRunCommitmentHex (contractId, result) {
  const id = String(contractId || '').trim();
  if (!id) throw new Error('contractId required');
  const r = result && typeof result === 'object' ? result : {};
  const body = {
    version: 1,
    kind: KIND,
    contractId: id,
    ok: !!r.ok,
    stepsExecuted: r.stepsExecuted != null ? Number(r.stepsExecuted) : null,
    error: r.ok ? null : (r.error != null ? String(r.error) : null),
    trace: Array.isArray(r.trace) ? r.trace : [],
    stack: Array.isArray(r.stack) ? r.stack : []
  };
  const s = DistributedExecution.stableStringify(body);
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

module.exports = {
  computeExecutionRunCommitmentHex,
  EXECUTION_RUN_COMMITMENT_KIND: KIND
};
