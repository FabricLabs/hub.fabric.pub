'use strict';

/**
 * @fileoverview BIP78 receiver contribution. The Hub adds one wallet coin to
 * the sender's original PSBT and raises its own (the session's) output by that
 * coin's value, less the fee for the extra input; the sender checks the
 * proposal and re-signs its inputs with `SIGHASH_ALL`. Nothing goes to miners
 * that the original did not already pay, apart from the extra input's weight
 * at the original fee rate.
 *
 * - The coin is the Hub wallet coin closest in value to the payment (so the
 *   largest input does not give the receiver away), of the senders' script
 *   type when they all share one.
 * - It is inserted at a random position; the senders' inputs keep their
 *   relative order, `nSequence`, version, and `nLockTime`, and lose their
 *   signatures and key paths (the sender restores those from its original).
 * - The extra input's fee comes from the sender's
 *   `additionalfeeoutputindex` output up to `maxadditionalfeecontribution`,
 *   the rest from the Hub's raised output.
 * - Originals that pay no fee, or less than `minFeeRateSatVb`, are refused:
 *   the Hub will not be the one paying the miner. Signed originals are
 *   checked with `testmempoolaccept` before the Hub reveals a coin.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');

bitcoin.initEccLib(ecc);

/** Smallest output left to the sender after it pays toward the extra input. */
const DUST_SATS = 546;
/** Virtual size of a transaction's fixed part (version, counts, locktime, segwit marker). */
const TX_OVERHEAD_VBYTES = 11;
/** Spend size by script type, in vbytes. */
const INPUT_VBYTES = Object.freeze({
  p2tr: 58,
  p2wpkh: 68,
  'p2sh-p2wpkh': 91,
  p2wsh: 105,
  p2pkh: 148
});
const CONTRIBUTABLE = new Set(['p2tr', 'p2wpkh']);

/** @private */
function fail (message) {
  const err = new Error(message);
  err.code = 'original-psbt-rejected';
  throw err;
}

/**
 * @param {string} [name]
 * @returns {Object} bitcoinjs network
 */
function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

/**
 * Script type of an output script.
 * @param {Uint8Array} script
 * @returns {string} `p2tr` | `p2wpkh` | `p2wsh` | `p2sh` | `p2pkh` | `unknown`
 */
function scriptTypeOf (script) {
  const s = Buffer.from(script || []);
  if (s.length === 34 && s[0] === 0x51 && s[1] === 0x20) return 'p2tr';
  if (s.length === 22 && s[0] === 0x00 && s[1] === 0x14) return 'p2wpkh';
  if (s.length === 34 && s[0] === 0x00 && s[1] === 0x20) return 'p2wsh';
  if (s.length === 23 && s[0] === 0xa9 && s[1] === 0x14 && s[22] === 0x87) return 'p2sh';
  if (s.length === 25 && s[0] === 0x76 && s[1] === 0xa9 && s[2] === 0x14 && s[23] === 0x88 && s[24] === 0xac) return 'p2pkh';
  return 'unknown';
}

/** @private */
function inputVbytes (type) {
  if (type === 'p2sh') return INPUT_VBYTES['p2sh-p2wpkh'];
  return INPUT_VBYTES[type] || INPUT_VBYTES.p2pkh;
}

/**
 * Estimated virtual size of a transaction with these input types and output scripts.
 * @param {string[]} inputTypes
 * @param {Uint8Array[]} outputScripts
 * @returns {number}
 */
function estimateVsize (inputTypes, outputScripts) {
  const inputs = inputTypes.reduce((t, type) => t + inputVbytes(type), 0);
  const outputs = outputScripts.reduce((t, script) => t + 9 + Buffer.from(script).length, 0);
  return TX_OVERHEAD_VBYTES + inputs + outputs;
}

/**
 * BIP78 query parameters of a proposal POST.
 * @param {Object} [query] request query
 * @returns {{ version: number, additionalFeeOutputIndex: (number|null), maxAdditionalFeeContribution: number, minFeeRate: number, disableOutputSubstitution: boolean }}
 */
function parseBip78Params (query = {}) {
  const q = query || {};
  const int = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const version = int(q.v);
  if (version != null && version !== 1) fail(`unsupported BIP78 version ${version}`);
  const minFeeRate = q.minfeerate != null && q.minfeerate !== '' ? Number(q.minfeerate) : 0;
  return {
    version: 1,
    additionalFeeOutputIndex: int(q.additionalfeeoutputindex),
    maxAdditionalFeeContribution: int(q.maxadditionalfeecontribution) || 0,
    minFeeRate: Number.isFinite(minFeeRate) && minFeeRate > 0 ? minFeeRate : 0,
    disableOutputSubstitution: String(q.disableoutputsubstitution || '').toLowerCase() === 'true'
  };
}

