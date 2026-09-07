'use strict';

/**
 * Beginner Bitcoin Core knobs for Hub first-time setup.
 *
 * Option set follows Jameson Lopp’s Bitcoin Core Config Generator presets
 * (https://jlopp.github.io/bitcoin-core-config-generator / pruned, low-bandwidth,
 * Lightning, Raspberry Pi, regtest) rather than exposing all 160+ Core flags.
 */

/** Minimum spinner time after Complete Setup before handing off to the Hub UI. */
const HUB_SETUP_APPLY_MIN_MS = 2500;

const HUB_BITCOIN_SETUP_KEYS = Object.freeze([
  'BITCOIN_PRESET',
  'BITCOIN_PRUNE',
  'BITCOIN_TXINDEX',
  'BITCOIN_TXRELAY',
  'BITCOIN_DBCACHE',
  'BITCOIN_LISTEN',
  'BITCOIN_MAXCONNECTIONS',
  'BITCOIN_MAXUPLOADTARGET'
]);

/**
 * Hub maps `txrelay: false` to Core `-blocksonly=1` (29.x has no `-txrelay` flag).
 * @type {Object<string, { label: string, description: string, network: string, prune: number, txindex: boolean, txrelay: boolean, listen: boolean, dbcache: number, maxconnections: number, maxuploadtarget: number }>}
 */
const HUB_BITCOIN_PRESETS = Object.freeze({
  'local-dev': {
    label: 'Local development (regtest)',
    description: 'Private chain for this machine. Matches Lopp’s Regtest class: no public P2P, txindex on, no prune. Transaction relay is off.',
    network: 'regtest',
    prune: 0,
    txindex: true,
    txrelay: false,
    listen: false,
    dbcache: 450,
    maxconnections: 16,
    maxuploadtarget: 0
  },
  signet: {
    label: 'Signet',
    description: 'Public test coins with ~1 minute blocks. Modest prune so a first node stays small. Transaction relay is off.',
    network: 'signet',
    prune: 2200,
    txindex: false,
    txrelay: false,
    listen: true,
    dbcache: 450,
    maxconnections: 40,
    maxuploadtarget: 0
  },
  pruned: {
    label: 'Pruned public node',
    description: 'Lopp Pruned class: keep roughly 5 GB of blocks. Cannot enable txindex or Lightning. Transaction relay is off.',
    network: 'mainnet',
    prune: 5500,
    txindex: false,
    txrelay: false,
    listen: true,
    dbcache: 450,
    maxconnections: 40,
    maxuploadtarget: 0
  },
  full: {
    label: 'Full node (Lightning-ready)',
    description: 'Lopp Lightning class: archival blocks plus txindex. Needs hundreds of GB on mainnet. Transaction relay stays off until Lightning is enabled.',
    network: 'mainnet',
    prune: 0,
    txindex: true,
    txrelay: false,
    listen: true,
    dbcache: 2048,
    maxconnections: 125,
    maxuploadtarget: 0
  },
  'low-bandwidth': {
    label: 'Low bandwidth',
    description: 'Lopp Low Bandwidth class: prune plus a daily upload cap (MiB/day). Transaction relay is off.',
    network: 'mainnet',
    prune: 2200,
    txindex: false,
    txrelay: false,
    listen: true,
    dbcache: 100,
    maxconnections: 16,
    maxuploadtarget: 1440
  }
});

function isExplicitFalse (value) {
  if (value === false || value === 0) return true;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'false' || s === '0' || s === 'no' || s === 'off';
  }
  return false;
}

function isExplicitTrue (value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return false;
}

function defaultBitcoinRpcPort (network) {
  const n = String(network || 'mainnet').toLowerCase();
  if (n === 'regtest') return 18443;
  if (n === 'testnet' || n === 'testnet3') return 18332;
  if (n === 'signet') return 38332;
  return 8332;
}

