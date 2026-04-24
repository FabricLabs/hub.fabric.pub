'use strict';

/**
 * Pluggable Taproot receive template for Payjoin (BIP77) deposit sessions.
 *
 * - BIP21 + pj= and proposal POST semantics stay unchanged (Payjoin v2-compatible expectations).
 * - Default “Joinmarket-style” flow: NUMS internal key, script-path only, two tapleaves:
 *     1) Hub operator single-sig (compressed pubkey → x-only) — simple cooperative / ACP stitching.
 *   2) Beacon federation reserve — single-sig leaf with an x-only key you configure (env or explicit).
 *      On mainnet, configuring the real federation x-only makes this leaf spendable by the federation;
 *      until then, omit env to get a hard failure on mainnet, or supply a deliberate test key.
 *
 * Tree shape and leaf order are part of the contract version so a future template can swap in
 * k-of-n federation tapscripts without pretending this address stays valid across script changes.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const { payments, networks, script } = bitcoin;

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);

/** Same NUMS x-only internal key as federationVault / crowdfund (script-path spends only). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

const JOINMARKET_TAPROOT_CONTRACT_VERSION = 1;
const TEMPLATE_ID = 'joinmarket_taproot_v1';

/** Regtest/signet/testnet-only deterministic placeholder if no env/explicit federation x-only (private key = 1). */
const REGTEST_PLACEHOLDER_PRIV = Buffer.concat([
  Buffer.alloc(31, 0),
  Buffer.from([0x01])
]);

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return networks.regtest;
  if (n === 'testnet' || n === 'signet') return networks.testnet;
  return networks.bitcoin;
}

function toXOnly (pubkey33) {
  if (!Buffer.isBuffer(pubkey33) || pubkey33.length !== 33) return null;
  if (pubkey33[0] !== 0x02 && pubkey33[0] !== 0x03) return null;
  return pubkey33.subarray(1, 33);
}

function regtestPlaceholderFederationXOnly () {
  const kp = ecpair.fromPrivateKey(REGTEST_PLACEHOLDER_PRIV);
  return Buffer.from(kp.publicKey.subarray(1, 33));
}

/**
 * Resolve 32-byte x-only federation pubkey for the reserve leaf.
 * @param {object} opts
 * @param {string} [opts.explicitHex]
 * @param {string} [opts.configHex] - hub settings payjoin.beaconFederationXOnlyHex
 * @param {string} [opts.networkName]
 */
function resolveBeaconFederationXOnly (opts = {}) {
  const tryHex = (h) => {
    const s = String(h || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(s)) return null;
    return Buffer.from(s, 'hex');
  };
  const a = tryHex(opts.explicitHex);
  if (a) return a;
  const b = tryHex(opts.configHex);
  if (b) return b;
  const c = tryHex(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX);
  if (c) return c;

  const net = String(opts.networkName || '').toLowerCase();
  if (net === 'regtest' || net === 'test' || net === 'signet' || net === 'testnet') {
    return regtestPlaceholderFederationXOnly();
  }

  throw new Error(
    'Beacon federation x-only is required for joinmarket taproot receive on this network. ' +
      'Set FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX (64 hex), payjoin.beaconFederationXOnlyHex in settings, ' +
      'or pass federationXOnlyHex when creating the session.'
  );
}

/**
 * @param {object} opts
 * @param {string} opts.networkName
 * @param {Buffer} opts.operatorPubkeyCompressed - 33-byte compressed secp256k1 pubkey
 * @param {Buffer} opts.federationXOnly - 32-byte x-only pubkey for reserve leaf
 */
function buildPayjoinJoinmarketTaproot (opts = {}) {
  const operatorPk = opts.operatorPubkeyCompressed;
  const federationX = opts.federationXOnly;
  const networkName = opts.networkName || 'mainnet';

  if (!Buffer.isBuffer(operatorPk) || operatorPk.length !== 33) {
    throw new Error('operatorPubkeyCompressed must be a 33-byte compressed pubkey.');
  }
  const opX = toXOnly(operatorPk);
  if (!opX) throw new Error('Invalid operator compressed pubkey.');
  if (!Buffer.isBuffer(federationX) || federationX.length !== 32) {
    throw new Error('federationXOnly must be a 32-byte x-only pubkey.');
  }

  const joinmarketLeaf = script.compile([opX, script.OPS.OP_CHECKSIG]);
  const federationLeaf = script.compile([federationX, script.OPS.OP_CHECKSIG]);
  const scriptTree = [{ output: joinmarketLeaf }, { output: federationLeaf }];
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree,
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce address/output.');

  return {
    template: TEMPLATE_ID,
    contractVersion: JOINMARKET_TAPROOT_CONTRACT_VERSION,
    address: pay.address,
    network: networkName,
    operatorPubkeyCompressedHex: operatorPk.toString('hex'),
    federationXOnlyHex: federationX.toString('hex'),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
    leafOrder: ['joinmarket_operator', 'beacon_federation_reserve'],
    leaves: {
      joinmarket_operator: {
        role: 'hub_operator_acp_join',
        scriptHex: joinmarketLeaf.toString('hex')
      },
      beacon_federation_reserve: {
        role: 'beacon_federation_single_sig',
        scriptHex: federationLeaf.toString('hex'),
        note: 'Swap federationXOnly for your Beacon federation aggregate key; new sessions pick up hub settings / env.'
      }
    }
  };
}

module.exports = {
  JOINMARKET_TAPROOT_CONTRACT_VERSION,
  TEMPLATE_ID,
  TAPROOT_INTERNAL_NUMS,
  buildPayjoinJoinmarketTaproot,
  resolveBeaconFederationXOnly,
  regtestPlaceholderFederationXOnly
};
