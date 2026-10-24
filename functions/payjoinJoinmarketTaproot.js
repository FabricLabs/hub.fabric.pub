'use strict';

/**
 * Hub-custody Taproot payjoin receive addresses for Payjoin (BIP77/78) deposit sessions.
 *
 * These are plain receive addresses held by the Hub operator key, with a
 * Beacon federation reserve leaf. They are not JoinMarket: no maker/taker
 * market is involved (that is `services/coinjoin.js`). BIP21 + `pj=` and the
 * proposal POST are unchanged.
 *
 * - `hub_taproot_v2` (default for new Taproot sessions): the Hub operator
 *   x-only key is the internal key, so the Hub spends by key path (looks like
 *   any single-key P2TR spend); one tapleaf is the federation reserve.
 * - `joinmarket_taproot_v1` (legacy, still accepted): NUMS internal key,
 *   script-path only, leaves [operator, federation reserve]. The id is kept
 *   so existing sessions and their addresses stay valid.
 *
 * The federation x-only comes from the session, Hub settings, or
 * `FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX`. Off mainnet a Hub without one
 * uses a random placeholder key it generated and saved once
 * ({@link generatePlaceholderFederationXOnly}); its private key is never kept,
 * so the reserve leaf of such an address cannot be spent by anyone. On
 * mainnet a real key is required.
 *
 * Tree shape and leaf order are part of each template's contract version.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const { payments, networks, script } = bitcoin;

bitcoin.initEccLib(ecc);

/** Same NUMS x-only internal key as federationVault / crowdfund (script-path spends only). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

const JOINMARKET_TAPROOT_CONTRACT_VERSION = 1;
/** Legacy template id (script-path only); accepted for existing sessions. */
const TEMPLATE_ID = 'joinmarket_taproot_v1';
const HUB_TAPROOT_CONTRACT_VERSION = 2;
/** Key-path capable successor. */
const HUB_TAPROOT_TEMPLATE_ID = 'hub_taproot_v2';
const TEMPLATE_IDS = Object.freeze([HUB_TAPROOT_TEMPLATE_ID, TEMPLATE_ID]);
const TEMPLATE_LABEL = 'Hub-custody Taproot payjoin receive address';

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return networks.regtest;
  if (n === 'testnet' || n === 'signet') return networks.testnet;
  return networks.bitcoin;
}

function isTestNetworkName (name = '') {
  const n = String(name || '').toLowerCase();
  return n === 'regtest' || n === 'test' || n === 'signet' || n === 'testnet';
}

function toXOnly (pubkey33) {
  if (!(pubkey33 instanceof Uint8Array) || pubkey33.length !== 33) return null;
  if (pubkey33[0] !== 0x02 && pubkey33[0] !== 0x03) return null;
  return Buffer.from(pubkey33.subarray(1, 33));
}

function asBuffer (bytes) {
  return bytes instanceof Uint8Array ? Buffer.from(bytes) : bytes;
}