function parseBool (value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function parseIntInRange (value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (typeof min === 'number' && out < min) out = min;
  if (typeof max === 'number' && out > max) out = max;
  return out;
}

/**
 * Core prune target in MiB. 0 = disabled (txindex). Values 1–549 are invalid; bump to 550.
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function parsePruneMib (value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 550) return 550;
  return n;
}

function presetById (id) {
  const key = String(id || '').trim();
  if (HUB_BITCOIN_PRESETS[key]) return Object.assign({ id: key }, HUB_BITCOIN_PRESETS[key]);
  return Object.assign({ id: 'local-dev' }, HUB_BITCOIN_PRESETS['local-dev']);
}

/**
 * Normalize onboarding / POST /settings Bitcoin fields.
 * @param {Object} [body]
 * @returns {{
 *   preset: string,
 *   network: string,
 *   prune: number,
 *   txindex: boolean,
 *   txrelay: boolean,
 *   listen: boolean,
 *   dbcache: number,
 *   maxconnections: number,
 *   maxuploadtarget: number,
 *   settingsKeys: Object
 * }}
 */
function parseBitcoinSetupFromBody (body) {
  const src = body && typeof body === 'object' ? body : {};
  const presetId = String(src.BITCOIN_PRESET || src.bitcoinPreset || 'local-dev').trim() || 'local-dev';
  const base = presetById(presetId);
  const prune = parsePruneMib(src.BITCOIN_PRUNE ?? src.bitcoinPrune, base.prune);
  let txindex = parseBool(src.BITCOIN_TXINDEX ?? src.bitcoinTxindex, base.txindex);
  if (prune > 0) txindex = false;
  const lightning = parseBool(src.LIGHTNING_MANAGED ?? src.lightningManaged, false);
  if (lightning) {
    // Core Lightning needs txindex and a mempool; prune and blocksonly are incompatible.
    return packSetup({
      preset: presetId,
      network: String(src.BITCOIN_NETWORK || src.bitcoinNetwork || base.network || 'regtest'),
      prune: 0,
      txindex: true,
      txrelay: true,
      listen: parseBool(src.BITCOIN_LISTEN ?? src.bitcoinListen, base.listen),
      dbcache: parseIntInRange(src.BITCOIN_DBCACHE ?? src.bitcoinDbcache, base.dbcache, 4, 16384),
      maxconnections: parseIntInRange(src.BITCOIN_MAXCONNECTIONS ?? src.bitcoinMaxconnections, base.maxconnections, 4, 1000),
      maxuploadtarget: parseIntInRange(src.BITCOIN_MAXUPLOADTARGET ?? src.bitcoinMaxuploadtarget, base.maxuploadtarget, 0, 1000000)
    });
  }
  return packSetup({
    preset: presetId,
    network: String(src.BITCOIN_NETWORK || src.bitcoinNetwork || base.network || 'regtest'),
    prune,
    txindex,
    txrelay: parseBool(src.BITCOIN_TXRELAY ?? src.bitcoinTxrelay, base.txrelay),
    listen: parseBool(src.BITCOIN_LISTEN ?? src.bitcoinListen, base.listen),
    dbcache: parseIntInRange(src.BITCOIN_DBCACHE ?? src.bitcoinDbcache, base.dbcache, 4, 16384),
    maxconnections: parseIntInRange(src.BITCOIN_MAXCONNECTIONS ?? src.bitcoinMaxconnections, base.maxconnections, 4, 1000),
    maxuploadtarget: parseIntInRange(src.BITCOIN_MAXUPLOADTARGET ?? src.bitcoinMaxuploadtarget, base.maxuploadtarget, 0, 1000000)
  });
}

function packSetup (fields) {
  return {
    preset: fields.preset,
    network: fields.network,
    prune: fields.prune,
    txindex: fields.txindex,
    txrelay: fields.txrelay === true,
    listen: fields.listen,
    dbcache: fields.dbcache,
    maxconnections: fields.maxconnections,
    maxuploadtarget: fields.maxuploadtarget,
    settingsKeys: {
      BITCOIN_PRESET: fields.preset,
      BITCOIN_PRUNE: fields.prune,
      BITCOIN_TXINDEX: fields.txindex,
      BITCOIN_TXRELAY: fields.txrelay === true,
      BITCOIN_DBCACHE: fields.dbcache,
      BITCOIN_LISTEN: fields.listen,
      BITCOIN_MAXCONNECTIONS: fields.maxconnections,
      BITCOIN_MAXUPLOADTARGET: fields.maxuploadtarget
    }
  };
}

/**
 * Map persisted BITCOIN_* knobs onto Hub `settings.bitcoin` (runtime + next boot).
 * @param {Object} hubSettings Hub `this.settings` (mutated)
 * @param {Object} setup parseBitcoinSetupFromBody result or listSettings() map
 * @returns {Object} hubSettings.bitcoin
 */
function applyBitcoinSetupToSettings (hubSettings, setup) {
  const root = hubSettings && typeof hubSettings === 'object' ? hubSettings : {};
  if (!root.bitcoin || typeof root.bitcoin !== 'object') root.bitcoin = {};
  const parsed = setup && setup.settingsKeys
    ? setup
    : parseBitcoinSetupFromBody(setup && setup.BITCOIN_NETWORK != null ? setup : Object.assign({}, setup, {
      BITCOIN_NETWORK: setup && (setup.network || setup.BITCOIN_NETWORK)
    }));
  const btc = root.bitcoin;
  if (parsed.network) btc.network = parsed.network;
  btc.listen = parsed.listen !== false;
  if (!btc.constraints || typeof btc.constraints !== 'object') btc.constraints = {};
  if (!btc.constraints.storage || typeof btc.constraints.storage !== 'object') btc.constraints.storage = {};
  btc.constraints.storage.size = parsed.prune > 0 ? parsed.prune : 0;
  btc.txindex = parsed.prune > 0 ? false : parsed.txindex !== false;
  btc.txrelay = parsed.txrelay === true;
  btc.dbcache = parsed.dbcache;
  btc.maxconnections = parsed.maxconnections;
  btc.maxuploadtarget = parsed.maxuploadtarget;
  btc.bitcoinExtraParams = mergeBitcoinExtraParams(
    parsed.network,
    buildBitcoinExtraParams(parsed),
    Array.isArray(btc.bitcoinExtraParams) ? btc.bitcoinExtraParams : []
  );
  return btc;
}

function hasBitcoinKnobFields (src) {
  if (!src || typeof src !== 'object') return false;
  return src.BITCOIN_PRESET != null ||
    src.BITCOIN_PRUNE != null ||
    src.BITCOIN_LISTEN != null ||
    src.BITCOIN_TXINDEX != null ||
    src.BITCOIN_TXRELAY != null ||
    src.BITCOIN_DBCACHE != null ||
    src.BITCOIN_MAXCONNECTIONS != null ||
    src.BITCOIN_MAXUPLOADTARGET != null;
}

/**
 * Apply first-time setup map (STATE.settings) onto Hub runtime `settings.bitcoin`.
 * @param {Object} hubSettings
 * @param {Object} setupMap
 * @returns {Object}
 */
function applyHubBitcoinRuntimeFromSetup (hubSettings, setupMap) {
  const root = hubSettings && typeof hubSettings === 'object' ? hubSettings : {};
  if (!root.bitcoin || typeof root.bitcoin !== 'object') root.bitcoin = {};
  const src = setupMap && typeof setupMap === 'object' ? setupMap : {};
  if (src.BITCOIN_NETWORK || src.bitcoinNetwork) {
    root.bitcoin.network = src.BITCOIN_NETWORK || src.bitcoinNetwork;
  }
  if (hasBitcoinKnobFields(src)) {
    const overlay = Object.assign({}, src);
    if (overlay.BITCOIN_TXRELAY == null && overlay.bitcoinTxrelay == null) {
      // Older STATE maps never stored this key; keep Core’s default (relay on).
      overlay.BITCOIN_TXRELAY = true;
    }
    applyBitcoinSetupToSettings(root, overlay);
  }
  if (src.BITCOIN_MANAGED !== undefined) {
    root.bitcoin.managed = !isExplicitFalse(src.BITCOIN_MANAGED);
  }
  if (root.bitcoin.managed === false) {
    root.bitcoin.host = src.BITCOIN_HOST || src.bitcoinHost || root.bitcoin.host || '127.0.0.1';
    const rpc = src.BITCOIN_RPC_PORT || src.bitcoinRpcPort;
    root.bitcoin.rpcport = Number(rpc) || defaultBitcoinRpcPort(root.bitcoin.network);
    if (src.BITCOIN_USERNAME != null) root.bitcoin.username = src.BITCOIN_USERNAME;
    if (src.BITCOIN_PASSWORD != null) root.bitcoin.password = src.BITCOIN_PASSWORD;
  }
  if (src.LIGHTNING_MANAGED !== undefined) {
    if (!root.lightning || typeof root.lightning !== 'object') root.lightning = {};
    root.lightning.managed = !isExplicitFalse(src.LIGHTNING_MANAGED);
    if (root.lightning.managed === false && (src.LIGHTNING_SOCKET || src.lightningSocket)) {
      root.lightning.socketPath = src.LIGHTNING_SOCKET || src.lightningSocket;
    }
  }
  return root.bitcoin;
}

/**
 * Keep Hub-managed regtest `-dnsseed=0` while applying operator extra flags.
 * @param {string} network
 * @param {string[]} extra
 * @param {string[]} [existing]
 * @returns {string[]}
 */
function mergeBitcoinExtraParams (network, extra, existing) {
  const out = [];
  const seen = new Set();
  const push = (flag) => {
    const s = String(flag || '').trim();
    if (!s) return;
    const key = s.split('=')[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  if (String(network || '').toLowerCase() === 'regtest') push('-dnsseed=0');
  (Array.isArray(extra) ? extra : []).forEach(push);
  (Array.isArray(existing) ? existing : []).forEach(push);
  return out;
}

/**
 * Extra bitcoind argv consumed by @fabric/core `Bitcoin.createLocalNode`.
 * @param {Object} parsed
 * @returns {string[]}
 */
function buildBitcoinExtraParams (parsed) {
  const extra = [];
  // Core 29.x: `-blocksonly` rejects txs from network peers (RPC/wallet still work).
  if (!parsed.txrelay) extra.push('-blocksonly=1');
  if (parsed.dbcache) extra.push(`-dbcache=${parsed.dbcache}`);
  if (parsed.maxconnections) extra.push(`-maxconnections=${parsed.maxconnections}`);
  if (parsed.maxuploadtarget > 0) extra.push(`-maxuploadtarget=${parsed.maxuploadtarget}`);
  return extra;
}

function bitcoinPresetSelectOptions () {
  return Object.keys(HUB_BITCOIN_PRESETS).map((key) => ({
    key,
    value: key,
    text: HUB_BITCOIN_PRESETS[key].label
  }));
}

/**
 * Flatten POST /settings body into persisted first-time setup keys.
 * @param {Object} [body]
 * @returns {Object}
 */
function buildHubSetupInitialConfig (body) {
  const src = body && typeof body === 'object' ? body : {};
  const bitcoinManaged = !isExplicitFalse(src.BITCOIN_MANAGED) && !isExplicitFalse(src.bitcoinManaged);
  const lightningManaged = bitcoinManaged &&
    !isExplicitFalse(src.LIGHTNING_MANAGED) &&
    !isExplicitFalse(src.lightningManaged);
  const parsed = parseBitcoinSetupFromBody(Object.assign({}, src, {
    LIGHTNING_MANAGED: lightningManaged
  }));
  const httpShared = isExplicitTrue(src.HTTP_SHARED_MODE) || isExplicitTrue(src.httpSharedMode);
  const config = {
    NODE_NAME: src.NODE_NAME || src.nodeName || 'Hub',
    NODE_PERSONALITY: src.NODE_PERSONALITY || src.nodePersonality || JSON.stringify(['helpful']),
    NODE_TEMPERATURE: src.NODE_TEMPERATURE ?? src.nodeTemperature ?? 0,
    NODE_GOALS: src.NODE_GOALS || src.nodeGoals || JSON.stringify([]),
    BITCOIN_NETWORK: parsed.network,
    BITCOIN_MANAGED: bitcoinManaged,
    LIGHTNING_MANAGED: lightningManaged,
    DISK_ALLOCATION_MB: src.DISK_ALLOCATION_MB ?? src.diskAllocationMb ?? 1024,
    COST_PER_BYTE_SATS: src.COST_PER_BYTE_SATS ?? src.costPerByteSats ?? 0.01,
    HTTP_SHARED_MODE: httpShared,
    ...parsed.settingsKeys
  };
  if (!bitcoinManaged) {
    config.BITCOIN_HOST = src.BITCOIN_HOST || src.bitcoinHost || '127.0.0.1';
    config.BITCOIN_RPC_PORT = src.BITCOIN_RPC_PORT || src.bitcoinRpcPort || String(defaultBitcoinRpcPort(parsed.network));
    config.BITCOIN_USERNAME = src.BITCOIN_USERNAME || src.bitcoinUsername || '';
    config.BITCOIN_PASSWORD = src.BITCOIN_PASSWORD || src.bitcoinPassword || '';
  }
  if (!lightningManaged) {
    config.LIGHTNING_SOCKET = src.LIGHTNING_SOCKET || src.lightningSocket || '';
  }
  return config;
}

module.exports = {
  HUB_BITCOIN_PRESETS,
  HUB_BITCOIN_SETUP_KEYS,
  HUB_SETUP_APPLY_MIN_MS,
  applyBitcoinSetupToSettings,
  applyHubBitcoinRuntimeFromSetup,
  bitcoinPresetSelectOptions,
  buildHubSetupInitialConfig,
  buildBitcoinExtraParams,
  defaultBitcoinRpcPort,
  hasBitcoinKnobFields,
  isExplicitFalse,
  isExplicitTrue,
  mergeBitcoinExtraParams,
  parseBitcoinSetupFromBody,
  parsePruneMib,
  presetById
};
