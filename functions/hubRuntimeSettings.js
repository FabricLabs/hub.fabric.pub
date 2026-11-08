'use strict';

/**
 * @fileoverview The settings a Hub process runs with: `settings/local.js`,
 * then first-time setup (`stores/hub/STATE` `settings`), then env overrides,
 * desktop paths, the Peer bind, and the operator key. `scripts/hub.js` starts
 * the Hub with them; the `hub` CLI uses the same resolution so it derives the
 * same identity key (admin tokens) and store paths as the Hub it configures.
 */

const fs = require('fs');
const path = require('path');

const Key = require('@fabric/core/types/key');
const { applyHubBitcoinRuntimeFromSetup } = require('./hubBitcoinSetup');
const { isHttpSharedModeEnabled, applySharedModeWebsocketGate } = require('./httpSharedMode');
const { applyTorSetup } = require('./hubTor');
const { hubServerKeys } = require('./hubAccount');

let resolveFabricPeerInterface;
try {
  ({ resolveFabricPeerInterface } = require('@fabric/core/functions/fabricListenInterface'));
} catch (_) {
  resolveFabricPeerInterface = null;
}

// Default RPC port per Bitcoin network (bitcoind standard ports)
function defaultBitcoinRpcPort (network) {
  const n = String(network || 'mainnet').toLowerCase();
  if (n === 'regtest') return 18443;
  if (n === 'testnet') return 18332;
  if (n === 'signet') return 38332;
  return 8332;
}

function bitcoinDataDirForNetwork (root, network) {
  const n = String(network || 'regtest').toLowerCase();
  const rel = {
    mainnet: path.join('stores', 'bitcoin'),
    testnet: path.join('stores', 'bitcoin-testnet'),
    testnet4: path.join('stores', 'bitcoin-testnet4'),
    signet: path.join('stores', 'bitcoin-signet'),
    regtest: path.join('stores', 'bitcoin-regtest'),
    playnet: path.join('stores', 'bitcoin-playnet')
  }[n] || path.join('stores', 'bitcoin-regtest');
  return path.join(root, rel);
}

/**
 * Setup map (`STATE.settings`) of the store under `userDataRoot`, or `{}`.
 * @param {string} statePath
 * @returns {Object}
 */
