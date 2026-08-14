'use strict';

/**
 * End-to-end check: CreateDocument → CreateDistributeInvoice → Hub wallet pay (sendpayment)
 * → optional regtest mine → CreateStorageContract → GET contract + L1 proof.
 *
 * Requires a running hub with Bitcoin (regtest recommended), JSON-RPC enabled, and admin token.
 *
 *   FABRIC_HUB_ADMIN_TOKEN=… HUB_URL=http://127.0.0.1:8080 node scripts/verify-storage-contract-e2e.js
 *
 * Optional:
 *   FABRIC_STORAGE_E2E_AMOUNT_SATS=2500
 *   FABRIC_STORAGE_E2E_SKIP_MINE=1   — skip generateblock after pay (0-conf proof only)
 */

const BASE = (process.env.HUB_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN = process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '';
const AMOUNT_SATS = Math.max(1000, Number(process.env.FABRIC_STORAGE_E2E_AMOUNT_SATS || 2500));
const SKIP_MINE = process.env.FABRIC_STORAGE_E2E_SKIP_MINE === '1' || process.env.FABRIC_STORAGE_E2E_SKIP_MINE === 'true';

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

async function main () {
  const report = {
    baseUrl: BASE,
    amountSats: AMOUNT_SATS,
    documentId: null,
    invoice: null,
    paymentTxid: null,
    contractId: null,
    contract: null,
    l1Proof: null
  };

  if (!ADMIN) {
    console.error('[storage-contract-e2e] Set FABRIC_HUB_ADMIN_TOKEN (or FABRIC_ADMIN_TOKEN) for sendpayment and generateblock.');
    process.exit(1);
  }

  const runId = Date.now();
  const contentB64 = Buffer.from(
    `Bitcoin-bonded storage contract E2E sample (run ${runId})\n`,
    'utf8'
  ).toString('base64');

  console.log('[storage-contract-e2e] CreateDocument…');
  const created = await rpc('CreateDocument', [{
    name: `e2e-storage-${runId}.txt`,
    mime: 'text/plain',
    contentBase64: contentB64
  }]);
  const doc = created && created.document;
  if (!doc || !doc.id) throw new Error('CreateDocument: missing document id');
  report.documentId = doc.id;
  console.log('[storage-contract-e2e] documentId =', doc.id);

  console.log('[storage-contract-e2e] CreateDistributeInvoice…');
  const inv = await rpc('CreateDistributeInvoice', [{
    documentId: doc.id,
    amountSats: AMOUNT_SATS,
    desiredCopies: 1,
    durationYears: 4,
    challengeCadence: 'daily',
    responseDeadline: '10s'
  }]);
  if (!inv || !inv.address) throw new Error('CreateDistributeInvoice: missing address');
  report.invoice = { address: inv.address, amountSats: inv.amountSats };
  console.log('[storage-contract-e2e] invoice address =', inv.address, 'amountSats =', inv.amountSats);

  console.log('[storage-contract-e2e] sendpayment (hub wallet → invoice)…');
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: inv.address,
    amountSats: Math.round(Number(inv.amountSats)),
    adminToken: ADMIN,
    memo: `storage-e2e:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('sendpayment: no txid');
  report.paymentTxid = txid;
  console.log('[storage-contract-e2e] payment txid =', txid);

  if (!SKIP_MINE) {
    console.log('[storage-contract-e2e] generateblock (regtest)…');
    await bitcoinPost({ method: 'generateblock', adminToken: ADMIN, count: 1 });
  }

  console.log('[storage-contract-e2e] CreateStorageContract…');
  const bonded = await rpc('CreateStorageContract', [{
    documentId: doc.id,
    amountSats: Math.round(Number(inv.amountSats)),
    txid,
    durationYears: 4,
    challengeCadence: 'daily',
    responseDeadline: '10s',
    desiredCopies: 1
  }]);
  const cid = bonded && (bonded.id || (bonded.contract && bonded.contract.id));
  if (!cid) throw new Error('CreateStorageContract: missing contract id');
  report.contractId = cid;
  report.contract = bonded.contract || null;
  console.log('[storage-contract-e2e] contractId =', cid);

  const cRes = await fetch(`${BASE}/contracts/${encodeURIComponent(cid)}`, {
    headers: { Accept: 'application/json' }
  });
  const cBody = await cRes.json();
  if (!cRes.ok || !cBody || cBody.status === 'error') {
    throw new Error(`GET /contracts/:id failed: ${JSON.stringify(cBody)}`);
  }
  if (!cBody.contract || cBody.contract.txid !== txid) {
    throw new Error('Persisted contract missing expected txid');
  }
  if (!cBody.contract.invoiceAddress || cBody.contract.invoiceAmountSats == null) {
    throw new Error('Persisted contract missing invoiceAddress / invoiceAmountSats (hub build mismatch?)');
  }

  const proofUrl = `${BASE}/services/bitcoin/transactions/${encodeURIComponent(txid)}?${new URLSearchParams({
    address: String(cBody.contract.invoiceAddress),
    amountSats: String(Math.round(Number(cBody.contract.invoiceAmountSats)))
  })}`;
  const pRes = await fetch(proofUrl, { headers: { Accept: 'application/json' } });
  const proof = await pRes.json();
  if (!pRes.ok || !proof || proof.verified !== true) {
    throw new Error(`L1 proof failed: ${JSON.stringify(proof)}`);
  }
  report.l1Proof = proof;

  console.log('[storage-contract-e2e] OK — Bitcoin-bonded storage contract verified.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[storage-contract-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
