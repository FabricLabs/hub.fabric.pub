'use strict';

/** P2WPKH vbytes (non-witness size * 4 + witness size, /4 rounded up). */
const VB_IN_P2WPKH = 68.25;
const VB_OUT_P2WPKH = 31;
const VB_TX_BASE = 10.5;
/** Conservative P2WPKH output dust floor for relay policy (sats). */
const DUST_P2WPKH_SATS = 330;
const FAUCET_CAP_DEFAULT_SATS = 1000000;
const MAX_INPUTS_PESSIMISTIC = 12;

function vsizeP2wpkh (numInputs, numOutputs) {
  const vin = Math.max(1, Math.min(200, Math.floor(Number(numInputs) || 1)));
  const vout = Math.max(1, Math.min(20, Math.floor(Number(numOutputs) || 2)));
  return Math.ceil(VB_TX_BASE + VB_IN_P2WPKH * vin + VB_OUT_P2WPKH * vout);
}

function feeSatsForVsize (vsize, satPerVbyte) {
  return Math.ceil(vsize * satPerVbyte);
}

function btcPerKbToSatPerVbyte (btcPerKb) {
  const n = Number(btcPerKb);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n * 1e8) / 1000;
}

/**
 * Effective fee rate (sat/vB) from Core-style mempool info + network fallback.
 * @param {object} mempoolInfo - from getmempoolinfo (mempoolminfee, minrelaytxfee as BTC/kB)
 * @param {string} [network]
 * @returns {number}
 */
function satPerVbyteFromMempoolInfo (mempoolInfo, network) {
  const mi = mempoolInfo && typeof mempoolInfo === 'object' ? mempoolInfo : {};
  const fromMempool = btcPerKbToSatPerVbyte(mi.mempoolminfee);
  const fromRelay = btcPerKbToSatPerVbyte(mi.minrelaytxfee);
  let s = null;
  if (fromMempool != null) s = fromMempool;
  if (fromRelay != null) s = s == null ? fromRelay : Math.max(s, fromRelay);
  if (s == null || !Number.isFinite(s) || s < 0.25) {
    const reg = String(network || '').toLowerCase() === 'regtest';
    s = reg ? 1 : 10;
  }
  return Math.max(1, s);
}

function utxoAmountsFromList (utxos) {
  if (!Array.isArray(utxos)) return [];
  const out = [];
  for (const u of utxos) {
    if (!u || typeof u !== 'object') continue;
    let s = u.amountSats;
    if (s == null && u.amount != null) s = Math.round(Number(u.amount) * 1e8);
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n));
  }
  return out.sort((a, b) => b - a);
}

/**
 * Greedy largest-first: can we pay `amountSats` with P2WPKH 2 outputs (recipient + change)?
 * Treats tiny positive change as donated to fee (matches common wallet behavior).
 */
function simulateP2wpkhPayment (amountSats, utxoSatsDesc, satPerVbyte) {
  const DUST = DUST_P2WPKH_SATS;
  const sorted = [...utxoSatsDesc].filter((n) => n > 0).sort((a, b) => b - a);
  const picked = [];
  for (const u of sorted) {
    picked.push(u);
    const vin = picked.length;
    const vsize = vsizeP2wpkh(vin, 2);
    const fee = feeSatsForVsize(vsize, satPerVbyte);
    const totalIn = picked.reduce((a, b) => a + b, 0);
    const after = totalIn - amountSats - fee;
    if (after < 0) continue;
    if (after === 0) return { ok: true, feeSats: fee, inputsUsed: vin };
    if (after >= DUST) return { ok: true, feeSats: fee, inputsUsed: vin, changeSats: after };
    const effFee = fee + after;
    if (totalIn >= amountSats + effFee) return { ok: true, feeSats: effFee, inputsUsed: vin, changeSats: 0 };
  }
  return { ok: false, feeSats: feeSatsForVsize(vsizeP2wpkh(Math.max(1, sorted.length || 1), 2), satPerVbyte), inputsUsed: sorted.length || 0 };
}