/** @private */
function utxoOf (psbt, index) {
  const data = psbt.data.inputs[index];
  if (data.witnessUtxo) return { script: Buffer.from(data.witnessUtxo.script), value: BigInt(data.witnessUtxo.value) };
  if (data.nonWitnessUtxo) {
    const prev = bitcoin.Transaction.fromBuffer(Buffer.from(data.nonWitnessUtxo));
    const out = prev.outs[psbt.txInputs[index].index];
    if (out) return { script: Buffer.from(out.script), value: BigInt(out.value) };
  }
  return null;
}

/** @private */
function outpointOf (txInput) {
  return `${Buffer.from(txInput.hash).reverse().toString('hex')}:${txInput.index}`;
}

/** @private */
function isFinalized (data) {
  return !!(data.finalScriptWitness || data.finalScriptSig);
}

/**
 * Check the sender's original PSBT and find the receiver's output.
 * @param {Object} opts
 * @param {string} opts.psbtBase64
 * @param {Uint8Array} opts.receiverScript
 * @param {Object} opts.network
 * @param {number} [opts.minFeeRateSatVb=1]
 * @returns {Object} analysis
 */
function analyzeOriginal (opts = {}) {
  let psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(String(opts.psbtBase64 || '').trim(), { network: opts.network });
  } catch (err) {
    fail(`original PSBT does not parse: ${err.message}`);
  }
  if (!psbt.txInputs.length) fail('original PSBT has no inputs');
  const receiverScript = Buffer.from(opts.receiverScript);
  const outputs = psbt.txOutputs.map((o) => ({ script: Buffer.from(o.script), value: BigInt(o.value) }));
  const receiverIndexes = outputs.map((o, i) => (o.script.equals(receiverScript) ? i : -1)).filter((i) => i >= 0);
  if (receiverIndexes.length !== 1) fail('original PSBT must pay the session address exactly once');
  const inputs = psbt.txInputs.map((txInput, i) => {
    const utxo = utxoOf(psbt, i);
    if (!utxo) fail(`sender input ${i} has no UTXO data`);
    const data = psbt.data.inputs[i];
    const signed = isFinalized(data) || (data.partialSig && data.partialSig.length > 0) || !!data.tapKeySig;
    if (!signed) fail(`sender input ${i} is not signed`);
    return {
      outpoint: outpointOf(txInput),
      sequence: txInput.sequence,
      type: scriptTypeOf(utxo.script),
      script: utxo.script,
      value: utxo.value
    };
  });
  const sequences = new Set(inputs.map((i) => i.sequence));
  if (sequences.size !== 1) fail('sender inputs must share one nSequence');
  const totalIn = inputs.reduce((t, i) => t + i.value, 0n);
  const totalOut = outputs.reduce((t, o) => t + o.value, 0n);
  const feeSats = Number(totalIn - totalOut);
  if (!(feeSats > 0)) fail('original PSBT pays no fee; the Hub will not pay the miner for the sender');
  const vsize = estimateVsize(inputs.map((i) => i.type), outputs.map((o) => o.script));
  const feeRateSatVb = feeSats / vsize;
  const minRate = opts.minFeeRateSatVb != null ? Number(opts.minFeeRateSatVb) : 1;
  if (feeRateSatVb < minRate) fail(`original fee rate ${feeRateSatVb.toFixed(2)} sat/vB is below ${minRate}`);
  const types = new Set(inputs.map((i) => i.type));
  return {
    psbt,
    inputs,
    outputs,
    receiverIndex: receiverIndexes[0],
    feeSats,
    vsize,
    feeRateSatVb,
    senderType: types.size === 1 ? [...types][0] : null,
    allFinalized: psbt.data.inputs.every(isFinalized)
  };
}

/** @private */
function rpcOf (svc, wallet) {
  if (!svc || typeof svc._makeRPCRequest !== 'function') throw new Error('Bitcoin service is required.');
  return (method, params = []) => (wallet && typeof svc._makeWalletRequest === 'function'
    ? svc._makeWalletRequest(method, params, wallet)
    : svc._makeRPCRequest(method, params));
}

/** @private */
async function checkBroadcastable (analysis, rpc) {
  const clone = bitcoin.Psbt.fromBase64(analysis.psbt.toBase64(), { network: analysis.psbt.opts.network });
  let txHex;
  try {
    if (!analysis.allFinalized) clone.finalizeAllInputs();
    txHex = clone.extractTransaction(true).toHex();
  } catch (err) {
    fail(`original PSBT cannot be finalized: ${err.message}`);
  }
  const result = await rpc('testmempoolaccept', [[txHex]]);
  const row = Array.isArray(result) ? result[0] : null;
  if (!row || !row.allowed) fail(`original transaction would not be accepted: ${(row && row['reject-reason']) || 'unknown'}`);
}