function readSetupMap (statePath) {
  try {
    if (!fs.existsSync(statePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const candidate = parsed && typeof parsed === 'object' ? parsed.settings : null;
    return candidate && typeof candidate === 'object' ? candidate : {};
  } catch (_) {
    return {};
  }
}

function keyBagEmpty (bag) {
  if (!bag || typeof bag !== 'object') return true;
  const xprv = String(bag.xprv || '').trim();
  const seed = String(bag.seed || '').trim();
  const mnemonic = String(bag.mnemonic || '').trim();
  return !(xprv || seed || mnemonic);
}

function keyBagHasAny (bag) {
  return !keyBagEmpty(bag) || !!String((bag && bag.xpub) || '').trim();
}

/**
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {string} [opts.userDataRoot] Default `FABRIC_HUB_USER_DATA`, else the working directory.
 * @param {Object} [opts.setup] Setup map to use instead of the one in STATE (e.g. answers not saved yet).
 * @param {function(...*)} [opts.log]
 * @returns {{ settings: Object, setup: Object, statePath: string, userDataRoot: string }}
 */
function resolveHubRuntimeSettings (opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || ((...args) => console.log(...args));
  const userDataRoot = opts.userDataRoot || env.FABRIC_HUB_USER_DATA || process.cwd();
  const base = require('../settings/local');
  // Copies of the objects setup mutates, so the cached module stays as loaded.
  let settings = Object.assign({}, base, {
    bitcoin: Object.assign({}, base.bitcoin),
    lightning: Object.assign({}, base.lightning)
  });

  // Merge setup settings from internal Hub STATE store (`settings`).
  const statePath = path.join(userDataRoot, 'stores', 'hub', 'STATE');
  const setup = opts.setup && typeof opts.setup === 'object' ? opts.setup : readSetupMap(statePath);
  try {
    if (setup && typeof setup === 'object' && Object.keys(setup).length) {
      const parseVal = (v) => {
        if (v === undefined || v === null) return undefined;
        if (typeof v === 'string') {
          if (v === 'true') return true;
          if (v === 'false') return false;
          const n = Number(v);
          if (!isNaN(n) && String(n) === v) return n;
          return v;
        }
        return v;
      };
      if (setup.BITCOIN_NETWORK || setup.BITCOIN_MANAGED !== undefined || setup.BITCOIN_PRESET || setup.BITCOIN_PRUNE != null) {
        settings = { ...settings };
        applyHubBitcoinRuntimeFromSetup(settings, setup);
      }
      if (setup.BITCOIN_MANAGED !== undefined) {
        const managed = parseVal(setup.BITCOIN_MANAGED);
        settings = { ...settings, bitcoin: { ...settings.bitcoin, managed: managed !== false } };
        if (managed === false) {
          const network = setup.BITCOIN_NETWORK || settings.bitcoin?.network || 'mainnet';
          const rpcPort = parseVal(setup.BITCOIN_RPC_PORT);
          settings = {
            ...settings,
            bitcoin: {
              ...settings.bitcoin,
              host: parseVal(setup.BITCOIN_HOST) || '127.0.0.1',
              rpcport: Number(rpcPort) || defaultBitcoinRpcPort(network),
              username: parseVal(setup.BITCOIN_USERNAME) || '',
              password: parseVal(setup.BITCOIN_PASSWORD) || ''
            }
          };
        }
      }
      if (setup.LIGHTNING_MANAGED !== undefined || setup.LIGHTNING_SOCKET) {
        settings = { ...settings, lightning: settings.lightning || {} };
        if (setup.LIGHTNING_MANAGED !== undefined) {
          settings.lightning.managed = parseVal(setup.LIGHTNING_MANAGED) !== false;
        }
        if (parseVal(setup.LIGHTNING_MANAGED) === false && setup.LIGHTNING_SOCKET) {
          settings.lightning.socketPath = parseVal(setup.LIGHTNING_SOCKET) || setup.LIGHTNING_SOCKET;
        }
      }
      // LAN / shared HTTP: initial bind only when env does not override (runtime toggles use hub rebind).
      if (setup.HTTP_SHARED_MODE !== undefined && !env.FABRIC_HUB_INTERFACE && !env.INTERFACE) {
        const shared = parseVal(setup.HTTP_SHARED_MODE);
        const bindAll = isHttpSharedModeEnabled(shared);
        settings = {
          ...settings,
          http: {
            ...(settings.http || {}),
            interface: bindAll ? '0.0.0.0' : '127.0.0.1'
          }
        };
        if (typeof applySharedModeWebsocketGate === 'function') {
          settings = applySharedModeWebsocketGate(settings, { bindAll, env });
        }
      }
      if (setup.BITCOIN_ADDNODES || setup.FABRIC_PEERS) {
        settings = require('./hubNetworkJoin').applyNetworkJoinFromSetup({ ...settings }, setup);
      }
      settings = { ...settings, tor: applyTorSetup(settings, setup, env) };
    }
  } catch (e) {
    // Ignore; use defaults from local.js
  }

  // Explicit Bitcoin env wins over first-time setup (e.g. `npm run start:mainnet-local` while settings still says regtest).
  if (env.FABRIC_BITCOIN_NETWORK && String(env.FABRIC_BITCOIN_NETWORK).trim()) {
    settings = {
      ...settings,
      bitcoin: {
        ...settings.bitcoin,
        network: String(env.FABRIC_BITCOIN_NETWORK).trim()
      }
    };
  }
  if (Object.prototype.hasOwnProperty.call(env, 'FABRIC_BITCOIN_MANAGED') && String(env.FABRIC_BITCOIN_MANAGED).trim() !== '') {
    const v = String(env.FABRIC_BITCOIN_MANAGED).toLowerCase();
    const managed = v !== 'false' && v !== '0';
    settings = {
      ...settings,
      bitcoin: {
        ...settings.bitcoin,
        managed
      }
    };
  }

  // Desktop (Electron): default HTTP to loopback unless operator set HTTP_SHARED_MODE in settings.
  // Without this, settings/local.js default interface would be 0.0.0.0. CLI/dev without FABRIC_HUB_USER_DATA keeps LAN-open default.
  if (env.FABRIC_HUB_USER_DATA && !env.FABRIC_HUB_INTERFACE && !env.INTERFACE) {
    const sharedDefined = setup && Object.prototype.hasOwnProperty.call(setup, 'HTTP_SHARED_MODE');
    if (!sharedDefined) {
      settings = {
        ...settings,
        http: { ...(settings.http || {}), interface: '127.0.0.1' }
      };
    }
  }

  // Desktop: a developer node on the public playnet (Fabric seeds + regtest addnode).
  if (env.FABRIC_HUB_USER_DATA) {
    settings = require('./hubNetworkJoin').applyDesktopPlaynetDefaults({ ...settings }, setup || {});
  }

  // Electron / packaged desktop: writable stores + absolute bitcoind datadir under userData
  if (env.FABRIC_HUB_USER_DATA) {
    const u = env.FABRIC_HUB_USER_DATA;
    const net = (settings.bitcoin && settings.bitcoin.network) || 'regtest';
    const hubStore = path.join(u, 'stores', 'hub');
    settings = {
      ...settings,
      path: hubStore,
      fs: { ...settings.fs, path: hubStore },
      peersDb: env.FABRIC_HUB_PEERS_DB || path.join(hubStore, 'peers'),
      bitcoin: {
        ...settings.bitcoin,
        datadir: bitcoinDataDirForNetwork(u, net)
      },
      lightning: {
        ...(settings.lightning || {}),
        datadir: path.join(u, 'stores', 'lightning', 'hub')
      }
    };
  }

  // Fabric Peer bind: FABRIC_INTERFACE / FABRIC_PEER_INTERFACE (canonical helper).
  if (typeof resolveFabricPeerInterface === 'function') {
    settings = {
      ...settings,
      interface: resolveFabricPeerInterface({
        interface: settings.interface,
        env
      })
    };
  }

  try {
    const { exclusiveOperatorKeySettings, resolveFabricOperatorKeySettings } = require('@fabric/core/functions/fabricOperatorIdentity');
    const exclusive = exclusiveOperatorKeySettings(settings.key);
    if (exclusive) {
      settings = { ...settings, key: exclusive };
    } else if (keyBagEmpty(settings.key)) {
      const resolved = resolveFabricOperatorKeySettings(env, {
        allowWalletFallback: true,
        password: env.FABRIC_PASSWORD
      });
      if (resolved && resolved.key) {
        settings = { ...settings, key: resolved.key };
        log('[FABRIC:HUB] Identity from', resolved.source, '(fabric setup Environment)');
      }
    }
  } catch (_) {
    if (keyBagEmpty(settings.key)) {
      try {
        const { loadIdentityFromWalletFile } = require('@fabric/core/functions/fabricWalletIdentity');
        const fromWallet = loadIdentityFromWalletFile({ password: env.FABRIC_PASSWORD });
        if (fromWallet && fromWallet.xprv) {
          settings = {
            ...settings,
            key: { xprv: fromWallet.xprv, xpub: fromWallet.xpub || null }
          };
          log('[FABRIC:HUB] Identity loaded from ~/.fabric/wallet.json');
        }
      } catch (__) { /* older core pin or locked wallet */ }
    }
  }

  return { settings, setup, statePath, userDataRoot };
}

/**
 * Path of the Hub root key file for these settings.
 * @param {Object} settings
 * @param {string} userDataRoot
 * @returns {string}
 */
function hubRootKeyFile (settings, userDataRoot) {
  const { rootKeyPath } = require('./hubRootKey');
  return rootKeyPath(settings.path || path.join(userDataRoot, 'stores', 'hub'));
}

/**
 * Without an operator key, the Hub keeps one root key in its store
 * (`functions/hubRootKey.js`). Returns settings carrying it.
 * @param {Object} settings
 * @param {Object} [opts]
 * @param {string} [opts.userDataRoot]
 * @param {boolean} [opts.create=true] Create the key file when there is none.
 * @returns {{ settings: Object, source: string, filePath: (string|null), created: boolean, sealed: boolean }}
 */
function withPersistentHubKey (settings, opts = {}) {
  if (keyBagHasAny(settings.key)) return { settings, source: 'operator', filePath: null, created: false, sealed: false };
  const { loadOrCreateHubRootKey, readHubRootKey } = require('./hubRootKey');
  const filePath = hubRootKeyFile(settings, opts.userDataRoot || process.cwd());
  if (opts.create === false) {
    const xprv = readHubRootKey(filePath);
    if (!xprv) return { settings, source: 'none', filePath, created: false, sealed: false };
    return { settings: { ...settings, key: { xprv } }, source: 'store', filePath, created: false, sealed: false };
  }
  const result = loadOrCreateHubRootKey({ filePath });
  return { settings: { ...settings, key: { xprv: result.xprv } }, source: 'store', filePath, created: result.created, sealed: result.sealed };
}

/**
 * The Hub's identity key (admin tokens, Fabric messages) for these settings, or null.
 * @param {Object} settings Resolved settings carrying `key`.
 * @returns {?Object} `@fabric/core` Key
 */
function hubIdentityKey (settings) {
  if (!keyBagHasAny(settings.key)) return null;
  return hubServerKeys({ _rootKey: new Key(settings.key), settings }).identity;
}

module.exports = {
  bitcoinDataDirForNetwork,
  defaultBitcoinRpcPort,
  hubIdentityKey,
  hubRootKeyFile,
  keyBagHasAny,
  readSetupMap,
  resolveHubRuntimeSettings,
  withPersistentHubKey
};
