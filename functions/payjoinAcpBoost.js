'use strict';

/**
 * Payjoin + SIGHASH_ALL|ANYONECANPAY (0x81): payer fixes all outputs but only commits to their own input(s).
 * The Hub may append a wallet UTXO (classic payjoin receiver contribution) without invalidating those signatures,
 * as long as output scripts and values are unchanged — extra input value increases the implicit fee.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');

bitcoin.initEccLib(ecc);

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

/**
 * Append one spendable Hub wallet UTXO to the PSBT and sign it via Bitcoin Core walletprocesspsbt.
 * @param {Object} opts
 * @param {string} opts.psbtBase64
 * @param {object} opts.bitcoin - Fabric Bitcoin service with _makeRPCRequest
 * @param {string} [opts.networkName]
 * @returns {Promise<{ psbtBase64: string, addedOutpoint: string, addedValueSats: number, complete: boolean }>}
 */
async function addHubWalletInputAndSign (opts = {}) {
  const psbtBase64 = String(opts.psbtBase64 || '').trim();
  const bitcoinSvc = opts.bitcoin;
  if (!psbtBase64) throw new Error('psbtBase64 is required.');
  if (!bitcoinSvc || typeof bitcoinSvc._makeRPCRequest !== 'function') {
    throw new Error('Bitcoin service is required.');
  }
  const networkName = opts.networkName || bitcoinSvc.network || 'regtest';
  const network = networkForFabricName(networkName);
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });

  const unspent = await bitcoinSvc._makeRPCRequest('listunspent', [1, 9999999, [], true, { minimumAmount: 0.00000001 }]);
  if (!Array.isArray(unspent) || unspent.length === 0) {
    throw new Error('Hub wallet has no confirmed spendable UTXOs for ACP boost.');
  }
  const pick = unspent.find((u) => u && u.spendable && u.safe !== false) || unspent[0];
  const txid = String(pick.txid || '');
  const vout = Number(pick.vout);
  if (!/^[a-fA-F0-9]{64}$/.test(txid) || !Number.isFinite(vout) || vout < 0) {
    throw new Error('listunspent returned an invalid entry.');
  }
  const hex = await bitcoinSvc._makeRPCRequest('getrawtransaction', [txid, false]);
  const prev = bitcoin.Transaction.fromHex(hex);
  const out = prev.outs[vout];
  if (!out) throw new Error('UTXO vout missing.');
  const valueField = out.value;
  const valueSat = typeof valueField === 'bigint'
    ? valueField
    : BigInt(Math.round(Number(valueField || 0)));
  if (valueSat <= BigInt(0)) throw new Error('Invalid UTXO value.');

  const witnessValue = valueSat <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(valueSat)
    : valueSat;
  psbt.addInput({
    hash: txid,
    index: vout,
    witnessUtxo: {
      script: out.script,
      value: witnessValue
    }
  });

  const merged = psbt.toBase64();
  let processed;
  try {
    processed = await bitcoinSvc._makeRPCRequest('walletprocesspsbt', [merged, true, 'SIGN', false]);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
  if (!processed || typeof processed.psbt !== 'string') {
    throw new Error('walletprocesspsbt did not return a PSBT string.');
  }
  return {
    psbtBase64: processed.psbt,
    addedOutpoint: `${txid}:${vout}`,
    addedValueSats: Number(valueSat),
    complete: !!processed.complete
  };
}

module.exports = {
  addHubWalletInputAndSign,
  networkForFabricName
};