/**
 * The Hub coin to contribute: confirmed, spendable, not in the original,
 * closest in value to the payment.
 * @param {Object[]} unspent `listunspent` rows
 * @param {Object} opts
 * @param {Set<string>} opts.exclude outpoints in the original
 * @param {number} opts.paymentSats
 * @param {(string|null)} opts.senderType
 * @returns {(Object|null)} `{ txid, vout, valueSats, script, type }`
 */
function chooseContribution (unspent, opts = {}) {
  const rows = (Array.isArray(unspent) ? unspent : [])
    .filter((u) => u && u.spendable !== false && u.solvable !== false && u.safe !== false)
    .map((u) => {
      const script = Buffer.from(String(u.scriptPubKey || ''), 'hex');
      return {
        txid: String(u.txid || '').toLowerCase(),
        vout: Number(u.vout),
        valueSats: Math.round(Number(u.amount) * 1e8),
        script,
        type: scriptTypeOf(script)
      };
    })
    .filter((u) => /^[0-9a-f]{64}$/.test(u.txid) && Number.isSafeInteger(u.vout) && u.valueSats > 0)
    .filter((u) => CONTRIBUTABLE.has(u.type) && !(opts.exclude && opts.exclude.has(`${u.txid}:${u.vout}`)))
    .filter((u) => !opts.senderType || u.type === opts.senderType);
  if (!rows.length) return null;
  const target = Number(opts.paymentSats);
  rows.sort((a, b) => Math.abs(a.valueSats - target) - Math.abs(b.valueSats - target) || a.valueSats - b.valueSats);
  return rows[0];
}

/**
 * Build and sign the payjoin proposal for a sender's original PSBT.
 * @param {Object} opts
 * @param {string} opts.psbtBase64 sender's original (signed) PSBT
 * @param {Object} opts.bitcoin Fabric Bitcoin service (`_makeRPCRequest`)
 * @param {string} [opts.wallet] named Hub wallet
 * @param {string} [opts.receiverAddress] the session address
 * @param {string} [opts.receiverScriptHex] or its script
 * @param {string} [opts.networkName]
 * @param {Object} [opts.params] {@link parseBip78Params} output
 * @param {number} [opts.minFeeRateSatVb=1] lowest original fee rate accepted
 * @param {boolean} [opts.checkBroadcastable=true] `testmempoolaccept` the original first
 * @param {boolean} [opts.lock=true] lock the contributed coin in the wallet
 * @param {Function} [opts.random] `() => [0, 1)` for the insert position (tests)
 * @returns {Promise<Object>} `{ psbtBase64, contributedOutpoint, contributedValueSats, inputIndex, receiverOutputIndex, receiverOutputBeforeSats, receiverOutputAfterSats, additionalFeeSats, senderFeeContributionSats, originalFeeSats, proposalFeeSats, feeRateSatVb }`
 */
