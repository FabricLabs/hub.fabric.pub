'use strict';

const { SATS_PER_BTC } = require('../constants');
const { parseBitcoinUri } = require('@fabric/core/functions/bip21');

/**
 * Build a Hub SPA path for Bitcoin Payments from a BIP21 `bitcoin:` URI.
 * When `pj=` is present, the full URI is passed as `bitcoinUri` so the UI can run Payjoin.
 * Otherwise uses `payTo` + optional `payAmountSats`.
 *
 * @param {string} uriStr
 * @returns {{ relativePath: string }|null}
 */
function hubPaymentsPathFromBitcoinUri (uriStr) {
  let parsed;
  try {
    parsed = parseBitcoinUri(uriStr);
  } catch (_) {
    return null;
  }
  const address = String(parsed.address || '').trim();
  if (!address) return null;

  const params = new URLSearchParams();
  const pj = parsed.extras && parsed.extras.pj;
  if (pj) {
    params.set('bitcoinUri', String(uriStr || '').trim());
  } else {
    params.set('payTo', address);
    const amountBtc = parsed.amount != null ? Number(parsed.amount) : NaN;
    if (Number.isFinite(amountBtc) && amountBtc > 0) {
      params.set('payAmountSats', String(Math.round(amountBtc * SATS_PER_BTC)));
    }
  }
  const qs = params.toString();
  return {
    relativePath: `/payments${qs ? `?${qs}` : ''}#fabric-btc-make-payment-h4`
  };
}

module.exports = { hubPaymentsPathFromBitcoinUri };
