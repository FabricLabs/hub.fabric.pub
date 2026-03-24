'use strict';

const { URL } = require('url');

/**
 * Build a Hub SPA path for Bitcoin Payments from a BIP21 `bitcoin:` URI.
 * When `pj=` is present, the full URI is passed as `bitcoinUri` so the UI can run Payjoin.
 * Otherwise uses `payTo` + optional `payAmountSats`.
 *
 * @param {string} uriStr
 * @returns {{ relativePath: string }|null}
 */
function hubPaymentsPathFromBitcoinUri (uriStr) {
  const raw = String(uriStr || '').trim();
  if (!raw.toLowerCase().startsWith('bitcoin:')) return null;
  let u;
  try {
    u = new URL(raw);
  } catch (_) {
    return null;
  }
  if (u.protocol !== 'bitcoin:') return null;
  const address = String(u.pathname || '').replace(/^\//, '').trim();
  if (!address) return null;

  const params = new URLSearchParams();
  if (u.searchParams.get('pj')) {
    params.set('bitcoinUri', raw);
  } else {
    params.set('payTo', address);
    const amountStr = u.searchParams.get('amount');
    const amountBtc = amountStr != null ? Number(amountStr) : NaN;
    if (Number.isFinite(amountBtc) && amountBtc > 0) {
      params.set('payAmountSats', String(Math.round(amountBtc * 1e8)));
    }
  }
  const qs = params.toString();
  return {
    relativePath: `/services/bitcoin/payments${qs ? `?${qs}` : ''}#fabric-btc-make-payment-h4`
  };
}

module.exports = { hubPaymentsPathFromBitcoinUri };
