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

/** 0x81 — commit to all outputs; only this input is bound (others may be appended). */
const SIGHASH_ALL_ANYONECANPAY = bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY;

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
 * @returns {{ address: string, amountSats: number|null, pjUrl: string, label?: string, message?: string }|null}
 */
function parseBitcoinUriForPayjoin (uri) {
  const s = String(uri || '').trim();
  if (!/^bitcoin:/i.test(s)) return null;
  const noScheme = s.replace(/^bitcoin:/i, '');
  const q = noScheme.indexOf('?');
  const addressPart = (q >= 0 ? noScheme.slice(0, q) : noScheme).split('/')[0];
  const address = addressPart;
  const search = q >= 0 ? noScheme.slice(q) : '';
  const params = new URLSearchParams(search);
  const pjRaw = params.get('pj');
  if (!pjRaw) return null;
  let pjUrl;
  try {
    pjUrl = decodeURIComponent(String(pjRaw).replace(/\+/g, '%20'));
  } catch (_) {
    return null;
  }
  if (!/^https?:\/\//i.test(pjUrl)) return null;
  const amountStr = params.get('amount');
  const amountBtc = amountStr != null ? Number(amountStr) : NaN;
  const amountSats = Number.isFinite(amountBtc) ? Math.round(amountBtc * 1e8) : null;
  return {
    address,
    amountSats,
    pjUrl,
    label: params.get('label') || '',
    message: params.get('message') || ''
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
 * POST original PSBT (base64) to BIP78 receiver; returns proposed PSBT base64 body.
 * @param {string} pjUrl
 * @param {string} psbtBase64
 * @param {{ fetchFn?: typeof fetch }} [opts]
 */
async function postPayjoinProposal (pjUrl, psbtBase64, opts = {}) {
  const fetchFn = opts.fetchFn || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : window) : null);
  if (!fetchFn) throw new Error('fetch is not available for Payjoin POST.');
  const res = await fetchFn(String(pjUrl).trim(), {
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
    return desk(String(pjUrl || '').trim(), String(psbtBase64 || ''));
  }
  return postPayjoinProposal(pjUrl, psbtBase64, opts);
}

/**
 * @param {object} opts
 * @param {string} opts.xprv
 * @param {string} opts.xpub
 * @param {string} opts.networkName - Hub network id (regtest, mainnet, …)
 * @param {Array<{ txid: string, vout: number, amount?: number, amountSats?: number, desc?: string }>} opts.utxos
 * @param {string} opts.payAddress - BIP21 address (output)
 * @param {number} opts.sendAmountSats - value to payee output
 * @param {string} opts.changeAddress
 * @param {(txid: string) => Promise<string>} opts.getPrevTxHex
 * @param {number} [opts.feeSatPerVbyte]
 * @param {boolean} [opts.anyoneCanPayAll] - if true, sign with SIGHASH_ALL|ANYONECANPAY so a receiver may add inputs without changing outputs
 * @returns {Promise<{ psbtBase64: string, ourInputIndices: number[], usedUtxos: object[] }>}
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
  const anyoneCanPayAll = !!opts.anyoneCanPayAll;
  const sighashTypes = anyoneCanPayAll ? [SIGHASH_ALL_ANYONECANPAY] : [bitcoin.Transaction.SIGHASH_ALL];

  if (!xprv || !xpub) throw new Error('Extended private and public keys are required for local Payjoin.');
  if (!payAddress || !changeAddress) throw new Error('Payee and change addresses are required.');
  if (!Number.isFinite(sendAmountSats) || sendAmountSats <= 0) throw new Error('sendAmountSats must be > 0.');
  if (typeof getPrevTxHex !== 'function') throw new Error('getPrevTxHex is required.');
  if (utxos.length === 0) throw new Error('No UTXOs available for this wallet.');

  const decodeNetwork = bip32NetworkForKeys(xpub, opts.networkName);
  const bip32 = BIP32Factory(ecc);
  const root = bip32.fromBase58(xprv, decodeNetwork);

  const sorted = utxos
    .map((u) => ({
      ...u,
      _sats: Math.round(Number(u.amountSats != null ? u.amountSats : (u.amount != null ? u.amount * 1e8 : 0)))
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

  const psbt = new bitcoin.Psbt({ network });
  const ourInputIndices = [];
  const usedUtxos = [];

  for (let i = 0; i < picked.length; i++) {
    const u = picked[i];
    const hex = await getPrevTxHex(String(u.txid));
    if (!hex || !/^[0-9a-fA-F]+$/i.test(hex)) throw new Error(`Prev tx hex missing for ${u.txid}`);
    const prev = bitcoin.Transaction.fromHex(hex);
    const out = prev.outs[u.vout];
    if (!out) throw new Error(`vout ${u.vout} missing for ${u.txid}`);

    const ci = chainIndexFromDescriptor(u.desc);
    if (!ci) throw new Error('UTXO missing descriptor path (chain/index). Refresh UTXOs from Hub with a current Core.');
    const child = root.derive(ci.chain).derive(ci.index);
    const pay = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
    if (!pay.output || !pay.output.equals(out.script)) {
      throw new Error('Descriptor path does not match UTXO script for ' + u.txid + ':' + u.vout);
    }

    const inputOpts = {
      hash: u.txid,
      index: u.vout,
      witnessUtxo: {
        script: out.script,
        value: out.value
      },
      bip32Derivation: [{
        masterFingerprint: root.fingerprint,
        path: `m/${ci.chain}/${ci.index}`,
        pubkey: child.publicKey
      }]
    };
    if (anyoneCanPayAll) inputOpts.sighashType = SIGHASH_ALL_ANYONECANPAY;
    psbt.addInput(inputOpts);
    ourInputIndices.push(i);
    usedUtxos.push(u);
  }

  for (const o of outputs) {
    psbt.addOutput({ address: o.address, value: o.value });
  }

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const child = (() => {
      const ders = psbt.data.inputs[i].bip32Derivation || [];
      const m = ders[0];
      if (!m || !m.path) return null;
      const parts = String(m.path).split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const chain = Number(parts[parts.length - 2]);
      const idx = Number(parts[parts.length - 1]);
      if (!Number.isFinite(chain) || !Number.isFinite(idx)) return null;
      return root.derive(chain).derive(idx);
    })();
    if (!child || !child.privateKey) throw new Error('Cannot derive signing key for input ' + i);
    const kp = ecpair.fromPrivateKey(child.privateKey);
    psbt.signInput(i, kp, sighashTypes);
  }

  return {
    psbtBase64: psbt.toBase64(),
    ourInputIndices,
    usedUtxos
  };
}

/**
 * After receiver returns an updated PSBT, re-sign our inputs (indices unchanged for typical BIP78 v1).
 * @param {string} psbtBase64
 * @param {number[]} ourInputIndices
 * @param {string} xprv
 * @param {string} xpub - for network decode only
 * @param {string} networkName
 * @param {boolean} [anyoneCanPayAll] - must match original PSBT sighash when re-signing after payjoin round-trip
 */
function signOurPayjoinInputs (psbtBase64, ourInputIndices, xprv, xpub, networkName, anyoneCanPayAll = false) {
  const network = networkFromName(networkName);
  const decodeNetwork = bip32NetworkForKeys(xpub, networkName);
  const bip32 = BIP32Factory(ecc);
  const root = bip32.fromBase58(String(xprv).trim(), decodeNetwork);
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim(), { network });
  const sighashTypes = anyoneCanPayAll ? [SIGHASH_ALL_ANYONECANPAY] : [bitcoin.Transaction.SIGHASH_ALL];

  for (const idx of ourInputIndices) {
    if (idx < 0 || idx >= psbt.data.inputs.length) continue;
    const ders = psbt.data.inputs[idx].bip32Derivation || [];
    const m = ders[0];
    if (!m || !m.path) continue;
    const parts = String(m.path).split('/').filter(Boolean);
    const chain = Number(parts[parts.length - 2]);
    const i = Number(parts[parts.length - 1]);
    const child = root.derive(chain).derive(i);
    const kp = ecpair.fromPrivateKey(child.privateKey);
    if (anyoneCanPayAll) {
      psbt.updateInput(idx, { sighashType: SIGHASH_ALL_ANYONECANPAY });
    }
    psbt.signInput(idx, kp, sighashTypes);
  }

  return psbt.toBase64();
}

function finalizeAndExtractHex (psbtBase64, networkName) {
  const network = networkFromName(networkName);
  const psbt = bitcoin.Psbt.fromBase64(String(psbtBase64 || '').trim(), { network });
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

module.exports = {
  parseBitcoinUriForPayjoin,
  extractFabricPayjoinSessionIdFromPjUrl,
  chainIndexFromDescriptor,
  postPayjoinProposal,
  postPayjoinProposalWithDesktopFallback,
  buildOriginalSignedPayjoinPsbt,
  signOurPayjoinInputs,
  finalizeAndExtractHex,
  estimateP2wpkhFeeSats,
  SIGHASH_ALL_ANYONECANPAY
};
