'use strict';

/** Epsilon for treating a value as a whole number of sats. */
const SUB_SAT_EPS = 1e-9;

/**
 * Format satoshis for UI. Whole sats: grouped locale integer. Sub-satoshi: 2 fraction digits (centisat).
 * @param {number|string} value
 * @returns {string}
 */
function formatSatsDisplay (value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const hasSubSat = Math.abs(n % 1) > SUB_SAT_EPS;
  if (hasSubSat) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * BTC string from a possibly fractional sat count; extra decimals when sub-satoshi is present.
 * @param {number|string} sats
 * @returns {string}
 */
function formatBtcFromSats (sats) {
  const n = Number(sats || 0);
  if (!Number.isFinite(n)) return '0.00000000';
  const sub = Math.abs(n % 1) > SUB_SAT_EPS;
  if (!sub) return (n / 100000000).toFixed(8);
  const raw = (n / 100000000).toFixed(10);
  return raw.replace(/0+$/, '').replace(/\.$/, '');
}

module.exports = {
  formatSatsDisplay,
  formatBtcFromSats
};
