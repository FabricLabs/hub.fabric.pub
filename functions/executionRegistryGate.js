'use strict';

/**
 * Pure gate for Hub CreateExecutionContract when Bitcoin registry invoices apply.
 * Unit-testable without bitcoind — caller supplies paymentVerified.
 *
 * @module functions/executionRegistryGate
 */

/**
 * @param {object} opts
 * @param {boolean} opts.bitcoinEnabled
 * @param {string} [opts.clientDigest]
 * @param {string} opts.computedDigest
 * @param {object|null} [opts.pending] `{ address, amountSats, program }`
 * @param {string|null} [opts.txid]
 * @param {boolean|null} [opts.paymentVerified] result of L1 verify (required when bitcoin on)
 * @param {function} [opts.stableStringify] program equality helper
 * @param {object} [opts.program] submitted program (json-safe)
 * @returns {{ ok: true, skipPayment?: boolean, verifiedInvoiceMeta?: object }|{ ok: false, code: string, message: string }}
 */
function gateExecutionRegistryCreate (opts = {}) {
  if (!opts.bitcoinEnabled) {
    return { ok: true, skipPayment: true };
  }

  const computedDigest = String(opts.computedDigest || '').trim().toLowerCase();
  const clientDigest = opts.clientDigest != null
    ? String(opts.clientDigest).trim().toLowerCase()
    : '';

  if (!clientDigest) {
    return {
      ok: false,
      code: 'DIGEST_REQUIRED',
      message: 'Bitcoin is enabled: call CreateExecutionRegistryInvoice, pay the invoice on-chain, then pass programDigest and txid with the same program.'
    };
  }
  if (!/^[0-9a-f]{64}$/.test(computedDigest) || clientDigest !== computedDigest) {
    return {
      ok: false,
      code: 'DIGEST_MISMATCH',
      message: 'programDigest does not match canonical hash of program'
    };
  }

  const pending = opts.pending && typeof opts.pending === 'object' ? opts.pending : null;
  if (!pending) {
    return {
      ok: false,
      code: 'NO_INVOICE',
      message: 'No pending registry invoice for this program digest. Call CreateExecutionRegistryInvoice first.'
    };
  }

  const stringify = typeof opts.stableStringify === 'function'
    ? opts.stableStringify
    : ((v) => JSON.stringify(v));
  if (opts.program != null) {
    try {
      if (stringify(opts.program) !== stringify(pending.program)) {
        return {
          ok: false,
          code: 'PROGRAM_MISMATCH',
          message: 'Program does not match pending registry invoice.'
        };
      }
    } catch (e) {
      return {
        ok: false,
        code: 'PROGRAM_MISMATCH',
        message: 'Program does not match pending registry invoice.'
      };
    }
  }

  const txid = opts.txid != null ? String(opts.txid).trim() : '';
  if (!txid) {
    return {
      ok: false,
      code: 'TXID_REQUIRED',
      message: 'txid required after paying the registry invoice.'
    };
  }

  if (opts.paymentVerified !== true) {
    return {
      ok: false,
      code: 'PAYMENT_FAILED',
      message: 'L1 payment verification failed for registry invoice.'
    };
  }

  return {
    ok: true,
    verifiedInvoiceMeta: {
      invoiceAddress: pending.address,
      invoiceAmountSats: pending.amountSats
    }
  };
}

module.exports = {
  gateExecutionRegistryCreate
};
