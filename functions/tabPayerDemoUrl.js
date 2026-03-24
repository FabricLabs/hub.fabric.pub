'use strict';

/**
 * Absolute URL to open Bitcoin Payments with Make Payment prefilled (two-tab invoice demo).
 * Uses only `payTo` / `payAmountSats` — payer wallet is always BIP44 account 0 under the Fabric identity (no query override).
 * @param {string} address - Invoice receive address
 * @param {number} amountSats
 * @param {string} [origin] - Optional origin (for tests); defaults to `window.location.origin`
 * @returns {string}
 */
function buildTabPayerDemoUrl (address, amountSats, origin) {
  const addr = String(address || '').trim();
  if (!addr) return '#';

  let base = origin != null ? String(origin).replace(/\/$/, '') : '';
  if (!base && typeof window !== 'undefined' && window.location && window.location.origin) {
    base = String(window.location.origin).replace(/\/$/, '');
  }
  if (!base) return '#';

  const q = new URLSearchParams();
  q.set('payTo', addr);
  const n = Number(amountSats);
  if (Number.isFinite(n) && n > 0) {
    q.set('payAmountSats', String(Math.round(n)));
  }
  return `${base}/services/bitcoin/payments?${q.toString()}#fabric-btc-make-payment-h4`;
}

module.exports = {
  buildTabPayerDemoUrl
};
