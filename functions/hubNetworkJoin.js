'use strict';

/**
 * @fileoverview Joining a private network: Bitcoin `addnode` targets and Fabric
 * peers kept in Hub setup (`STATE` settings), applied at boot and live, plus the
 * `FabricLocalNetworkProfile` written by `scripts/deploy.js`.
 */

const SETTING_ADDNODES = 'BITCOIN_ADDNODES';
const SETTING_PEERS = 'FABRIC_PEERS';
const PROFILE_TYPE = 'FabricLocalNetworkProfile';

const HOST_PORT = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]):(\d{1,5})$/i;

/**
 * Parse a list of `host:port` targets (array, JSON array string, or comma/whitespace list).
 * Throws on any malformed entry so a typo is never silently dropped.
 * @param {*} value
 * @returns {string[]}
 */
function parseHostPortList (value) {
  if (value == null || value === '') return [];
  let items = value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('[')) {
      try {
        items = JSON.parse(s);
      } catch (_) {
        throw new Error('expected a JSON array of host:port');
      }
    } else {
      items = s.split(/[\s,]+/);
    }
  }
  if (!Array.isArray(items)) throw new Error('expected a list of host:port');
  const out = [];
  for (const raw of items) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const m = HOST_PORT.exec(s);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 65535) throw new Error(`not a host:port: ${s.slice(0, 80)}`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Apply saved network-join settings onto Hub settings (mutates and returns `settings`).
 * Saved Fabric peers replace the default seeds, so a private network does not dial public Hubs.
 * @param {Object} settings Hub settings
 * @param {Object} setup STATE settings map
 * @returns {Object}
 */
function applyNetworkJoinFromSetup (settings, setup = {}) {
  const root = settings && typeof settings === 'object' ? settings : {};
  let addnodes = [];
  let peers = [];
  try { addnodes = parseHostPortList(setup[SETTING_ADDNODES]); } catch (_) {}
  try { peers = parseHostPortList(setup[SETTING_PEERS]); } catch (_) {}
  if (addnodes.length) {
    root.bitcoin = Object.assign({}, root.bitcoin);
    const existing = Array.isArray(root.bitcoin.p2pAddNodes) ? root.bitcoin.p2pAddNodes : [];
    root.bitcoin.p2pAddNodes = [...new Set([...existing, ...addnodes])];
    root.bitcoin.skipPlaynetPeer = true;
  }
  if (peers.length) root.peers = peers;
  return root;
}

/**
 * Validate a network profile and turn it into setup settings.
 * @param {Object|string} profile `network-profile.json` contents
 * @param {Object} [opts]
 * @param {string} [opts.network] This Hub's Bitcoin network (must match the profile)
 * @returns {{ network: string, settings: Object, instances: Object[] }}
 */
function profileToSettings (profile, opts = {}) {
  const p = typeof profile === 'string' ? JSON.parse(profile) : profile;
  if (!p || p.type !== PROFILE_TYPE) throw new Error(`not a ${PROFILE_TYPE}`);
  const network = String((p.bitcoin && p.bitcoin.network) || p.network || '').trim().toLowerCase();
  if (!network) throw new Error('profile has no Bitcoin network');
  if (opts.network && String(opts.network).toLowerCase() !== network) {
    throw new Error(`profile is for ${network}; this Hub runs ${opts.network}`);
  }
  const addnodes = parseHostPortList((p.bitcoin && p.bitcoin.addnode) || []);
  const peers = parseHostPortList((p.fabric && p.fabric.peers) || []);
  if (!addnodes.length && !peers.length) throw new Error('profile lists no Bitcoin or Fabric peers');
  const instances = (Array.isArray(p.instances) ? p.instances : []).map((i) => ({
    name: String(i.name || ''),
    label: String(i.label || i.name || ''),
    signer: i.signer === true,
    http: i.http ? String(i.http) : null,
    pubkey: i.pubkey ? String(i.pubkey) : null
  }));
  return {
    network,
    settings: { [SETTING_ADDNODES]: addnodes, [SETTING_PEERS]: peers },
    instances
  };
}

module.exports = {
  SETTING_ADDNODES,
  SETTING_PEERS,
  PROFILE_TYPE,
  parseHostPortList,
  applyNetworkJoinFromSetup,
  profileToSettings
};
