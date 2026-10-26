'use strict';

/**
 * Client-side Payjoin (BIP78) payer helpers for browser / extension / Electron.
 *
 * Security & privacy:
 * - xprv is used only in memory to sign; never sent to the Hub or logged.
 * - PSBTs and payjoin HTTP bodies go to the recipient's `pj=` endpoint (third party).
 *   Prefer HTTPS endpoints you trust; the receiver learns input/amount structure.
 * - Do not `console.log` PSBTs or keys in production builds.
 *
 * CORS: browsers cannot POST to arbitrary `pj=` origins unless the receiver allows it.
 * Use `window.fabricDesktop.payjoinPost` (Electron) when available, or same-origin
 * payjoin URLs (e.g. another Fabric Hub you control).
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const BIP32Factory = require('bip32').default;
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);
const { SATS_PER_BTC } = require('../constants');
const { sortPsbtInputBags, sortPsbtOutputBags } = require('./psbtFabric');
const { parseBitcoinUri } = require('@fabric/core/functions/bip21');

/** 0x81 — commit to all outputs; only this input is bound. Not used by BIP78 payjoin, which re-signs with SIGHASH_ALL. */
const SIGHASH_ALL_ANYONECANPAY = bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
const P2WPKH_INPUT_VBYTES = 68;

function networkFromName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

