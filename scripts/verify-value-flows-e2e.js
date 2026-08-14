'use strict';

/**
 * End-to-end: three product flows on one Hub (regtest + admin token recommended).
 *
 *   1) Crowdfund a transaction — Taproot campaign vault, hub wallet funds to goal, L1 proof.
 *   2) Distribute a document — publisher CreateDistributeInvoice → pay → CreateStorageContract (replication bond).
 *   3) Earn profit for hosting files — host AcceptDistributeProposal (invoice to host) → “proposer” pays → CreateStorageContract.
 *
 * Requires: running Hub, Bitcoin enabled, JSON-RPC, `FABRIC_HUB_ADMIN_TOKEN` (or `FABRIC_ADMIN_TOKEN`).
 *
 *   FABRIC_HUB_ADMIN_TOKEN=… HUB_URL=http://127.0.0.1:8080 node scripts/verify-value-flows-e2e.js
 *
 * Optional env:
 *   FABRIC_VALUE_E2E_SKIP_MINE=1 — 0-conf only (faster; may be flakier)
 *   FABRIC_CROWDFUND_E2E_GOAL_SATS, FABRIC_STORAGE_E2E_AMOUNT_SATS, FABRIC_HOSTING_E2E_AMOUNT_SATS
 */

const Key = require('@fabric/core/types/key');

