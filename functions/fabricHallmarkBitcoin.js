'use strict';

/**
 * Publish a Fabric hallmark as an OP_RETURN (regtest, Hub Bitcoin wallet).
 * On-chain only — callers must not gossip the payload over Fabric P2P.
 */

const {
  encodeFabricHallmarkFromState,
  HALLMARK_PAYLOAD_LENGTH
} = require('@fabric/core/functions/fabricHallmark');

/**
 * Normalize Hub contract Actor id to 32-byte hex for hallmark commitment.
 * @param {string|number} contractId
 * @returns {string}
 */
function normalizeContractIdHex (contractId) {
  const crypto = require('crypto');
  const s = String(contractId != null ? contractId : '').replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return crypto.createHash('sha256').update(String(contractId != null ? contractId : ''), 'utf8').digest('hex');
}

/**
 * @param {object} bitcoin - Hub Bitcoin service
 * @param {Buffer|string} payload - 40-byte hallmark or 80-char hex
 * @returns {Promise<{ txid: string, hex: string, payloadHex: string }>}
 */
async function publishFabricHallmarkOpReturn (bitcoin, payload) {
  let payloadHex;
  if (Buffer.isBuffer(payload)) {
    if (payload.length !== HALLMARK_PAYLOAD_LENGTH) {
      throw new Error(`hallmark payload must be ${HALLMARK_PAYLOAD_LENGTH} bytes`);
    }
    payloadHex = payload.toString('hex');
  } else {
    payloadHex = String(payload || '').replace(/\s+/g, '').replace(/^0x/i, '').toLowerCase();
    if (!new RegExp(`^[0-9a-f]{${HALLMARK_PAYLOAD_LENGTH * 2}}$`).test(payloadHex)) {
      throw new Error(`hallmark payload must be ${HALLMARK_PAYLOAD_LENGTH * 2} hex chars`);
    }
  }

  if (!bitcoin || bitcoin.network !== 'regtest') {
    throw new Error('fabric hallmark publish is only supported on regtest');
  }
  const walletName = bitcoin.walletName || (bitcoin.settings && bitcoin.settings.walletName) || null;
  if (!walletName || typeof bitcoin._makeWalletRequest !== 'function') {
    throw new Error('Bitcoin named wallet RPC is required for hallmark publish');
  }

  const outputs = [{ data: payloadHex }];
  const funded = await bitcoin._makeWalletRequest(
    'walletcreatefundedpsbt',
    [[], outputs, 0, {}, true],
    walletName
  );
  if (!funded || typeof funded.psbt !== 'string' || !funded.psbt) {
    throw new Error('walletcreatefundedpsbt did not return a PSBT');
  }

  const processed = await bitcoin._makeWalletRequest(
    'walletprocesspsbt',
    [funded.psbt, true, 'ALL'],
    walletName
  );
  let hex = processed && typeof processed.hex === 'string' ? processed.hex : '';
  if (!hex && processed && processed.psbt) {
    const fin = await bitcoin._makeWalletRequest('finalizepsbt', [processed.psbt, true], walletName).catch(() => null);
    if (fin && typeof fin.hex === 'string') hex = fin.hex;
  }
  if (!hex) {
    throw new Error(
      processed && processed.complete === false
        ? 'walletprocesspsbt did not complete (wallet may need a funded UTXO on regtest)'
        : 'could not obtain signed transaction hex for hallmark'
    );
  }

  const txid = await bitcoin._makeRPCRequest('sendrawtransaction', [hex]);
  return { txid, hex, payloadHex };
}

/**
 * Derive + encode + publish a hallmark from tip + Hub state snapshots.
 *
 * @param {object} bitcoin
 * @param {Object} opts
 * @param {string} opts.tipBlockHashHex
 * @param {string} opts.contractId
 * @param {object|null} [opts.sidechain]
 * @param {object|null} [opts.contracts]
 * @returns {Promise<{ txid: string, hex: string, payloadHex: string, commitmentHex: string, tipHashSuffixHex: string }>}
 */
async function publishFabricHallmarkFromState (bitcoin, opts = {}) {
  const contractIdHex = normalizeContractIdHex(opts.contractId);
  const encoded = encodeFabricHallmarkFromState({
    tipBlockHashHex: opts.tipBlockHashHex,
    contractIdHex,
    sidechain: opts.sidechain || null,
    contracts: opts.contracts || null
  });
  const published = await publishFabricHallmarkOpReturn(bitcoin, encoded.payload);
  return {
    ...published,
    commitmentHex: encoded.commitmentHex,
    tipHashSuffixHex: encoded.tipHashSuffixHex,
    contractIdHex
  };
}

module.exports = {
  normalizeContractIdHex,
  publishFabricHallmarkOpReturn,
  publishFabricHallmarkFromState
};
