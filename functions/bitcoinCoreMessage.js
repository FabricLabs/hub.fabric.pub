'use strict';

/**
 * Bitcoin Core–compatible signed-message verify (ECDSA + pubkey recovery).
 * Used by the Hub when bitcoind is down or for clients that POST JSON-RPC to /services/bitcoin.
 * Same construction as Bitcoin Core: double-SHA256 over "\x18Bitcoin Signed Message:\n" + varint + UTF-8 message.
 */
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');

bitcoin.initEccLib(ecc);

function hash256 (buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

function encodeBitcoinSignedMessagePayload (message) {
  const prefix = Buffer.from('\x18Bitcoin Signed Message:\n', 'utf8');
  const msgBuf = Buffer.from(message, 'utf8');
  const n = msgBuf.length;
  let lenEnc;
  if (n < 253) {
    lenEnc = Buffer.from([n]);
  } else if (n <= 0xffff) {
    lenEnc = Buffer.allocUnsafe(3);
    lenEnc[0] = 0xfd;
    lenEnc.writeUInt16LE(n, 1);
  } else if (n <= 0xffffffff) {
    lenEnc = Buffer.allocUnsafe(5);
    lenEnc[0] = 0xfe;
    lenEnc.writeUInt32LE(n, 1);
  } else {
    throw new Error('Message too long');
  }
  return Buffer.concat([prefix, lenEnc, msgBuf]);
}

function bitcoinMessageHash (message) {
  return hash256(encodeBitcoinSignedMessagePayload(message));
}

function networkFromName (name) {
  const n = String(name || 'regtest').toLowerCase();
  if (n === 'mainnet') return bitcoin.networks.bitcoin;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.regtest;
}

/**
 * @param {string} address
 * @param {string} signatureBase64
 * @param {string} message
 * @param {string} [networkName] - mainnet | testnet | signet | regtest
 * @returns {boolean}
 */
function verifyMessage (address, signatureBase64, message, networkName) {
  const network = networkFromName(networkName);
  const sigBuf = Buffer.from(String(signatureBase64).trim(), 'base64');
  if (sigBuf.length !== 65) return false;
  let flag = sigBuf[0] - 27;
  let compressed = false;
  if (flag >= 4) {
    compressed = true;
    flag -= 4;
  }
  if (flag < 0 || flag > 3) return false;
  const recoveryId = flag;
  const sig64 = Uint8Array.from(sigBuf.subarray(1, 65));
  const hash = Uint8Array.from(bitcoinMessageHash(message));
  const recovered = ecc.recover(hash, sig64, recoveryId, compressed);
  if (!recovered) return false;
  const pub = Buffer.from(recovered);
  const pkh = bitcoin.crypto.hash160(pub);

  const addr = String(address).trim();
  try {
    if (addr.toLowerCase().startsWith(`${network.bech32}1`)) {
      const d = bitcoin.address.fromBech32(addr);
      if (d.prefix !== network.bech32) return false;
      if (d.version === 0 && d.data.length === 20) {
        return Buffer.compare(d.data, pkh) === 0;
      }
      return false;
    }
    const dec = bitcoin.address.fromBase58Check(addr);
    if (dec.version === network.pubKeyHash) {
      return Buffer.compare(dec.hash, pkh) === 0;
    }
    return false;
  } catch (_) {
    return false;
  }
}

module.exports = {
  verifyMessage,
  bitcoinMessageHash
};