const BASE = (process.env.HUB_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN = process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '';
const SKIP_MINE = process.env.FABRIC_VALUE_E2E_SKIP_MINE === '1' || process.env.FABRIC_VALUE_E2E_SKIP_MINE === 'true';

const GOAL_SATS = Math.max(1000, Math.round(Number(process.env.FABRIC_CROWDFUND_E2E_GOAL_SATS || 2500)));
const MIN_SATS = Math.max(546, Math.round(Number(process.env.FABRIC_CROWDFUND_E2E_MIN_SATS || 1000)));
const DISTRIBUTE_SATS = Math.max(1000, Number(process.env.FABRIC_STORAGE_E2E_AMOUNT_SATS || 2500));
const HOSTING_SATS = Math.max(1000, Number(process.env.FABRIC_HOSTING_E2E_AMOUNT_SATS || 2500));

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

async function createCrowdfundCampaign (body) {
  const res = await fetch(`${BASE}/services/bitcoin/crowdfunding/campaigns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${ADMIN}`
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || data.status === 'error') {
    throw new Error((data && data.message) || `Crowdfund create HTTP ${res.status}`);
  }
  return data;
}

async function getCampaign (campaignId) {
  const res = await fetch(`${BASE}/services/bitcoin/crowdfunding/campaigns/${encodeURIComponent(campaignId)}`, {
    headers: { Accept: 'application/json' }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || data.status === 'error') {
    throw new Error((data && data.message) || `Crowdfund GET HTTP ${res.status}`);
  }
  return data;
}

async function mineIfNeeded () {
  if (SKIP_MINE) return;
  await bitcoinPost({ method: 'generateblock', adminToken: ADMIN, count: 1 });
}

async function runCrowdfund (report, runId) {
  console.log('\n[value-flows-e2e] === 1) Crowdfund (Taproot vault + L1) ===');
  const beneficiary = new Key();
  const created = await createCrowdfundCampaign({
    title: `E2E Value Flows Crowdfund ${runId}`,
    beneficiaryPubkeyHex: String(beneficiary.pubkey).toLowerCase(),
    goalSats: GOAL_SATS,
    minContributionSats: Math.min(MIN_SATS, GOAL_SATS),
    refundAfterBlocks: 96
  });
  if (!created.campaign || !created.campaign.campaignId || !created.campaign.address) {
    throw new Error('crowdfund: missing campaignId/address');
  }
  const { campaignId, address } = created.campaign;
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: address,
    amountSats: GOAL_SATS,
    adminToken: ADMIN,
    memo: `value-flows-crowdfund:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('crowdfund sendpayment: no txid');
  await mineIfNeeded();
  const after = await getCampaign(campaignId);
  if (Number(after.balanceSats || 0) < GOAL_SATS) {
    throw new Error(`crowdfund: balance too low (${after.balanceSats} < ${GOAL_SATS})`);
  }
  if (!after.goalMet) throw new Error('crowdfund: goalMet false');
  const proof = await rpc('VerifyBitcoinL1Payment', [{ txid, address, amountSats: GOAL_SATS }]);
  if (!proof || proof.verified !== true) throw new Error(`crowdfund VerifyBitcoinL1Payment: ${JSON.stringify(proof)}`);
  report.crowdfund = { campaignId, address, paymentTxid: txid, goalMet: true, l1Verified: true };
  console.log('[value-flows-e2e] crowdfund OK — campaign', campaignId);
}

async function runDistributeDocument (report, runId) {
  console.log('\n[value-flows-e2e] === 2) Distribute document (publisher invoice → bond) ===');
  const contentB64 = Buffer.from(
    `Pay-to-distribute E2E (run ${runId})\n`,
    'utf8'
  ).toString('base64');
  const created = await rpc('CreateDocument', [{
    name: `e2e-distribute-${runId}.txt`,
    mime: 'text/plain',
    contentBase64: contentB64
  }]);
  const doc = created && created.document;
  if (!doc || !doc.id) throw new Error('CreateDocument: missing id');
  const documentId = doc.id;
  const inv = await rpc('CreateDistributeInvoice', [{
    documentId,
    amountSats: DISTRIBUTE_SATS,
    desiredCopies: 1,
    durationYears: 4,
    challengeCadence: 'daily',
    responseDeadline: '10s'
  }]);
  if (!inv || !inv.address) throw new Error('CreateDistributeInvoice: missing address');
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: inv.address,
    amountSats: Math.round(Number(inv.amountSats)),
    adminToken: ADMIN,
    memo: `value-flows-distribute:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('distribute sendpayment: no txid');
  await mineIfNeeded();
  const bonded = await rpc('CreateStorageContract', [{
    documentId,
    amountSats: Math.round(Number(inv.amountSats)),
    txid,
    durationYears: 4,
    challengeCadence: 'daily',
    responseDeadline: '10s',
    desiredCopies: 1
  }]);
  const cid = bonded && (bonded.id || (bonded.contract && bonded.contract.id));
  if (!cid) throw new Error('CreateStorageContract (distribute): missing contract id');
  report.distributeDocument = { documentId, contractId: cid, paymentTxid: txid };
  console.log('[value-flows-e2e] distribute OK — contract', cid);
}

async function runHostingProfit (report, runId) {
  console.log('\n[value-flows-e2e] === 3) Hosting profit (AcceptDistributeProposal → pay host invoice → bond) ===');
  const contentB64 = Buffer.from(
    `Hosting-offer acceptance E2E (run ${runId})\n`,
    'utf8'
  ).toString('base64');
  const created = await rpc('CreateDocument', [{
    name: `e2e-hosting-${runId}.txt`,
    mime: 'text/plain',
    contentBase64: contentB64
  }]);
  const doc = created && created.document;
  if (!doc || !doc.id) throw new Error('CreateDocument (hosting): missing id');
  const documentId = doc.id;
  const config = {
    desiredCopies: 1,
    durationYears: 4,
    challengeCadence: 'daily',
    responseDeadline: '10s',
    actorId: doc.id
  };
  const accepted = await rpc('AcceptDistributeProposal', [{
    documentId,
    amountSats: HOSTING_SATS,
    config,
    senderAddress: `e2e-proposer-fabric-id-${runId}`
  }]);
  if (!accepted || accepted.status === 'error') {
    throw new Error(`AcceptDistributeProposal: ${JSON.stringify(accepted)}`);
  }
  if (!accepted.address) throw new Error('AcceptDistributeProposal: missing host invoice address');
  const invAddr = String(accepted.address);
  const amount = Math.round(Number(accepted.amountSats || HOSTING_SATS));
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: invAddr,
    amountSats: amount,
    adminToken: ADMIN,
    memo: `value-flows-hosting-pay:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('hosting sendpayment: no txid');
  await mineIfNeeded();
  const bonded = await rpc('CreateStorageContract', [{
    documentId,
    amountSats: amount,
    txid,
    durationYears: config.durationYears,
    challengeCadence: config.challengeCadence,
    responseDeadline: config.responseDeadline,
    desiredCopies: config.desiredCopies
  }]);
  const cid = bonded && (bonded.id || (bonded.contract && bonded.contract.id));
  if (!cid) throw new Error('CreateStorageContract (hosting): missing contract id');
  const proof = await rpc('VerifyBitcoinL1Payment', [{ txid, address: invAddr, amountSats: amount }]);
  if (!proof || proof.verified !== true) throw new Error(`hosting VerifyBitcoinL1Payment: ${JSON.stringify(proof)}`);
  report.hostingProfit = {
    documentId,
    contractId: cid,
    hostInvoiceAddress: invAddr,
    paymentTxid: txid,
    amountSats: amount,
    l1Verified: true
  };
  console.log('[value-flows-e2e] hosting OK — host invoice paid, contract', cid);
}

async function main () {
  const report = {
    baseUrl: BASE,
    runId: Date.now(),
    skipMine: SKIP_MINE
  };

  if (!ADMIN) {
    console.error('[value-flows-e2e] Set FABRIC_HUB_ADMIN_TOKEN (or FABRIC_ADMIN_TOKEN).');
    process.exit(1);
  }

  const runId = report.runId;
  console.log('[value-flows-e2e] Starting value flows (crowdfund + distribute + hosting)…');
  console.log('[value-flows-e2e] HUB_URL =', BASE);

  await runCrowdfund(report, runId);
  await runDistributeDocument(report, runId);
  await runHostingProfit(report, runId);

  console.log('\n[value-flows-e2e] All three flows passed.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[value-flows-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