async function contributeReceiverInput (opts = {}) {
  const networkName = opts.networkName || (opts.bitcoin && opts.bitcoin.network) || 'regtest';
  const network = networkForFabricName(networkName);
  const rpc = rpcOf(opts.bitcoin, opts.wallet);
  let receiverScript;
  if (opts.receiverScriptHex) {
    receiverScript = Buffer.from(String(opts.receiverScriptHex), 'hex');
  } else {
    try {
      receiverScript = Buffer.from(bitcoin.address.toOutputScript(String(opts.receiverAddress || '').trim(), network));
    } catch (err) {
      throw new Error(`receiver address is not valid on ${networkName}: ${err.message}`);
    }
  }
  const params = opts.params || parseBip78Params({});
  const analysis = analyzeOriginal({
    psbtBase64: opts.psbtBase64,
    receiverScript,
    network,
    minFeeRateSatVb: opts.minFeeRateSatVb
  });
  if (opts.checkBroadcastable !== false) await checkBroadcastable(analysis, rpc);

  const paymentSats = Number(analysis.outputs[analysis.receiverIndex].value);
  const coin = chooseContribution(await rpc('listunspent', [1, 9999999, [], false]), {
    exclude: new Set(analysis.inputs.map((i) => i.outpoint)),
    paymentSats,
    senderType: analysis.senderType
  });
  if (!coin) {
    throw new Error(analysis.senderType && !CONTRIBUTABLE.has(analysis.senderType)
      ? `the Hub contributes only P2TR or P2WPKH coins; the sender spends ${analysis.senderType}`
      : 'Hub wallet has no confirmed coin to contribute');
  }

  const additionalFeeSats = Math.ceil(inputVbytes(coin.type) * analysis.feeRateSatVb);
  let senderFeeContributionSats = 0;
  const feeIndex = params.additionalFeeOutputIndex;
  if (feeIndex != null && params.maxAdditionalFeeContribution > 0) {
    if (feeIndex >= analysis.outputs.length || feeIndex === analysis.receiverIndex) fail('additionalfeeoutputindex does not name a sender output');
    const room = Number(analysis.outputs[feeIndex].value) - DUST_SATS;
    senderFeeContributionSats = Math.max(0, Math.min(additionalFeeSats, params.maxAdditionalFeeContribution, room));
  }
  const receiverFeeSats = additionalFeeSats - senderFeeContributionSats;
  if (coin.valueSats <= receiverFeeSats) throw new Error('contributed coin does not cover its own fee');
  const proposalFeeSats = analysis.feeSats + additionalFeeSats;
  const proposalVsize = analysis.vsize + inputVbytes(coin.type);
  const feeRateSatVb = proposalFeeSats / proposalVsize;
  if (params.minFeeRate && feeRateSatVb < params.minFeeRate) fail(`proposal fee rate ${feeRateSatVb.toFixed(2)} is below the sender's minfeerate`);

  const random = typeof opts.random === 'function' ? opts.random : Math.random;
  const inputIndex = Math.min(analysis.inputs.length, Math.floor(random() * (analysis.inputs.length + 1)));
  const sequence = analysis.inputs[0].sequence;
  const proposal = new bitcoin.Psbt({ network });
  proposal.setVersion(analysis.psbt.version);
  proposal.setLocktime(analysis.psbt.locktime);
  const addContribution = () => proposal.addInput({
    hash: coin.txid,
    index: coin.vout,
    sequence,
    witnessUtxo: { script: coin.script, value: BigInt(coin.valueSats) }
  });
  analysis.psbt.txInputs.forEach((txInput, i) => {
    if (i === inputIndex) addContribution();
    const data = analysis.psbt.data.inputs[i];
    const input = { hash: Buffer.from(txInput.hash), index: txInput.index, sequence: txInput.sequence };
    if (data.witnessUtxo) input.witnessUtxo = data.witnessUtxo;
    if (data.nonWitnessUtxo) input.nonWitnessUtxo = data.nonWitnessUtxo;
    if (data.redeemScript) input.redeemScript = data.redeemScript;
    if (data.witnessScript) input.witnessScript = data.witnessScript;
    proposal.addInput(input);
  });
  if (inputIndex === analysis.inputs.length) addContribution();
  const before = Number(analysis.outputs[analysis.receiverIndex].value);
  const after = before + coin.valueSats - receiverFeeSats;
  analysis.outputs.forEach((o, i) => {
    let value = Number(o.value);
    if (i === analysis.receiverIndex) value = after;
    if (i === feeIndex && senderFeeContributionSats > 0) value -= senderFeeContributionSats;
    proposal.addOutput({ script: o.script, value: BigInt(value) });
  });
  const unsignedHex = proposal.data.globalMap.unsignedTx.toBuffer().toString('hex');

  const processed = await rpc('walletprocesspsbt', [proposal.toBase64(), true, 'ALL', false, true]);
  if (!processed || typeof processed.psbt !== 'string') throw new Error('walletprocesspsbt did not return a PSBT.');
  const signed = bitcoin.Psbt.fromBase64(processed.psbt, { network });
  if (signed.data.globalMap.unsignedTx.toBuffer().toString('hex') !== unsignedHex) throw new Error('the Hub wallet changed the proposal transaction');
  signed.data.inputs.forEach((data, i) => {
    if (i === inputIndex) {
      if (!isFinalized(data)) throw new Error('the Hub wallet did not sign its contributed input');
    } else if (isFinalized(data) || (data.partialSig && data.partialSig.length) || data.tapKeySig) {
      throw new Error(`the Hub wallet signed sender input ${i}`);
    }
  });

  if (opts.lock !== false) {
    try {
      await rpc('lockunspent', [false, [{ txid: coin.txid, vout: coin.vout }]]);
    } catch (_) {}
  }

  return {
    psbtBase64: signed.toBase64(),
    contributedOutpoint: `${coin.txid}:${coin.vout}`,
    contributedValueSats: coin.valueSats,
    inputIndex,
    receiverOutputIndex: analysis.receiverIndex,
    receiverOutputBeforeSats: before,
    receiverOutputAfterSats: after,
    additionalFeeSats,
    senderFeeContributionSats,
    originalFeeSats: analysis.feeSats,
    proposalFeeSats,
    feeRateSatVb
  };
}

module.exports = {
  DUST_SATS,
  INPUT_VBYTES,
  networkForFabricName,
  scriptTypeOf,
  estimateVsize,
  parseBip78Params,
  analyzeOriginal,
  chooseContribution,
  contributeReceiverInput
};
