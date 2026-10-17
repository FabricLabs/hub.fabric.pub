'use strict';

/**
 * @fileoverview Default Fabric seed peers for a Hub whose caller did not set
 * `peers`. Pure — no Hub construction needed to test it.
 */

/** Public playnet seeds every Hub dials unless the caller names its own list. */
const DEFAULT_HUB_SEED_PEERS = Object.freeze(['hub.fabric.pub:7777', 'relay.goon.vc:7777']);

/**
 * `host:port` of a peer entry, lower-cased, with any `pubkey@` prefix dropped.
 * @private
 * @param {string} entry
 * @returns {string}
 */
function peerHostPort (entry) {
  return String(entry || '').replace(/^[^@]+@/, '').trim().toLowerCase();
}

/**
 * Append the default seeds missing from `peers`. An explicit caller list
 * (including `[]`) is returned unchanged.
 * @param {Array<string>} peers merged settings peers
 * @param {Object} [opts]
 * @param {boolean} [opts.callerSetPeers] caller passed `peers` explicitly
 * @param {Array<string>} [opts.seeds] seeds to ensure (default {@link DEFAULT_HUB_SEED_PEERS})
 * @returns {Array<string>} new array
 */
function withDefaultSeedPeers (peers, opts = {}) {
  const list = Array.isArray(peers) ? peers.slice() : [];
  if (opts.callerSetPeers) return list;
  const seeds = Array.isArray(opts.seeds) ? opts.seeds : DEFAULT_HUB_SEED_PEERS;
  for (const seed of seeds) {
    const want = peerHostPort(seed);
    if (!list.some((p) => peerHostPort(p) === want)) list.push(seed);
  }
  return list;
}

module.exports = {
  DEFAULT_HUB_SEED_PEERS,
  withDefaultSeedPeers
};
