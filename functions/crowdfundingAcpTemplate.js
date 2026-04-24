'use strict';

/**
 * Outputs-only PSBT for classic ANYONECANPAY-style crowdfund deposits to a fixed on-chain address
 * (here: Taproot campaign vault). Donors add their own inputs and sign with SIGHASH_ALL|ANYONECANPAY;
 * anyone may merge partial PSBTs until inputs cover outputs + fee, then broadcast.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');

bitcoin.initEccLib(ecc);

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

/**
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {string} opts.campaignAddress - bech32 / base58 for the crowdfund vault
 * @param {number} opts.donationOutputSats - value of the single output (per-donation leg)
 */
function buildAcpCrowdfundDonationPsbt (opts = {}) {
  const networkName = opts.networkName || 'regtest';
  const network = networkForFabricName(networkName);
  const addr = String(opts.campaignAddress || '').trim();
  if (!addr) throw new Error('campaignAddress is required.');
  const donationSats = Math.round(Number(opts.donationOutputSats));
  if (!Number.isFinite(donationSats) || donationSats < 546) {
    throw new Error('donationOutputSats must be at least 546 (dust limit).');
  }
  const psbt = new bitcoin.Psbt({ network });
  psbt.addOutput({ address: addr, value: donationSats });
  return {
    psbtBase64: psbt.toBase64(),
    donationOutputSats: donationSats,
    campaignAddress: addr,
    networkName
  };
}

module.exports = {
  buildAcpCrowdfundDonationPsbt,
  networkForFabricName
};
