'use strict';

/**
 * Fund the browser / desktop local Fabric identity from the Hub Beacon faucet
 * (regtest / local desktop only — not for production shared hosts). Optionally
 * mine a confirmation so the top-bar balance updates.
 */

const {
  requestFaucet,
  fetchReceiveAddress,
  getNextReceiveWalletContext,
  generateBlock,
  clearBalanceCache,
  loadUpstreamSettings,
  fetchBitcoinStatus
} = require('./bitcoinClient');
const { readHubAdminTokenFromBrowser } = require('./hubAdminTokenBrowser');
const { faucetFromOptionsDocument } = require('./bitcoinFaucetCapability');

const AUTO_FAUCET_SESSION_KEY = 'fabric.desktop.autoFaucetDone';

function isDesktopShell () {
  try {
    return !!(typeof window !== 'undefined' &&
      window.fabricDesktop &&
      window.fabricDesktop.isDesktopShell);
  } catch (_) {
    return false;
  }
}

function autoFaucetAlreadyDone () {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    return window.sessionStorage.getItem(AUTO_FAUCET_SESSION_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function markAutoFaucetDone () {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(AUTO_FAUCET_SESSION_KEY, '1');
    }
  } catch (_) {}
}

/**
 * @param {object} opts
 * @param {object} opts.identity - local Fabric identity (needs xpub)
 * @param {string} [opts.adminToken]
 * @param {number} [opts.amountSats]
 * @param {string} [opts.network]
 * @param {boolean} [opts.mineConfirm] - default true when admin token present
 * @param {object} [opts.upstream]
 * @returns {Promise<object>}
 */
async function fundLocalKeyFromHubFaucet (opts = {}) {
  const identity = opts.identity || {};
  if (!identity.xpub) {
    throw new Error('Local identity with xpub is required to fund from the faucet.');
  }
  const network = String(opts.network || 'regtest').toLowerCase();
  if (network !== 'regtest') {
    throw new Error('Hub faucet is regtest-only.');
  }
  const adminToken = readHubAdminTokenFromBrowser(opts.adminToken) || '';
  const upstream = Object.assign({}, loadUpstreamSettings(), opts.upstream || {}, {
    hubAdminToken: adminToken,
    apiToken: adminToken || undefined
  });

  const wallet = getNextReceiveWalletContext(identity);
  const address = await fetchReceiveAddress(upstream, wallet, { network, identity });
  if (!address) throw new Error('Could not derive a receive address for the local key.');

  let amountSats = Math.round(Number(opts.amountSats) || 0);
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    amountSats = 10000;
    try {
      const status = await fetchBitcoinStatus(upstream);
      // Prefer advertised faucet default when present on OPTIONS via status side-channels — keep 10k.
      if (status && status.faucet && status.faucet.defaultAmountSats) {
        amountSats = Math.max(1, Math.round(Number(status.faucet.defaultAmountSats)));
      }
    } catch (_) {}
  }
  amountSats = Math.max(1, Math.min(1000000, amountSats));

  const result = await requestFaucet(upstream, { address, amountSats });
  if (result && result.error) {
    throw new Error(String(result.error));
  }
  const faucetBody = (result && result.faucet && typeof result.faucet === 'object')
    ? result.faucet
    : result;
  const txid = faucetBody && (faucetBody.txid || faucetBody.transactionId || faucetBody.id)
    ? String(faucetBody.txid || faucetBody.transactionId || faucetBody.id)
    : '';
  if (!txid && result && result.status && String(result.status).toLowerCase() !== 'success') {
    throw new Error((result && result.message) || 'Faucet request failed.');
  }

  let mined = null;
  const wantMine = opts.mineConfirm !== false && !!adminToken;
  if (wantMine) {
    try {
      mined = await generateBlock({
        ...upstream,
        apiToken: adminToken
      }, { count: 1 });
    } catch (e) {
      mined = { error: e && e.message ? e.message : String(e) };
    }
  }

  if (wallet.walletId) {
    try { clearBalanceCache(wallet.walletId); } catch (_) {}
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('clientBalanceUpdate', {
        detail: { source: 'fundLocalKeyFromHubFaucet', address, amountSats, txid }
      }));
    } catch (_) {}
  }

  return {
    ok: true,
    address,
    amountSats,
    txid,
    mined,
    network
  };
}

/**
 * Whether desktop should auto-pull faucet funds once this session.
 * @param {object} opts
 * @param {object|null} opts.identity
 * @param {object|null} opts.clientBalance
 * @param {string} [opts.network]
 * @returns {boolean}
 */
function shouldAutoFundDesktopLocalKey (opts = {}) {
  if (!isDesktopShell()) return false;
  if (autoFaucetAlreadyDone()) return false;
  if (typeof window !== 'undefined' && window.FABRIC_DESKTOP_AUTO_FAUCET === false) return false;
  if (typeof window !== 'undefined' &&
      (window.FABRIC_DESKTOP_AUTO_FAUCET === '0' || window.FABRIC_DESKTOP_AUTO_FAUCET === 0)) {
    return false;
  }
  const network = String(opts.network || 'regtest').toLowerCase();
  if (network !== 'regtest') return false;
  const identity = opts.identity || {};
  if (!identity.xpub) return false;
  const bal = opts.clientBalance;
  if (bal && Number(bal.balanceSats) > 0) return false;
  return true;
}

/**
 * Probe OPTIONS / hub status for faucet availability (best-effort).
 * @param {object} [upstream]
 * @returns {Promise<{ available: boolean, funded?: boolean, reason?: string, faucet?: object }>}
 */
async function discoverLocalHubFaucet (upstream = {}) {
  try {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return { available: false, reason: 'no-window' };
    }
    const origin = String(window.location && window.location.origin ? window.location.origin : '').replace(/\/$/, '');
    if (!origin) return { available: false, reason: 'no-origin' };
    const res = await fetch(origin + '/', {
      method: 'OPTIONS',
      headers: { Accept: 'application/json' }
    });
    const doc = await res.json();
    const faucet = faucetFromOptionsDocument(doc);
    if (!faucet) return { available: false, reason: 'not-advertised' };
    return {
      available: !!faucet.available,
      funded: faucet.funded !== false && Number(faucet.balanceSats || 0) > 0,
      faucet
    };
  } catch (e) {
    return { available: false, reason: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  AUTO_FAUCET_SESSION_KEY,
  isDesktopShell,
  autoFaucetAlreadyDone,
  markAutoFaucetDone,
  fundLocalKeyFromHubFaucet,
  shouldAutoFundDesktopLocalKey,
  discoverLocalHubFaucet
};
