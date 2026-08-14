'use strict';

/**
 * End-to-end: CreateExecutionRegistryInvoice -> hub wallet sendpayment -> optional mine
 * -> CreateExecutionContract (with txid + programDigest) -> RunExecutionContract
 * -> VerifyBitcoinL1Payment proof for the invoice output.
 *
 * Requires a running hub with Bitcoin (regtest recommended), JSON-RPC enabled, and admin token.
 *
 *   FABRIC_HUB_ADMIN_TOKEN=... HUB_URL=http://127.0.0.1:8080 node scripts/verify-execution-contract-e2e.js
 */

const BASE = (process.env.HUB_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN = process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '';
const AMOUNT_SATS = Math.max(1000, Math.round(Number(process.env.FABRIC_EXEC_E2E_AMOUNT_SATS || 2500)));
const SKIP_MINE = process.env.FABRIC_EXEC_E2E_SKIP_MINE === '1' || process.env.FABRIC_EXEC_E2E_SKIP_MINE === 'true';
const ANCHOR_RUN = process.env.FABRIC_EXEC_E2E_ANCHOR === '1' || process.env.FABRIC_EXEC_E2E_ANCHOR === 'true';

async function rpc (method, params) {
  const res = await fetch(`${BASE}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}: ${JSON.stringify(j)}`);
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  const r = j.result;
  if (r && r.status === 'error') throw new Error(r.message || 'RPC result error');
  return r;
}

async function bitcoinPost (body) {
  const res = await fetch(`${BASE}/services/bitcoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.status === 'error')) {
    throw new Error((data && data.message) || `Bitcoin POST ${res.status}`);
  }
  return data;
}

function buildProgram (runId) {
  return {
    version: 1,
    steps: [
      { op: 'PUSH', value: `e2e-execution-${runId}` },
      { op: 'PUSH', value: 2 },
      { op: 'PUSH', value: 3 },
      { op: 'ADD' }
    ]
  };
}

async function main () {
  const report = {
    baseUrl: BASE,
    amountSats: AMOUNT_SATS,
    programDigest: null,
    invoice: null,
    paymentTxid: null,
    contractId: null,
    runResult: null,
    l1Proof: null,
    anchorTxid: null
  };

  if (!ADMIN) {
    console.error('[execution-contract-e2e] Set FABRIC_HUB_ADMIN_TOKEN (or FABRIC_ADMIN_TOKEN) for sendpayment and generateblock.');
    process.exit(1);
  }

  const runId = Date.now();
  const program = buildProgram(runId);

  console.log('[execution-contract-e2e] CreateExecutionRegistryInvoice...');
  const invoice = await rpc('CreateExecutionRegistryInvoice', [{
    name: `E2E Execution ${runId}`,
    amountSats: AMOUNT_SATS,
    program
  }]);
  if (!invoice || !invoice.address || !invoice.programDigest) {
    throw new Error('CreateExecutionRegistryInvoice: missing address/programDigest');
  }
  report.programDigest = String(invoice.programDigest);
  report.invoice = {
    address: String(invoice.address),
    amountSats: Math.round(Number(invoice.amountSats || 0))
  };
  console.log('[execution-contract-e2e] invoice address =', report.invoice.address, 'amountSats =', report.invoice.amountSats);

  console.log('[execution-contract-e2e] sendpayment (hub wallet -> registry invoice)...');
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: report.invoice.address,
    amountSats: report.invoice.amountSats,
    adminToken: ADMIN,
    memo: `execution-registry-e2e:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('sendpayment: no txid');
  report.paymentTxid = txid;
  console.log('[execution-contract-e2e] payment txid =', txid);

  if (!SKIP_MINE) {
    console.log('[execution-contract-e2e] generateblock (regtest)...');
    await bitcoinPost({ method: 'generateblock', adminToken: ADMIN, count: 1 });
  }

  console.log('[execution-contract-e2e] CreateExecutionContract...');
  const created = await rpc('CreateExecutionContract', [{
    name: `E2E Execution ${runId}`,
    program,
    txid,
    programDigest: report.programDigest
  }]);
  const contractId = created && (created.id || (created.contract && created.contract.id));
  if (!contractId) throw new Error('CreateExecutionContract: missing contract id');
  report.contractId = contractId;
  console.log('[execution-contract-e2e] contractId =', contractId);

  console.log('[execution-contract-e2e] RunExecutionContract...');
  const run = await rpc('RunExecutionContract', [{ contractId }]);
  if (!run || !run.runCommitmentHex) throw new Error('RunExecutionContract: missing runCommitmentHex');
  report.runResult = {
    runCommitmentHex: String(run.runCommitmentHex),
    halted: !!run.halted
  };

  console.log('[execution-contract-e2e] VerifyBitcoinL1Payment...');
  const proof = await rpc('VerifyBitcoinL1Payment', [{
    txid,
    address: report.invoice.address,
    amountSats: report.invoice.amountSats
  }]);
  if (!proof || proof.verified !== true) {
    throw new Error(`VerifyBitcoinL1Payment failed: ${JSON.stringify(proof)}`);
  }
  report.l1Proof = proof;

  if (ANCHOR_RUN) {
    console.log('[execution-contract-e2e] AnchorExecutionRunCommitment (regtest OP_RETURN)...');
    const anchor = await rpc('AnchorExecutionRunCommitment', [{
      commitmentHex: report.runResult.runCommitmentHex,
      adminToken: ADMIN
    }]);
    if (!anchor || anchor.status === 'error') {
      throw new Error(anchor && anchor.message ? anchor.message : 'AnchorExecutionRunCommitment failed');
    }
    if (anchor.type !== 'AnchorExecutionRunCommitmentResult' || !anchor.txid) {
      throw new Error('AnchorExecutionRunCommitment: missing txid');
    }
    report.anchorTxid = String(anchor.txid);
    console.log('[execution-contract-e2e] anchor txid =', report.anchorTxid);
  }

  console.log('[execution-contract-e2e] OK - execution registry L1 flow verified.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[execution-contract-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