function tryXOnlyHex (h) {
  const s = String(h || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  const x = Buffer.from(s, 'hex');
  return ecc.isXOnlyPoint(x) ? x : null;
}

/**
 * A random x-only key for the reserve leaf on test networks. The private key
 * is discarded: the leaf is a placeholder nobody can spend (unlike a fixed
 * well-known key, which anyone could).
 * @returns {string} 64 hex
 */
function generatePlaceholderFederationXOnly () {
  for (;;) {
    const priv = crypto.randomBytes(32);
    if (!ecc.isPrivate(priv)) continue;
    const pub = ecc.pointFromScalar(priv, true);
    priv.fill(0);
    return Buffer.from(pub.subarray(1, 33)).toString('hex');
  }
}

/**
 * Resolve the 32-byte x-only federation pubkey for the reserve leaf.
 * @param {Object} opts
 * @param {string} [opts.explicitHex] session override
 * @param {string} [opts.configHex] hub settings `payjoin.beaconFederationXOnlyHex`
 * @param {string} [opts.placeholderHex] this Hub's saved placeholder (test networks only)
 * @param {string} [opts.networkName]
 * @returns {Buffer}
 */
function resolveBeaconFederationXOnly (opts = {}) {
  const a = tryXOnlyHex(opts.explicitHex);
  if (a) return a;
  const b = tryXOnlyHex(opts.configHex);
  if (b) return b;
  const c = tryXOnlyHex(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX);
  if (c) return c;

  if (isTestNetworkName(opts.networkName)) {
    const p = tryXOnlyHex(opts.placeholderHex);
    if (p) return p;
    throw new Error('No federation key and no placeholder; the payjoin service generates one on attach.');
  }

  throw new Error(
    'Beacon federation x-only is required for a Hub Taproot payjoin address on this network. ' +
      'Set FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX (64 hex), payjoin.beaconFederationXOnlyHex in settings, ' +
      'or pass federationXOnlyHex when creating the session.'
  );
}

/** @private */
function checkKeys (opts) {
  const operatorPk = asBuffer(opts.operatorPubkeyCompressed);
  const federationX = asBuffer(opts.federationXOnly);
  if (!Buffer.isBuffer(operatorPk) || operatorPk.length !== 33) {
    throw new Error('operatorPubkeyCompressed must be a 33-byte compressed pubkey.');
  }
  const opX = toXOnly(operatorPk);
  if (!opX) throw new Error('Invalid operator compressed pubkey.');
  if (!Buffer.isBuffer(federationX) || federationX.length !== 32) {
    throw new Error('federationXOnly must be a 32-byte x-only pubkey.');
  }
  return { operatorPk, opX, federationX };
}

/**
 * Legacy `joinmarket_taproot_v1` address: NUMS internal key, leaves [operator, federation].
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {Buffer} opts.operatorPubkeyCompressed 33-byte compressed secp256k1 pubkey
 * @param {Buffer} opts.federationXOnly 32-byte x-only pubkey for reserve leaf
 */
function buildPayjoinJoinmarketTaproot (opts = {}) {
  const { operatorPk, opX, federationX } = checkKeys(opts);
  const networkName = opts.networkName || 'mainnet';

  const operatorLeaf = Buffer.from(script.compile([opX, script.OPS.OP_CHECKSIG]));
  const federationLeaf = Buffer.from(script.compile([federationX, script.OPS.OP_CHECKSIG]));
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree: [{ output: operatorLeaf }, { output: federationLeaf }],
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce address/output.');

  return {
    template: TEMPLATE_ID,
    label: `${TEMPLATE_LABEL} (legacy, script path only)`,
    contractVersion: JOINMARKET_TAPROOT_CONTRACT_VERSION,
    address: pay.address,
    network: networkName,
    operatorPubkeyCompressedHex: operatorPk.toString('hex'),
    federationXOnlyHex: federationX.toString('hex'),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
    leafOrder: ['joinmarket_operator', 'beacon_federation_reserve'],
    leaves: {
      joinmarket_operator: {
        role: 'hub_operator_single_sig',
        scriptHex: operatorLeaf.toString('hex')
      },
      beacon_federation_reserve: {
        role: 'beacon_federation_single_sig',
        scriptHex: federationLeaf.toString('hex')
      }
    }
  };
}

/**
 * `hub_taproot_v2` address: Hub operator x-only internal key (key path), one federation reserve leaf.
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {Buffer} opts.operatorPubkeyCompressed 33-byte compressed secp256k1 pubkey
 * @param {Buffer} opts.federationXOnly 32-byte x-only pubkey for reserve leaf
 */
function buildPayjoinHubTaproot (opts = {}) {
  const { operatorPk, opX, federationX } = checkKeys(opts);
  const networkName = opts.networkName || 'mainnet';

  const federationLeaf = Buffer.from(script.compile([federationX, script.OPS.OP_CHECKSIG]));
  const pay = payments.p2tr({
    internalPubkey: opX,
    scriptTree: { output: federationLeaf },
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce address/output.');

  return {
    template: HUB_TAPROOT_TEMPLATE_ID,
    label: TEMPLATE_LABEL,
    contractVersion: HUB_TAPROOT_CONTRACT_VERSION,
    address: pay.address,
    network: networkName,
    operatorPubkeyCompressedHex: operatorPk.toString('hex'),
    federationXOnlyHex: federationX.toString('hex'),
    internalPubkeyHex: opX.toString('hex'),
    keyPath: 'hub_operator',
    leafOrder: ['beacon_federation_reserve'],
    leaves: {
      beacon_federation_reserve: {
        role: 'beacon_federation_single_sig',
        scriptHex: federationLeaf.toString('hex')
      }
    }
  };
}

/**
 * Build the address for a template id.
 * @param {string} templateId `hub_taproot_v2` | `joinmarket_taproot_v1`
 * @param {Object} opts see {@link buildPayjoinHubTaproot}
 */
function buildPayjoinTaprootTemplate (templateId, opts = {}) {
  if (templateId === TEMPLATE_ID) return buildPayjoinJoinmarketTaproot(opts);
  if (templateId === HUB_TAPROOT_TEMPLATE_ID) return buildPayjoinHubTaproot(opts);
  throw new Error(`Unknown payjoin receive template: ${templateId}`);
}

module.exports = {
  JOINMARKET_TAPROOT_CONTRACT_VERSION,
  HUB_TAPROOT_CONTRACT_VERSION,
  TEMPLATE_ID,
  HUB_TAPROOT_TEMPLATE_ID,
  TEMPLATE_IDS,
  TEMPLATE_LABEL,
  TAPROOT_INTERNAL_NUMS,
  buildPayjoinJoinmarketTaproot,
  buildPayjoinHubTaproot,
  buildPayjoinTaprootTemplate,
  generatePlaceholderFederationXOnly,
  resolveBeaconFederationXOnly
};
