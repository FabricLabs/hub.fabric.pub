'use strict';

/**
 * End-to-end: Create crowdfund campaign (admin) -> hub wallet sendpayment to campaign address
 * -> optional mine -> verify campaign vault balance/goal state + VerifyBitcoinL1Payment.
 *
 * Requires a running hub with Bitcoin (regtest recommended), JSON-RPC enabled, and admin token.
 *
 *   FABRIC_HUB_ADMIN_TOKEN=... HUB_URL=http://127.0.0.1:8080 node scripts/verify-crowdfund-l1-e2e.js
 */

const Key = require('@fabric/core/types/key');

const BASE = (process.env.HUB_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN = process.env.FABRIC_HUB_ADMIN_TOKEN || process.env.FABRIC_ADMIN_TOKEN || '';
const GOAL_SATS = Math.max(1000, Math.round(Number(process.env.FABRIC_CROWDFUND_E2E_GOAL_SATS || 2500)));
const MIN_SATS = Math.max(546, Math.round(Number(process.env.FABRIC_CROWDFUND_E2E_MIN_SATS || 1000)));
const SKIP_MINE = process.env.FABRIC_CROWDFUND_E2E_SKIP_MINE === '1' || process.env.FABRIC_CROWDFUND_E2E_SKIP_MINE === 'true';

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

async function createCampaign (body) {
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

async function main () {
  const report = {
    baseUrl: BASE,
    goalSats: GOAL_SATS,
    minContributionSats: MIN_SATS,
    campaign: null,
    paymentTxid: null,
    campaignAfterPayment: null,
    l1Proof: null
  };

  if (!ADMIN) {
    console.error('[crowdfund-l1-e2e] Set FABRIC_HUB_ADMIN_TOKEN (or FABRIC_ADMIN_TOKEN) for campaign creation, sendpayment, and generateblock.');
    process.exit(1);
  }

  const runId = Date.now();
  const beneficiary = new Key();

  console.log('[crowdfund-l1-e2e] Create campaign...');
  const created = await createCampaign({
    title: `E2E Crowdfund ${runId}`,
    beneficiaryPubkeyHex: String(beneficiary.pubkey).toLowerCase(),
    goalSats: GOAL_SATS,
    minContributionSats: Math.min(MIN_SATS, GOAL_SATS),
    refundAfterBlocks: 96
  });
  if (!created.campaign || !created.campaign.campaignId || !created.campaign.address) {
    throw new Error('create campaign: missing campaignId/address');
  }
  report.campaign = created.campaign;
  console.log('[crowdfund-l1-e2e] campaignId =', created.campaign.campaignId, 'address =', created.campaign.address);

  console.log('[crowdfund-l1-e2e] sendpayment (hub wallet -> campaign address)...');
  const pay = await bitcoinPost({
    method: 'sendpayment',
    to: created.campaign.address,
    amountSats: GOAL_SATS,
    adminToken: ADMIN,
    memo: `crowdfund-e2e:${runId}`
  });
  const txid = pay && pay.payment && pay.payment.txid ? String(pay.payment.txid).trim() : '';
  if (!txid) throw new Error('sendpayment: no txid');
  report.paymentTxid = txid;
  console.log('[crowdfund-l1-e2e] payment txid =', txid);

  if (!SKIP_MINE) {
    console.log('[crowdfund-l1-e2e] generateblock (regtest)...');
    await bitcoinPost({ method: 'generateblock', adminToken: ADMIN, count: 1 });
  }

  console.log('[crowdfund-l1-e2e] Fetch campaign state...');
  const after = await getCampaign(created.campaign.campaignId);
  report.campaignAfterPayment = {
    balanceSats: Number(after.balanceSats || 0),
    goalMet: !!after.goalMet,
    unspentCount: Number(after.unspentCount || 0),
    vaultUtxos: Array.isArray(after.vaultUtxos) ? after.vaultUtxos : []
  };
  if (report.campaignAfterPayment.balanceSats < GOAL_SATS) {
    throw new Error(`campaign balance too low (${report.campaignAfterPayment.balanceSats} < ${GOAL_SATS})`);
  }
  if (!report.campaignAfterPayment.goalMet) {
    throw new Error('campaign goalMet is false after payment');
  }

  console.log('[crowdfund-l1-e2e] VerifyBitcoinL1Payment...');
  const proof = await rpc('VerifyBitcoinL1Payment', [{
    txid,
    address: created.campaign.address,
    amountSats: GOAL_SATS
  }]);
  if (!proof || proof.verified !== true) {
    throw new Error(`VerifyBitcoinL1Payment failed: ${JSON.stringify(proof)}`);
  }
  report.l1Proof = proof;

  console.log('[crowdfund-l1-e2e] OK - crowdfund L1 payment flow verified.');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[crowdfund-l1-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
