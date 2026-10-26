'use strict';

/**
 * @fileoverview Browser client for the Hub coinjoin market
 * (`/services/coinjoin`, `services/coinjoin.js`): offers, maker terms, rounds,
 * and fidelity bonds. Rounds, maker terms, and bonds need the Hub admin token.
 */

const BLOCK_MINUTES = 10;

/**
 * Rough wall-clock length of a number of blocks (10 minutes each).
 * @param {number} blocks
 * @returns {string} e.g. `3 days`, `5 hours`, `20 minutes`
 */
function blocksToDuration (blocks) {
  const n = Math.max(0, Math.floor(Number(blocks) || 0));
  const minutes = n * BLOCK_MINUTES;
  const plural = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  if (minutes >= 60 * 24 * 60) return plural(Math.round(minutes / (60 * 24 * 30)), 'month');
  if (minutes >= 60 * 24 * 2) return plural(Math.round(minutes / (60 * 24)), 'day');
  if (minutes >= 120) return plural(Math.round(minutes / 60), 'hour');
  return plural(minutes, 'minute');
}

/**
 * Lock state of a bond from `GET /services/coinjoin/bonds`.
 * @param {Object} bond
 * @returns {string}
 */
function bondLockText (bond) {
  if (!bond) return '';
  if (bond.status === 'redeemed') return 'Redeemed';
  if (bond.status === 'spent') return 'Spent';
  const left = Number(bond.blocksUntilUnlock) || 0;
  if (left <= 0) return `Unlocked at block ${bond.locktime}`;
  return `Locked until block ${bond.locktime} (${left} blocks, about ${blocksToDuration(left)})`;
}

/**
 * Certificate state of a bond: offers carry it only while it is live.
 * @param {Object} bond
 * @returns {string}
 */
function bondCertificateText (bond) {
  if (!bond || bond.certExpiresAt == null) return 'No certificate';
  const left = Number(bond.certBlocksLeft) || 0;
  if (left <= 0) return `Expired at block ${bond.certExpiresAt}`;
  return `Expires at block ${bond.certExpiresAt} (about ${blocksToDuration(left)})`;
}

/**
 * Fee a maker charges for one output of `amountSats`: `feeSats + floor(amount × feePpm / 1e6)`.
 * @param {Object} offer `{ feeSats, feePpm }`
 * @param {number} amountSats
 * @returns {number}
 */
function offerFeeSats (offer, amountSats) {
  const amount = Number(amountSats) || 0;
  return (Number(offer && offer.feeSats) || 0) + Math.floor(amount * (Number(offer && offer.feePpm) || 0) / 1e6);
}

/** @private */
async function request (method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  const t = String(token || '').trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const message = json && json.message ? json.message : `${res.status} ${res.statusText || ''}`.trim();
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** @returns {Promise<Object>} `CoinjoinStatus` */
function fetchCoinjoinStatus () {
  return request('GET', '/services/coinjoin');
}

/**
 * @param {Object} [filter] `{ amountSats, makerPubkey }`
 * @returns {Promise<Object>} `CoinjoinOffers`
 */
function fetchCoinjoinOffers (filter = {}) {
  const q = new URLSearchParams();
  if (filter.amountSats) q.set('amountSats', String(filter.amountSats));
  if (filter.makerPubkey) q.set('makerPubkey', String(filter.makerPubkey));
  const qs = q.toString();
  return request('GET', `/services/coinjoin/offers${qs ? `?${qs}` : ''}`);
}

/**
 * Set the Hub's maker terms and re-sign its offers (admin).
 * @param {string} token
 * @param {Object} terms `{ enable, poolSizesBtc, feeSats, feePpm, txFeeContributionSats }`
 */
function saveMakerTerms (token, terms) {
  return request('POST', '/services/coinjoin/offers', { token, body: terms });
}

/** @param {string} token */
function fetchCoinjoinRounds (token) {
  return request('GET', '/services/coinjoin/rounds', { token });
}

/**
 * @param {string} token
 * @param {Object} opts `{ amountSats, makers, feeRateSatVb, maxFeeSats, requireBond }`
 */
function startCoinjoinRound (token, opts) {
  return request('POST', '/services/coinjoin/rounds', { token, body: opts });
}

/** @param {string} token */
function fetchFidelityBonds (token) {
  return request('GET', '/services/coinjoin/bonds', { token });
}

/**
 * @param {string} token
 * @param {Object} opts `{ amountSats, locktime, certBlocks }`
 */
function createFidelityBond (token, opts) {
  return request('POST', '/services/coinjoin/bonds', { token, body: opts });
}

/**
 * @param {string} token
 * @param {string} bondId
 * @param {Object} [opts] `{ certBlocks }`
 */
function renewBondCertificate (token, bondId, opts = {}) {
  return request('POST', `/services/coinjoin/bonds/${encodeURIComponent(bondId)}/certificate`, { token, body: opts });
}

/**
 * @param {string} token
 * @param {string} bondId
 * @param {Object} [opts] `{ destinationAddress, feeSats }`
 */
function redeemFidelityBond (token, bondId, opts = {}) {
  return request('POST', `/services/coinjoin/bonds/${encodeURIComponent(bondId)}/redeem`, { token, body: opts });
}

module.exports = {
  blocksToDuration,
  bondLockText,
  bondCertificateText,
  offerFeeSats,
  fetchCoinjoinStatus,
  fetchCoinjoinOffers,
  saveMakerTerms,
  fetchCoinjoinRounds,
  startCoinjoinRound,
  fetchFidelityBonds,
  createFidelityBond,
  renewBondCertificate,
  redeemFidelityBond
};
