'use strict';

/**
 * Browser-local Joinmarket liquidity pool targets (BTC). Three tiers from largest to smallest.
 * Used as operator reference for staging hub-wallet UTXOs / ACP-friendly chunk sizes — not enforced on-chain.
 */

const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');
const { SATS_PER_BTC, BITCOIN_MAX_SUPPLY_BTC: MAX_BTC_SUPPLY } = require('../constants');

const STORAGE_KEY = 'fabric.joinmarket.poolSizesBtc';

/** Default pools: 0.05 → 0.005 → 0.0005 BTC */
const DEFAULT_POOLS_BTC = Object.freeze([0.05, 0.005, 1 / 2000]);

const LABELS = Object.freeze(['Pool A (largest)', 'Pool B', 'Pool C (smallest)']);

/**
 * @returns {number[]} three positive BTC amounts
 */
function loadJoinmarketPoolSizesBtc () {
  if (typeof window === 'undefined') return [...DEFAULT_POOLS_BTC];
  try {
    const parsed = readStorageJSON(STORAGE_KEY, null);
    if (!parsed) return [...DEFAULT_POOLS_BTC];
    if (!Array.isArray(parsed) || parsed.length !== 3) return [...DEFAULT_POOLS_BTC];
    const out = [];
    for (let i = 0; i < 3; i++) {
      const n = Number(parsed[i]);
      const d = DEFAULT_POOLS_BTC[i];
      if (!Number.isFinite(n) || n <= 0 || n > MAX_BTC_SUPPLY) out.push(d);
      else out.push(n);
    }
    return out;
  } catch (e) {
    return [...DEFAULT_POOLS_BTC];
  }
}

/**
 * @param {number[]} pools - must be length 3, positive BTC
 * @returns {number[]} normalized pools (always length 3)
 */
function saveJoinmarketPoolSizesBtc (pools) {
  const base = Array.isArray(pools) ? pools : [];
  const next = [];
  for (let i = 0; i < 3; i++) {
    const n = Number(base[i]);
    const d = DEFAULT_POOLS_BTC[i];
    if (!Number.isFinite(n) || n <= 0 || n > MAX_BTC_SUPPLY) next.push(d);
    else next.push(n);
  }
  if (typeof window !== 'undefined') {
    try {
      writeStorageJSON(STORAGE_KEY, next);
    } catch (e) {}
  }
  return next;
}

function poolLabels () {
  return [...LABELS];
}

function btcToSats (btc) {
  const n = Number(btc);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * SATS_PER_BTC);
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_POOLS_BTC,
  loadJoinmarketPoolSizesBtc,
  saveJoinmarketPoolSizesBtc,
  poolLabels,
  btcToSats
};
