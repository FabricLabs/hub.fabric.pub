'use strict';

/**
 * End-to-end: CreateDocument → PublishDocument (purchasePriceSats) → CreatePurchaseInvoice
 * → hub wallet sendpayment → optional regtest generateblock → ClaimPurchase.
 *
 * Mirrors the UI “Purchase document (HTLC)” L1 invoice + verify flow (content-hash binding
 * via publishedDocumentEnvelope; payment is to a hub-generated address).
 *
 *   FABRIC_HUB_ADMIN_TOKEN=… HUB_URL=http://127.0.0.1:8080 node scripts/verify-document-purchase-e2e.js
 *
 * Optional:
 *   FABRIC_DOC_PURCHASE_E2E_AMOUNT_SATS=3000
 *   FABRIC_DOC_PURCHASE_E2E_SKIP_MINE=1
 */

const BASE = (process.env.HUB_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN = process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '';
const PRICE_SATS = Math.max(500, Number(process.env.FABRIC_DOC_PURCHASE_E2E_AMOUNT_SATS || 3000));
const SKIP_MINE = process.env.FABRIC_DOC_PURCHASE_E2E_SKIP_MINE === '1' || process.env.FABRIC_DOC_PURCHASE_E2E_SKIP_MINE === 'true';

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
    purchasePriceSats: PRICE_SATS,
    documentId: null,
    invoice: null,
    paymentTxid: null,
    claimed: null
  };

  if (!ADMIN) {
    console.error('[doc-purchase-e2e] Set FABRIC_HUB_ADMIN_TOKEN (or FABRIC_ADMIN_TOKEN) for sendpayment and generateblock.');
    process.exit(1);
  }

  const runId = Date.now();
  const contentB64 = Buffer.from(
    `Document purchase / publish-envelope E2E (run ${runId})\n`,
    'utf8'
  ).toString('base64');

  console.log('[doc-purchase-e2e] CreateDocument…');
  const created = await rpc('CreateDocument', [{
    name: `e2e-purchase-${runId}.txt`,
    mime: 'text/plain',
    contentBase64: contentB64
  }]);
  const doc = created && created.document;
  if (!doc || !doc.id) throw new Error('CreateDocument: missing document id');
  report.documentId = doc.id;
  console.log('[doc-purchase-e2e] documentId =', doc.id);

  console.log('[doc-purchase-e2e] PublishDocument (purchase price)…');
  const pub = await rpc('PublishDocument', [{ id: doc.id, purchasePriceSats: PRICE_SATS }]);
  if (!pub || !pub.document || !pub.document.published) {
    throw new Error('PublishDocument: expected published document');
  }
  console.log('[doc-purchase-e2e] published purchasePriceSats =', pub.document.purchasePriceSats);

  console.log('[doc-purchase-e2e] CreatePurchaseInvoice…');
  const inv = await rpc('CreatePurchaseInvoice', [{ documentId: doc.id }]);
  if (!inv || !inv.address) throw new Error('CreatePurchaseInvoice: missing address');
  if (!inv.contentHash) throw new Error('CreatePurchaseInvoice: missing contentHash');
  report.invoice = {
    address: inv.address,
    amountSats: inv.amountSats,
    contentHash: inv.contentHash
  };
  console.log('[doc-purchase-e2e] invoice address =', inv.address, 'amountSats =', inv.amountSats);

  console.log('[doc-purchase-e2e] sendpayment (hub wallet → invoice)…');
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: inv.address,
    amountSats: Math.round(Number(inv.amountSats)),
    adminToken: ADMIN,
    memo: `doc-purchase-e2e:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('sendpayment: no txid');
  report.paymentTxid = txid;
  console.log('[doc-purchase-e2e] payment txid =', txid);

  if (!SKIP_MINE) {
    console.log('[doc-purchase-e2e] generateblock (regtest)…');
    await bitcoinPost({ method: 'generateblock', adminToken: ADMIN, count: 1 });
  }

  console.log('[doc-purchase-e2e] ClaimPurchase…');
  const claim = await rpc('ClaimPurchase', [{ documentId: doc.id, txid }]);
  if (!claim || !claim.document || !claim.document.contentBase64) {
    throw new Error('ClaimPurchase: missing document content');
  }
  if (claim.document.contentHash !== inv.contentHash) {
    throw new Error('ClaimPurchase: contentHash mismatch');
  }
  report.claimed = {
    id: claim.document.id,
    name: claim.document.name,
    contentHash: claim.document.contentHash,
    size: claim.document.size
  };
  console.log('[doc-purchase-e2e] OK — purchase verified; content returned.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[doc-purchase-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
