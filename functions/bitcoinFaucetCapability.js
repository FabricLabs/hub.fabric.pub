'use strict';

/**
 * Regtest Beacon faucet capability for HTTP OPTIONS Application Resource Contracts.
 *
 * Peers discover `services.faucet` via `OPTIONS /`. The service is advertised only when
 * the Hub Bitcoin network is regtest (playnet / local debug). Signet, testnet, and
 * mainnet must not expose a faucet pointer — clients must not assume funding exists.
 */

const FAUCET_MAX_SATS = 1000000;
const FAUCET_DEFAULT_SATS = 10000;
const FAUCET_ENDPOINT = '/services/bitcoin/faucet';
const FAUCET_SOURCE = 'beacon';

/**
 * @param {string|null|undefined} network
 * @returns {boolean}
 */
function isFaucetNetwork (network) {
  return String(network || '').trim().toLowerCase() === 'regtest';
}

/**
 * Build OPTIONS `services.faucet` descriptor, or null when the faucet must stay invisible.
 *
 * @param {object} [opts]
 * @param {string} [opts.network]
 * @param {boolean} [opts.bitcoinAvailable] Hub Bitcoin service ready
 * @param {number|null} [opts.balanceSats] Hub / Beacon wallet balance (sats)
 * @param {number|null} [opts.beaconClock]
 * @param {string} [opts.endpointBasePath]
 * @returns {object|null}
 */
function buildFaucetServiceDescriptor (opts = {}) {
  const network = String(opts.network || '').trim().toLowerCase();
  if (!isFaucetNetwork(network)) return null;
  if (opts.bitcoinAvailable === false) return null;

  const balanceRaw = opts.balanceSats;
  const balanceSats = balanceRaw == null || !Number.isFinite(Number(balanceRaw))
    ? null
    : Math.max(0, Math.round(Number(balanceRaw)));
  const clockRaw = opts.beaconClock;
  const beaconClock = clockRaw == null || !Number.isFinite(Number(clockRaw))
    ? null
    : Math.max(0, Math.floor(Number(clockRaw)));

  const endpointBasePath = String(opts.endpointBasePath || FAUCET_ENDPOINT).trim() || FAUCET_ENDPOINT;
  const funded = balanceSats == null ? null : balanceSats > 0;

  return {
    kind: 'BitcoinFaucet',
    source: FAUCET_SOURCE,
    network: 'regtest',
    endpointBasePath,
    method: 'POST',
    maxAmountSats: FAUCET_MAX_SATS,
    defaultAmountSats: FAUCET_DEFAULT_SATS,
    available: true,
    funded,
    balanceSats,
    beacon: beaconClock == null ? undefined : { clock: beaconClock, balanceSats },
    description: 'Regtest Beacon wallet faucet — debug/playnet only; omitted on signet/mainnet.'
  };
}

/**
 * Extract faucet capability from an OPTIONS Application Resource Contract body.
 * @param {object|null} arc
 * @returns {object|null} Normalized faucet service or null when unavailable / absent
 */
function faucetFromOptionsDocument (arc) {
  if (!arc || typeof arc !== 'object') return null;
  const raw = arc.services && arc.services.faucet;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.available === false) return null;
  const network = String(raw.network || '').toLowerCase();
  if (network && !isFaucetNetwork(network)) return null;
  const endpointBasePath = String(raw.endpointBasePath || FAUCET_ENDPOINT).trim() || FAUCET_ENDPOINT;
  return Object.assign({}, raw, {
    available: true,
    network: network || 'regtest',
    endpointBasePath,
    maxAmountSats: Number(raw.maxAmountSats) > 0 ? Number(raw.maxAmountSats) : FAUCET_MAX_SATS,
    defaultAmountSats: Number(raw.defaultAmountSats) > 0
      ? Number(raw.defaultAmountSats)
      : FAUCET_DEFAULT_SATS
  });
}

const FAUCET_LIMIT_PER_ADDRESS = 10;
const FAUCET_LIMIT_TOTAL = 120;
const FAUCET_WINDOW_MS = 60 * 60 * 1000;

/**
 * Hourly limits for the open faucet: per client address and for the whole Hub.
 * @param {object} [opts]
 * @param {number} [opts.perAddress]
 * @param {number} [opts.total]
 * @param {number} [opts.windowMs]
 * @param {Function} [opts.now]
 * @returns {{ take: Function }} `take(address)` → null, or a refusal message
 */
function createFaucetLimiter (opts = {}) {
  const perAddress = Number(opts.perAddress) || FAUCET_LIMIT_PER_ADDRESS;
  const total = Number(opts.total) || FAUCET_LIMIT_TOTAL;
  const windowMs = Number(opts.windowMs) || FAUCET_WINDOW_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  let since = now();
  let count = 0;
  let hits = new Map();
  return {
    take (address) {
      const t = now();
      if (t - since >= windowMs) {
        since = t;
        count = 0;
        hits = new Map();
      }
      const key = String(address || 'unknown');
      const mine = hits.get(key) || 0;
      if (mine >= perAddress) return 'Faucet limit reached for your address; try again within the hour.';
      if (count >= total) return 'Faucet is busy; try again within the hour.';
      hits.set(key, mine + 1);
      count += 1;
      return null;
    }
  };
}

module.exports = {
  FAUCET_LIMIT_PER_ADDRESS,
  FAUCET_LIMIT_TOTAL,
  createFaucetLimiter,
  FAUCET_MAX_SATS,
  FAUCET_DEFAULT_SATS,
  FAUCET_ENDPOINT,
  FAUCET_SOURCE,
  isFaucetNetwork,
  buildFaucetServiceDescriptor,
  faucetFromOptionsDocument
};