/** bip32.fromBase58 network for extended keys (matches Hub regtest vs tpub). */
function bip32NetworkForKeys (xpub, networkName) {
  const n = String(networkName || '').toLowerCase();
  if (n === 'regtest') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  if (n === 'mainnet' || n === 'main') return bitcoin.networks.bitcoin;
  const xs = String(xpub || '');
  if (xs.startsWith('tpub') || xs.startsWith('vpub') || xs.startsWith('upub')) return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

/**
 * Parse a BIP-21 URI that includes an http(s) BIP-78 `pj=` endpoint.
 *
 * @param {string} uri
 * @returns {Object|null} `{ address, amountSats, pjUrl, label, message }` or null
 */
function parseBitcoinUriForPayjoin (uri) {
  let parsed;
  try {
    parsed = parseBitcoinUri(uri);
  } catch (_) {
    return null;
  }
  const pjUrl = parsed.extras && parsed.extras.pj ? String(parsed.extras.pj) : '';
  if (!pjUrl || !/^https?:\/\//i.test(pjUrl)) return null;
  const amountBtc = parsed.amount != null ? Number(parsed.amount) : NaN;
  const amountSats = Number.isFinite(amountBtc) ? Math.round(amountBtc * SATS_PER_BTC) : null;
  return {
    address: parsed.address,
    amountSats,
    pjUrl,
    label: parsed.label || '',
    message: parsed.message || ''
  };
}

/**
 * @param {string} pjUrl - Payjoin POST URL from BIP21 `pj=` (Fabric: .../sessions/<id>/proposals)
 * @returns {string} session id or ''
 */
function extractFabricPayjoinSessionIdFromPjUrl (pjUrl) {
  const u = String(pjUrl || '');
  const m = u.match(/\/sessions\/([^/?#]+)\/proposals(?:\?|#|$)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * @param {string} desc - Output descriptor from Bitcoin Core scantxoutset
 * @returns {{ chain: number, index: number }|null}
 */
function chainIndexFromDescriptor (desc) {
  const m = String(desc || '').match(/\/([01])\/(\d+)\)(?:#|$)/);
  if (!m) return null;
  return { chain: Number(m[1]), index: Number(m[2]) };
}

function estimateP2wpkhFeeSats (inputCount, outputCount, satPerVbyte) {
  const rate = Math.max(1, Number(satPerVbyte || 2));
  const vbytes = 10 + inputCount * 68 + outputCount * 31;
  return Math.ceil(vbytes * rate);
}

/**
 * Add BIP78 sender parameters to a `pj=` URL.
 * @param {string} pjUrl
 * @param {{ additionalFeeOutputIndex?: number, maxAdditionalFeeContribution?: number, minFeeRate?: number, disableOutputSubstitution?: boolean }} [params]
 * @returns {string}
 */
function payjoinEndpointWithParams (pjUrl, params = {}) {
  const url = String(pjUrl || '').trim();
  const q = ['v=1'];
  if (Number.isSafeInteger(params.additionalFeeOutputIndex) && params.additionalFeeOutputIndex >= 0 &&
      Number.isSafeInteger(params.maxAdditionalFeeContribution) && params.maxAdditionalFeeContribution > 0) {
    q.push(`additionalfeeoutputindex=${params.additionalFeeOutputIndex}`);
    q.push(`maxadditionalfeecontribution=${params.maxAdditionalFeeContribution}`);
  }
  if (Number(params.minFeeRate) > 0) q.push(`minfeerate=${Number(params.minFeeRate)}`);
  if (params.disableOutputSubstitution) q.push('disableoutputsubstitution=true');
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  return `${base}${base.includes('?') ? '&' : '?'}${q.join('&')}${hash}`;
}

/**
 * POST original PSBT (base64) to BIP78 receiver; returns proposed PSBT base64 body.
 * @param {string} pjUrl
 * @param {string} psbtBase64
 * @param {{ fetchFn?: typeof fetch, params?: Object }} [opts] `params` — BIP78 sender parameters ({@link payjoinEndpointWithParams})
 */
async function postPayjoinProposal (pjUrl, psbtBase64, opts = {}) {
  const fetchFn = opts.fetchFn || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : window) : null);
  if (!fetchFn) throw new Error('fetch is not available for Payjoin POST.');
  const endpoint = opts.params ? payjoinEndpointWithParams(pjUrl, opts.params) : String(pjUrl).trim();
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: String(psbtBase64 || '')
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Payjoin endpoint returned ${res.status}: ${text.slice(0, 400)}`);
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Empty Payjoin response.');
  return trimmed;
}

/**
 * Prefer Electron main-process POST (no CORS) when `window.fabricDesktop.payjoinPost` exists.
 */
async function postPayjoinProposalWithDesktopFallback (pjUrl, psbtBase64, opts = {}) {
  const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
  const desk = g && g.fabricDesktop && typeof g.fabricDesktop.payjoinPost === 'function'
    ? g.fabricDesktop.payjoinPost
    : null;
  if (desk) {
    const endpoint = opts.params ? payjoinEndpointWithParams(pjUrl, opts.params) : String(pjUrl || '').trim();
    return desk(endpoint, String(psbtBase64 || ''));
  }
  return postPayjoinProposal(pjUrl, psbtBase64, opts);
}

/**
 * @param {object} opts
 * @param {string} opts.xprv SegWit account key (`m/84'/B'/n'`)
 * @param {string} opts.xpub
 * @param {string} [opts.standardXprv] Standard account key (`m/44'/B'/n'`) for its wpkh coins
 * @param {string} opts.networkName - Hub network id (regtest, mainnet, …)
 * @param {Array<{ txid: string, vout: number, amount?: number, amountSats?: number, desc?: string }>} opts.utxos
 * @param {string} opts.payAddress - BIP21 address (output)
 * @param {number} opts.sendAmountSats - value to payee output
 * @param {string} opts.changeAddress
 * @param {(txid: string) => Promise<string>} opts.getPrevTxHex
 * @param {number} [opts.feeSatPerVbyte]
 * @returns {Promise<{ psbtBase64: string, ourInputs: object[], ourInputIndices: number[], usedUtxos: object[], params: Object, feeSatPerVbyte: number }>}
 *   `psbtBase64` is the finalized original (BIP78). `ourInputs` keep each input's
 *   outpoint, UTXO, and key path so {@link signOurPayjoinInputs} can find and
 *   re-sign them wherever the receiver put them. `params` are the BIP78 sender
 *   parameters to POST with (change pays up to one input's fee).
 */
async function buildOriginalSignedPayjoinPsbt (opts = {}) {
  const xprv = String(opts.xprv || '').trim();
  const xpub = String(opts.xpub || '').trim();
  const payAddress = String(opts.payAddress || '').trim();
  const changeAddress = String(opts.changeAddress || '').trim();
  const sendAmountSats = Math.round(Number(opts.sendAmountSats || 0));
  const utxos = Array.isArray(opts.utxos) ? opts.utxos : [];
  const getPrevTxHex = opts.getPrevTxHex;
  const network = networkFromName(opts.networkName);
  const feeSatPerVbyte = Number(opts.feeSatPerVbyte || 2);
  const sighashTypes = [bitcoin.Transaction.SIGHASH_ALL];

  if (!xprv || !xpub) throw new Error('Extended private and public keys are required for local Payjoin.');
  if (!payAddress || !changeAddress) throw new Error('Payee and change addresses are required.');
  if (!Number.isFinite(sendAmountSats) || sendAmountSats <= 0) throw new Error('sendAmountSats must be > 0.');
  if (typeof getPrevTxHex !== 'function') throw new Error('getPrevTxHex is required.');
  if (utxos.length === 0) throw new Error('No UTXOs available for this wallet.');

  const decodeNetwork = bip32NetworkForKeys(xpub, opts.networkName);
  const bip32 = BIP32Factory(ecc);
  const root = bip32.fromBase58(xprv, decodeNetwork);
  const standardXprv = String(opts.standardXprv || '').trim();
  const standardRoot = standardXprv ? bip32.fromBase58(standardXprv, decodeNetwork) : null;
  const rootFor = (u) => (u && u.account === 'standard' ? standardRoot : root);

  /** Greedy largest-first for coin selection only; BIP-69 orders the unsigned PSBT later. P2WPKH coins only. */
  const sorted = utxos
    .filter((u) => !u.desc || /^wpkh\(/i.test(String(u.desc)))
    .filter((u) => !!rootFor(u))
    .map((u) => ({
      ...u,
      _sats: Math.round(Number(u.amountSats != null ? u.amountSats : (u.amount != null ? u.amount * SATS_PER_BTC : 0)))
    }))
    .filter((u) => u.txid && Number.isFinite(u.vout) && u._sats > 0)
    .sort((a, b) => b._sats - a._sats);

  const dustLimit = 546;
  /** Greedy largest-first; fee always uses actual picked input count. */
  let picked = [];
  let sum = 0;
  let outputs = null;
  for (const u of sorted) {
    picked.push(u);
    sum += u._sats;
    const fee2 = estimateP2wpkhFeeSats(picked.length, 2, feeSatPerVbyte);
    const change2 = sum - sendAmountSats - fee2;
    if (change2 >= dustLimit) {
      outputs = [
        { address: payAddress, value: sendAmountSats },
        { address: changeAddress, value: change2 }
      ];
      break;
    }
  }
  if (!outputs) {
    picked = [];
    sum = 0;
    for (const u of sorted) {
      picked.push(u);
      sum += u._sats;
      const fee1 = estimateP2wpkhFeeSats(picked.length, 1, feeSatPerVbyte);
      if (sum >= sendAmountSats + fee1) {
        outputs = [{ address: payAddress, value: sendAmountSats }];
        break;
      }
    }
  }
  if (!outputs || picked.length === 0) {
    throw new Error('Insufficient funds for amount plus estimated fee (try single-output after dust change).');
  }

  const pickedSorted = sortPsbtInputBags(picked.map((u) => ({
    ...u,
    txid: String(u.txid),
    vout: Number(u.vout),
    index: Number(u.vout)
  })));
  const outputsSorted = sortPsbtOutputBags(outputs, network);

  const psbt = new bitcoin.Psbt({ network });
  psbt.setLocktime(Math.max(0, Math.floor(Number(opts.locktime) || 0)));
  const ourInputIndices = [];
  const ourInputs = [];
  const usedUtxos = [];

  for (const [i, u] of pickedSorted.entries()) {
    const hex = await getPrevTxHex(String(u.txid));
    if (!hex || !/^[0-9a-fA-F]+$/i.test(hex)) throw new Error(`Prev tx hex missing for ${u.txid}`);
    const prev = bitcoin.Transaction.fromHex(hex);
    const out = prev.outs[u.vout];
    if (!out) throw new Error(`vout ${u.vout} missing for ${u.txid}`);

    const ci = chainIndexFromDescriptor(u.desc);
    if (!ci) throw new Error('UTXO missing descriptor path (chain/index). Refresh UTXOs from Hub with a current Core.');
    const inputRoot = rootFor(u);
    const child = inputRoot.derive(ci.chain).derive(ci.index);
    const pay = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
    if (!pay.output || Buffer.compare(pay.output, out.script) !== 0) {
      throw new Error('Descriptor path does not match UTXO script for ' + u.txid + ':' + u.vout);
    }

    const inputOpts = {
      hash: u.txid,
      index: u.vout,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: out.script,
        value: out.value
      },
      bip32Derivation: [{
        masterFingerprint: inputRoot.fingerprint,
        path: `m/${ci.chain}/${ci.index}`,
        pubkey: child.publicKey
      }]
    };
    psbt.addInput(inputOpts);
    ourInputIndices.push(i);
    ourInputs.push({
      outpoint: `${String(u.txid).toLowerCase()}:${Number(u.vout)}`,
      witnessUtxo: inputOpts.witnessUtxo,
      bip32Derivation: inputOpts.bip32Derivation
    });
    usedUtxos.push(u);
  }

  let changeOutputIndex = -1;
  for (const [i, o] of outputsSorted.entries()) {
    psbt.addOutput({ address: o.address, value: BigInt(o.value) });
    if (o.address === changeAddress && outputs.length > 1) changeOutputIndex = i;
  }

  const roots = [root, standardRoot].filter(Boolean);
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const child = derivationChild(roots, psbt.data.inputs[i].bip32Derivation);
    if (!child || !child.privateKey) throw new Error('Cannot derive signing key for input ' + i);
    const kp = ecpair.fromPrivateKey(child.privateKey);
    psbt.signInput(i, kp, sighashTypes);
  }
  psbt.finalizeAllInputs();

  return {
    psbtBase64: psbt.toBase64(),
    ourInputs,
    ourInputIndices,
    usedUtxos,
    feeSatPerVbyte,
    params: changeOutputIndex >= 0
      ? { additionalFeeOutputIndex: changeOutputIndex, maxAdditionalFeeContribution: Math.ceil(P2WPKH_INPUT_VBYTES * feeSatPerVbyte) }
      : {}
  };
}

/**
 * Signing child for a PSBT input's first key path, from the root whose
 * fingerprint the path names.
 * @private
 */
function derivationChild (roots, ders) {
  const m = (ders || [])[0];
  if (!m || !m.path) return null;
  const parts = String(m.path).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const chain = Number(parts[parts.length - 2]);
  const idx = Number(parts[parts.length - 1]);
  if (!Number.isFinite(chain) || !Number.isFinite(idx)) return null;
  const fp = m.masterFingerprint ? Buffer.from(m.masterFingerprint) : null;
  const root = roots.find((r) => fp && Buffer.from(r.fingerprint).equals(fp)) || (roots.length === 1 ? roots[0] : null);
  return root ? root.derive(chain).derive(idx) : null;
}

/** @private */
function outpointOfTxInput (txInput) {
  return `${Buffer.from(txInput.hash).reverse().toString('hex')}:${txInput.index}`;
}

/**
 * Sender-side BIP78 checks on a receiver's proposal: same version and
 * locktime, every original input present with its `nSequence` and no
 * signature, every receiver input signed, no outputs added or removed, our
 * outputs untouched apart from the allowed fee contribution, the payee's not
 * reduced, and the fee not lowered.
 * @param {string} originalBase64 finalized original PSBT
 * @param {string} proposalBase64 receiver's proposal
 * @param {Object} [opts]
 * @param {string} [opts.networkName]
 * @param {string} [opts.payAddress] payee address (its output may grow)
 * @param {Object} [opts.params] BIP78 parameters sent with the original
 * @returns {{ senderFeeContributionSats: number, receiverInputs: number, originalFeeSats: number, proposalFeeSats: number }}
 */
function checkPayjoinProposal (originalBase64, proposalBase64, opts = {}) {
  const network = networkFromName(opts.networkName);
  const original = bitcoin.Psbt.fromBase64(String(originalBase64 || '').trim(), { network });
  const proposal = bitcoin.Psbt.fromBase64(String(proposalBase64 || '').trim(), { network });
  const params = opts.params || {};
  if (proposal.version !== original.version) throw new Error('Payjoin proposal changed the transaction version.');
  if (proposal.locktime !== original.locktime) throw new Error('Payjoin proposal changed nLockTime.');
  const originalInputs = new Map(original.txInputs.map((txInput, i) => [outpointOfTxInput(txInput), { txInput, data: original.data.inputs[i] }]));
  const sequence = original.txInputs.length ? original.txInputs[0].sequence : null;
  const valueOf = (data, txInput) => {
    if (data.witnessUtxo) return BigInt(data.witnessUtxo.value);
    if (data.nonWitnessUtxo) return BigInt(bitcoin.Transaction.fromBuffer(Buffer.from(data.nonWitnessUtxo)).outs[txInput.index].value);
    return null;
  };
  let totalIn = 0n;
  let seen = 0;
  let receiverInputs = 0;
  proposal.txInputs.forEach((txInput, i) => {
    const data = proposal.data.inputs[i];
    const ours = originalInputs.get(outpointOfTxInput(txInput));
    if (txInput.sequence !== sequence) throw new Error(`Payjoin proposal input ${i} has a different nSequence.`);
    if (ours) {
      seen++;
      if (data.partialSig || data.finalScriptSig || data.finalScriptWitness || data.tapKeySig) throw new Error(`Payjoin proposal input ${i} carries a signature for one of our inputs.`);
      totalIn += valueOf(ours.data, ours.txInput);
      return;
    }
    receiverInputs++;
    if (!data.finalScriptSig && !data.finalScriptWitness) throw new Error(`Payjoin receiver input ${i} is not finalized.`);
    const value = valueOf(data, txInput);
    if (value == null) throw new Error(`Payjoin receiver input ${i} has no UTXO data.`);
    totalIn += value;
  });
  if (seen !== originalInputs.size) throw new Error('Payjoin proposal dropped one of our inputs.');
  if (receiverInputs < 1) throw new Error('Payjoin proposal adds no receiver input.');
  if (proposal.txOutputs.length !== original.txOutputs.length) throw new Error('Payjoin proposal added or removed outputs.');
  const payScript = opts.payAddress ? Buffer.from(bitcoin.address.toOutputScript(String(opts.payAddress).trim(), network)) : null;
  const remaining = proposal.txOutputs.map((o) => ({ script: Buffer.from(o.script), value: BigInt(o.value), used: false }));
  let senderFeeContribution = 0n;
  original.txOutputs.forEach((o, i) => {
    const script = Buffer.from(o.script);
    const match = remaining.find((r) => !r.used && r.script.equals(script));
    if (!match) throw new Error(`Payjoin proposal dropped output ${i}.`);
    match.used = true;
    if (payScript && script.equals(payScript)) {
      if (match.value < BigInt(o.value)) throw new Error('Payjoin proposal lowered the payment.');
      return;
    }
    const decrease = BigInt(o.value) - match.value;
    if (decrease < 0n) throw new Error(`Payjoin proposal changed our output ${i}.`);
    if (decrease > 0n) {
      if (i !== params.additionalFeeOutputIndex) throw new Error(`Payjoin proposal took from our output ${i}.`);
      senderFeeContribution += decrease;
    }
  });
  if (senderFeeContribution > BigInt(params.maxAdditionalFeeContribution || 0)) throw new Error('Payjoin proposal takes more fee from us than allowed.');
  const totalOut = proposal.txOutputs.reduce((t, o) => t + BigInt(o.value), 0n);
  let originalIn = 0n;
  original.txInputs.forEach((txInput, i) => { originalIn += valueOf(original.data.inputs[i], txInput); });
  const originalFee = originalIn - original.txOutputs.reduce((t, o) => t + BigInt(o.value), 0n);
  const proposalFee = totalIn - totalOut;
  if (proposalFee < originalFee) throw new Error('Payjoin proposal lowers the fee.');
  return {
    senderFeeContributionSats: Number(senderFeeContribution),
    receiverInputs,
    originalFeeSats: Number(originalFee),
    proposalFeeSats: Number(proposalFee)
  };
}

/**
 * Re-sign our inputs in a receiver's proposal with SIGHASH_ALL. BIP78
 * receivers may insert inputs anywhere and strip our key paths, so inputs
 * are found by outpoint and given back their UTXO data and key path.
 * @param {string} psbtBase64 proposal
 * @param {(Object[]|number[])} ours `ourInputs` from {@link buildOriginalSignedPayjoinPsbt} (or legacy input indices)
 * @param {string} xprv
 * @param {string} xpub - for network decode only
 * @param {string} networkName
 * @param {string} [standardXprv] Standard account key, when any input is one of its coins
 */
function signOurPayjoinInputs (psbtBase64, ours, xprv, xpub, networkName, standardXprv) {
  const network = networkFromName(networkName);
  const decodeNetwork = bip32NetworkForKeys(xpub, networkName);
  const bip32 = BIP32Factory(ecc);
  const roots = [String(xprv).trim(), String(standardXprv || '').trim()]
    .filter(Boolean)
    .map((k) => bip32.fromBase58(k, decodeNetwork));
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim(), { network });
  const list = Array.isArray(ours) ? ours : [];
  const byOutpoint = new Map(list.filter((o) => o && typeof o === 'object').map((o) => [o.outpoint, o]));
  const targets = [];
  psbt.txInputs.forEach((txInput, idx) => {
    const own = byOutpoint.get(outpointOfTxInput(txInput));
    if (own) {
      const update = {};
      if (!psbt.data.inputs[idx].witnessUtxo) update.witnessUtxo = own.witnessUtxo;
      if (!psbt.data.inputs[idx].bip32Derivation) update.bip32Derivation = own.bip32Derivation;
      if (Object.keys(update).length) psbt.updateInput(idx, update);
      targets.push(idx);
    } else if (list.includes(idx)) {
      targets.push(idx);
    }
  });

  for (const idx of targets) {
    const child = derivationChild(roots, psbt.data.inputs[idx].bip32Derivation);
    if (!child || !child.privateKey) continue;
    const kp = ecpair.fromPrivateKey(child.privateKey);
    psbt.signInput(idx, kp, [bitcoin.Transaction.SIGHASH_ALL]);
  }

  return psbt.toBase64();
}

function finalizeAndExtractHex (psbtBase64, networkName) {
  const network = networkFromName(networkName);
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim(), { network });
  psbt.data.inputs.forEach((input, i) => {
    if (!input.finalScriptWitness && !input.finalScriptSig) psbt.finalizeInput(i);
  });
  return psbt.extractTransaction().toHex();
}

module.exports = {
  parseBitcoinUriForPayjoin,
  extractFabricPayjoinSessionIdFromPjUrl,
  chainIndexFromDescriptor,
  payjoinEndpointWithParams,
  postPayjoinProposal,
  postPayjoinProposalWithDesktopFallback,
  buildOriginalSignedPayjoinPsbt,
  checkPayjoinProposal,
  signOurPayjoinInputs,
  finalizeAndExtractHex,
  estimateP2wpkhFeeSats,
  SIGHASH_ALL_ANYONECANPAY
};
