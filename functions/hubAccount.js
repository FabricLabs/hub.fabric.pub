'use strict';

/**
 * @fileoverview The Hub operator's keys per (account, network), from the
 * operator master key (`hub._rootKey`) through `@fabric/core/functions/accountKeys`:
 * identity `m/44'/F'/n'/0/0`, wallet `m/84'/B'/n'` + `m/44'/B'/n'`, cosigner
 * `m/87'/B'/n'/0/0`. The Hub never signs with `_rootKey` itself: account 0 on
 * the Hub's network gives its own identity key (Fabric messages, attestations,
 * admin tokens — the same key the Peer uses) and its cosigner key (validator in
 * named federations and the Beacon federation).
 */

const Key = require('@fabric/core/types/key');
const { deriveAccount, normalizeAccountNetwork } = require('@fabric/core/functions/accountKeys');
const {
  fabricIdentityDerivationPath,
  bitcoinCosignerDerivationPath
} = require('@fabric/core/constants');

/**
 * Network the Hub's keys are derived for: the choice core `Peer` makes for its
 * identity (`settings.network`, then `settings.bitcoin.network`, else regtest).
 * @param {object} hub
 * @returns {string}
 */
function hubNetwork (hub) {
  const settings = (hub && hub.settings) || {};
  const raw = settings.network || (settings.bitcoin && settings.bitcoin.network) || 'regtest';
  try {
    return normalizeAccountNetwork(raw);
  } catch (_) {
    return 'regtest';
  }
}

/**
 * Keys of one account on one network, or null without a private master key.
 * @param {object} hub
 * @param {Object} [options]
 * @param {number} [options.account=0]
 * @param {string} [options.network] Defaults to the Hub's network.
 * @returns {object|null} `deriveAccount` result
 */
function hubAccount (hub, options = {}) {
  const root = hub && hub._rootKey;
  if (!root || !root.private || !root.xprv) return null;
  const account = options.account != null ? options.account : 0;
  const network = options.network || hubNetwork(hub);
  if (!hub._accountCache || hub._accountCacheRoot !== root) {
    hub._accountCache = new Map();
    hub._accountCacheRoot = root;
  }
  const key = `${network}:${account}`;
  if (hub._accountCache.has(key)) return hub._accountCache.get(key);
  let derived = null;
  try {
    derived = deriveAccount(root, { account, network });
  } catch (_) {
    derived = null;
  }
  hub._accountCache.set(key, derived);
  return derived;
}

/**
 * The Hub's own signing keys: account 0 on the Hub's network.
 * @param {object} hub
 * @returns {{ network: string, identity: (object|null), cosigner: (object|null) }}
 */
function hubServerKeys (hub) {
  const network = hubNetwork(hub);
  const root = hub && hub._rootKey;
  if (!root || !root.private || !root.xprv) return { network, identity: null, cosigner: null };
  const account = hubAccount(hub, { network });
  if (account) return { network, identity: account.identity.key, cosigner: account.cosigner.key };
  // A root that is not a master (depth > 0) still derives the same relative paths.
  const child = new Key({ xprv: String(root.xprv) });
  return {
    network,
    identity: child.derive(fabricIdentityDerivationPath(0, 0, network)),
    cosigner: child.derive(bitcoinCosignerDerivationPath(0, network))
  };
}

module.exports = {
  hubNetwork,
  hubAccount,
  hubServerKeys
};
