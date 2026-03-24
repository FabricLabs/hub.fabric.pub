'use strict';

const { hubJsonRpc } = require('./sidechainHubClient');

/**
 * @param {object} body
 * @returns {Promise<{ ok: boolean, result?: object, error?: string }>}
 */
async function buildDocumentOfferEscrow (body) {
  const out = await hubJsonRpc('BuildDocumentOfferEscrow', [body]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') return { ok: false, error: r.message || 'BuildDocumentOfferEscrow failed' };
  return { ok: true, result: r };
}

async function verifyDocumentOfferFunding (body) {
  const out = await hubJsonRpc('VerifyDocumentOfferFunding', [body]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') return { ok: false, error: r.message || 'verify failed' };
  return { ok: true, result: r };
}

async function prepareDocumentOfferDelivererClaimPsbt (body) {
  const out = await hubJsonRpc('PrepareDocumentOfferDelivererClaimPsbt', [body]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') return { ok: false, error: r.message || 'prepare claim failed' };
  return { ok: true, result: r };
}

async function prepareDocumentOfferInitiatorRefundPsbt (body) {
  const out = await hubJsonRpc('PrepareDocumentOfferInitiatorRefundPsbt', [body]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') return { ok: false, error: r.message || 'prepare refund failed' };
  return { ok: true, result: r };
}

async function broadcastSignedTransaction (body) {
  const out = await hubJsonRpc('BroadcastSignedTransaction', [body]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') return { ok: false, error: r.message || 'broadcast failed' };
  return { ok: true, result: r };
}

async function getBitcoinTipHeight () {
  const out = await hubJsonRpc('GetBitcoinStatus', []);
  if (!out.ok) return { ok: false, error: out.error };
  const h = out.result && out.result.height;
  if (!Number.isFinite(Number(h))) return { ok: false, error: 'GetBitcoinStatus missing height' };
  return { ok: true, height: Math.floor(Number(h)) };
}

module.exports = {
  buildDocumentOfferEscrow,
  verifyDocumentOfferFunding,
  prepareDocumentOfferDelivererClaimPsbt,
  prepareDocumentOfferInitiatorRefundPsbt,
  broadcastSignedTransaction,
  getBitcoinTipHeight
};