function maxSpendableSatsBinarySearch (utxoSatsDesc, satPerVbyte, balanceSats) {
  const amounts = utxoSatsDesc;
  const total = amounts.reduce((a, b) => a + b, 0);
  const cap = Math.min(Math.max(0, Math.floor(Number(balanceSats) || 0)), total);
  if (cap <= 0) return 0;
  let lo = 0;
  let hi = Math.floor(cap);
  for (let i = 0; i < 56; i++) {
    if (lo >= hi) break;
    const mid = Math.floor((lo + hi + 1) / 2);
    const sim = simulateP2wpkhPayment(mid, amounts, satPerVbyte);
    if (sim.ok) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Client-side hints for hub-wallet sends (faucet, payments): fee market + UTXO fragmentation.
 * @param {object} opts
 * @param {number} opts.balanceSats - trusted spendable balance (sats)
 * @param {object[]} [opts.utxos] - listunspent-shaped entries
 * @param {object} [opts.mempoolInfo]
 * @param {string} [opts.network]
 * @param {number} [opts.faucetCapSats]
 * @param {number} [opts.targetAmountSats] - optional amount to validate
 */
function computeHubWalletSpendHints (opts = {}) {
  const balanceSats = Math.max(0, Math.round(Number(opts.balanceSats) || 0));
  const network = opts.network != null ? String(opts.network) : '';
  const mempoolInfo = opts.mempoolInfo;
  const satPerVbyte = satPerVbyteFromMempoolInfo(mempoolInfo, network);
  const amounts = utxoAmountsFromList(opts.utxos);
  const n = amounts.length;
  const largestUtxoSats = n > 0 ? amounts[0] : 0;
  const feeSingleSpendSats = feeSatsForVsize(vsizeP2wpkh(1, 2), satPerVbyte);
  const pessimisticInputs = Math.min(MAX_INPUTS_PESSIMISTIC, Math.max(1, n || 1));
  const feePessimisticSats = feeSatsForVsize(vsizeP2wpkh(pessimisticInputs, 2), satPerVbyte);
  const feeReserveSats = Math.max(feeSingleSpendSats, feePessimisticSats) + DUST_P2WPKH_SATS;

  let maxSpendableSats = 0;
  if (n > 0) maxSpendableSats = maxSpendableSatsBinarySearch(amounts, satPerVbyte, balanceSats);
  else if (balanceSats > 0) maxSpendableSats = Math.max(0, balanceSats - feeSingleSpendSats - DUST_P2WPKH_SATS);

  const faucetCapSats = Math.max(1, Math.round(Number(opts.faucetCapSats) || FAUCET_CAP_DEFAULT_SATS));
  const maxAffordableSats = Math.min(faucetCapSats, maxSpendableSats);

  const targetAmountSats = opts.targetAmountSats != null ? Math.round(Number(opts.targetAmountSats)) : null;
  let canPayTarget = null;
  let payTargetSim = null;
  if (n > 0 && targetAmountSats != null && Number.isFinite(targetAmountSats) && targetAmountSats > 0) {
    payTargetSim = simulateP2wpkhPayment(targetAmountSats, amounts, satPerVbyte);
    canPayTarget = !!payTargetSim.ok;
  }

  const fragmentedVsSingle =
    n > 1 &&
    largestUtxoSats > 0 &&
    targetAmountSats != null &&
    Number.isFinite(targetAmountSats) &&
    targetAmountSats + feeSingleSpendSats > largestUtxoSats;

  return {
    satPerVbyte: Math.round(satPerVbyte * 1000) / 1000,
    feeSingleSpendSats,
    feePessimisticSats,
    feeReserveSats,
    dustRecipientSats: DUST_P2WPKH_SATS,
    utxoCount: n,
    largestUtxoSats,
    maxSpendableSats,
    maxAffordableSats,
    minRecipientSats: DUST_P2WPKH_SATS,
    canPayTarget,
    payTargetSim,
    fragmentedVsSingle,
    hadUtxoList: n > 0
  };
}

module.exports = {
  satPerVbyteFromMempoolInfo,
  utxoAmountsFromList,
  simulateP2wpkhPayment,
  maxSpendableSatsBinarySearch,
  computeHubWalletSpendHints,
  vsizeP2wpkh,
  DUST_P2WPKH_SATS
};
