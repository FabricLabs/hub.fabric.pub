'use strict';

/**
 * Fabric-protocol identity derivation: m/44'/7778'/account'/0/0 (see IDENTITY.md / Identity derivation).
 * Bitcoin payments still derive under the Fabric *master* key via deriveFabricBitcoinAccountKeys.
 */

const BIP32 = require('bip32').default;
const ecc = require('@fabric/core/types/ecc');
const Hash256 = require('@fabric/core/types/hash256');
const Bech32 = require('@fabric/core/types/bech32');

/** Same bip32 network buckets as bitcoinClient#getNetworkFromXpub (extended keys only). */
function bip32DecodeNetworkFromXKey (referenceXkey) {
  const raw = String(referenceXkey || '').trim();
  const isTest =
    raw.startsWith('tpub') || raw.startsWith('upub') || raw.startsWith('vpub') ||
    raw.startsWith('tprv');
  return isTest
    ? {
      bech32: 'tb',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef
    }
    : {
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80
    };
}

function fabricPurposePath7778 (accountIndex, addressIndex) {
  const a = Math.floor(Number(accountIndex));
  const i = Math.floor(Number(addressIndex));
  if (!Number.isFinite(a) || a < 0) throw new Error('Invalid Fabric account index.');
  if (!Number.isFinite(i) || i < 0) throw new Error('Invalid Fabric address index.');
  return `m/44'/7778'/${a}'/0/${i}`;
}

function fabricBech32IdFromCompressedPubHex (compressedPubHex) {
  const input = Buffer.from(String(compressedPubHex || '').trim(), 'hex');
  if (!input.length) throw new Error('Missing pubkey bytes.');
  const pubkeyhash = Hash256.digest(input);
  return new Bech32({ hrp: 'id', content: pubkeyhash }).toString();
}

function fabricRootXpubFromMasterXprv (masterXprv) {
  if (!masterXprv || typeof masterXprv !== 'string') throw new Error('Master xpriv required.');
  const net = bip32DecodeNetworkFromXKey(masterXprv.trim());
  const bip32 = new BIP32(ecc);
  const root = bip32.fromBase58(String(masterXprv).trim(), net);
  return root.neutered().toBase58();
}

/**
 * Primary Fabric identity signing material at account slot (protocol path m/44'/7778'/n'/0/0).
 */
function deriveFabricAccountIdentityKeys (masterXprv, fabricAccountIndex, addressIndex) {
  if (!masterXprv || typeof masterXprv !== 'string') throw new Error('Master xpriv required.');
  const ai = fabricAccountIndex == null ? 0 : Math.floor(Number(fabricAccountIndex));
  if (!Number.isFinite(ai) || ai < 0) throw new Error('Invalid Fabric account index.');
  const adr = addressIndex != null ? Math.floor(Number(addressIndex)) : 0;
  if (!Number.isFinite(adr) || adr < 0) throw new Error('Invalid Fabric address index.');
  const trimmed = String(masterXprv).trim();
  const net = bip32DecodeNetworkFromXKey(trimmed);
  const bip32 = new BIP32(ecc);
  const masterNode = bip32.fromBase58(trimmed, net);
  const path = fabricPurposePath7778(ai, adr);
  const node = masterNode.derivePath(path);
  const pubHex = Buffer.from(node.publicKey).toString('hex');
  return {
    fabricAccountIndex: ai,
    path,
    xprv: node.toBase58(),
    xpub: node.neutered().toBase58(),
    id: fabricBech32IdFromCompressedPubHex(pubHex),
    pubkeyHexCompressed: pubHex
  };
}

/**
 * Interpret an extended private key as the Fabric protocol signing node (m/44'/7778'/n'/0/0),
 * e.g. from an account-only backup. Does not accept a raw HD master for this path.
 */
function identityFromFabricProtocolSigningXprv (accountNodeXprv) {
  const trimmed = String(accountNodeXprv || '').trim();
  if (!trimmed) throw new Error('Account xprv required.');
  const net = bip32DecodeNetworkFromXKey(trimmed);
  const bip32 = new BIP32(ecc);
  const node = bip32.fromBase58(trimmed, net);
  const pubHex = Buffer.from(node.publicKey).toString('hex');
  return {
    fabricHdRole: 'accountNode',
    xprv: trimmed,
    xpub: node.neutered().toBase58(),
    id: fabricBech32IdFromCompressedPubHex(pubHex),
    pubkeyHexCompressed: pubHex
  };
}

module.exports = {
  fabricPurposePath7778,
  fabricRootXpubFromMasterXprv,
  deriveFabricAccountIdentityKeys,
  fabricBech32IdFromCompressedPubHex,
  bip32DecodeNetworkFromXKey,
  identityFromFabricProtocolSigningXprv
};
