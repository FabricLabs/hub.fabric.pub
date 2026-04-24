'use strict';

/**
 * P2TR (BIP 341) script-path HTLC for inventory → paid document transfer.
 * Internal key is a fixed NUMS point; spending uses either:
 *   - Claim: sha256(preimage) == paymentHash, seller Schnorr signature
 *   - Refund: CLTV lock height, buyer signature
 *
 * The Hub derives the preimage as SHA-256(wire bytes of a canonical Fabric
 * `DocumentPublish` message wrapping the stored document JSON — same binding as
 * CreatePurchaseInvoice / ClaimPurchase (`contentHash` hex = SHA-256(preimage)).
 * Phase-2 file delivery uses AES-256-GCM with that 32-byte preimage as the key.
 */

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const { payments, networks, script, Psbt } = bitcoin;

bitcoin.initEccLib(ecc);

const ecpair = ECPairFactory(ecc);

/** BIP341-style NUMS x-only internal key (nothing-up-my-sleeve). */
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

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

function buildInventoryHtlcP2tr (opts = {}) {
  const {
    networkName,
    sellerPubkeyCompressed,
    buyerRefundPubkeyCompressed,
    paymentHash32,
    refundLocktimeHeight
  } = opts;

  const sellerX = toXOnly(sellerPubkeyCompressed);
  const buyerX = toXOnly(buyerRefundPubkeyCompressed);
  if (!sellerX || !buyerX) throw new Error('Invalid compressed public keys (expect 33-byte 02/03).');
  if (!Buffer.isBuffer(paymentHash32) || paymentHash32.length !== 32) {
    throw new Error('paymentHash32 must be a 32-byte Buffer.');
  }
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1 || lock >= 500000000) {
    throw new Error('refundLocktimeHeight must be a valid block height (< 500000000).');
  }

  const claimScript = script.compile([
    script.OPS.OP_SHA256,
    paymentHash32,
    script.OPS.OP_EQUALVERIFY,
    sellerX,
    script.OPS.OP_CHECKSIG
  ]);

  const refundScript = script.compile([
    script.number.encode(lock),
    script.OPS.OP_CHECKLOCKTIMEVERIFY,
    script.OPS.OP_DROP,
    buyerX,
    script.OPS.OP_CHECKSIG
  ]);

  const scriptTree = [{ output: claimScript }, { output: refundScript }];
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree,
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr() did not produce address/output.');

  return {
    address: pay.address,
    output: pay.output,
    claimScript,
    refundScript,
    paymentHashHex: paymentHash32.toString('hex')
  };
}

function randomPreimage32 () {
  return crypto.randomBytes(32);
}

function hash256 (buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * BIP21-style URI and display amounts so wallets can pre-fill send-to Taproot (bc1p / bcrt1 / tb1).
 * @param {Object} opts
 * @param {string} opts.paymentAddress - Bech32m P2TR address
 * @param {number} opts.amountSats - Invoice amount in satoshis
 * @param {string} [opts.label] - Optional label (shortened for URI)
 * @returns {{ amountBtc: string, bitcoinUri: string, label?: string }}
 */
function buildHtlcFundingHints ({ paymentAddress, amountSats, label = '' }) {
  const addr = String(paymentAddress || '').trim();
  const sats = Math.round(Number(amountSats || 0));
  if (!addr || !Number.isFinite(sats) || sats <= 0) {
    return { amountBtc: '', bitcoinUri: '', label: label || undefined };
  }
  const amountBtc = (sats / 100000000).toFixed(8);
  const params = new URLSearchParams();
  params.set('amount', amountBtc);
  const lab = String(label || '').trim().slice(0, 120);
  if (lab) params.set('label', lab);
  const bitcoinUri = `bitcoin:${addr}?${params.toString()}`;
  return { amountBtc, bitcoinUri, ...(lab ? { label: lab } : {}) };
}

/**
 * Find vout index paying exactly `paymentAddress` (P2TR script match).
 */
function findP2trVoutForAddress (tx, paymentAddress, network) {
  const addr = String(paymentAddress || '').trim();
  if (!addr) return -1;
  const want = bitcoin.address.toOutputScript(addr, network);
  for (let i = 0; i < tx.outs.length; i++) {
    const sc = tx.outs[i].script;
    if (Buffer.isBuffer(sc) && sc.equals(want)) return i;
  }
  return -1;
}

/**
 * Control block for spending a given tapleaf in the standard two-leaf HTLC tree
 * [claimScript, refundScript] (same order as {@link buildInventoryHtlcP2tr}).
 */
function buildTapLeafControlBlock (claimScript, refundScript, leafScript) {
  const claimBuf = Buffer.isBuffer(claimScript) ? claimScript : Buffer.from(String(claimScript), 'hex');
  const refundBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const leafBuf = Buffer.isBuffer(leafScript) ? leafScript : Buffer.from(String(leafScript), 'hex');
  const scriptTree = [{ output: claimBuf }, { output: refundBuf }];
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: leafBuf, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Leaf script not found in HTLC tap tree.');
  const outputKey = bip341.tweakKey(TAPROOT_INTERNAL_NUMS, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed for HTLC script path.');
  return Buffer.concat([
    Buffer.from([leafVersion | outputKey.parity]),
    TAPROOT_INTERNAL_NUMS,
    ...path
  ]);
}

function buildClaimControlBlock (claimScript, refundScript) {
  const claimBuf = Buffer.isBuffer(claimScript) ? claimScript : Buffer.from(String(claimScript), 'hex');
  return buildTapLeafControlBlock(claimBuf, refundScript, claimBuf);
}

/**
 * Build unsigned PSBT spending the funded HTLC UTXO via the seller claim leaf (hashlock + CHECKSIG).
 * @param {Object} opts
 * @returns {Object} bundle for {@link signAndExtractInventoryHtlcSellerClaim}
 */
function prepareInventoryHtlcSellerClaimPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    paymentAddress,
    claimScript,
    refundScript,
    preimage32,
    destinationAddress,
    feeSats
  } = opts;

  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid HTLC output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust threshold; lower fee or fund more sats.');

  const claimBuf = Buffer.isBuffer(claimScript) ? claimScript : Buffer.from(String(claimScript), 'hex');
  const refundBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const preimage = Buffer.isBuffer(preimage32) ? preimage32 : Buffer.from(String(preimage32), 'hex');
  if (preimage.length !== 32) throw new Error('preimage must be 32 bytes.');

  const controlBlock = buildClaimControlBlock(claimBuf, refundBuf);
  const psbt = new Psbt({ network });
  psbt.addInput({
    hash: tx.getId(),
    index: vout,
    witnessUtxo: {
      script: out.script,
      value: inputSats
    },
    tapInternalKey: TAPROOT_INTERNAL_NUMS,
    tapLeafScript: [{
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT,
      script: claimBuf,
      controlBlock
    }]
  });
  psbt.addOutput({
    address: String(destinationAddress || '').trim(),
    value: destSats
  });

  return {
    psbt,
    preimage32: preimage,
    claimScript: claimBuf,
    vout,
    inputSats,
    destSats,
    fee
  };
}

/**
 * Sign with seller secp256k1 private key (32 bytes) and finalize witness:
 * [schnorr_sig, preimage, script, control_block] per BIP341 script path.
 */
function signAndExtractInventoryHtlcSellerClaim (bundle, sellerPriv32) {
  if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
  const priv = Buffer.isBuffer(sellerPriv32) ? sellerPriv32 : Buffer.from(sellerPriv32);
  if (priv.length !== 32) throw new Error('Seller private key must be 32 bytes.');
  const { psbt, preimage32 } = bundle;
  const keyPair = ecpair.fromPrivateKey(priv);
  psbt.signInput(0, keyPair);

  const preimage = Buffer.isBuffer(preimage32) ? preimage32 : Buffer.from(preimage32);
  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    const lh = bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
    const tss = (input.tapScriptSig || []).find((t) => t.leafHash.equals(lh));
    if (!tss) throw new Error('Missing tapscript signature.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, preimage, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

/**
 * Build unsigned PSBT spending the funded HTLC UTXO via the buyer/initiator refund leaf (CLTV + CHECKSIG).
 * Spending tx must use nLockTime ≥ refundLocktimeHeight and input sequence ≠ 0xffffffff.
 */
function prepareInventoryHtlcBuyerRefundPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    paymentAddress,
    claimScript,
    refundScript,
    refundLocktimeHeight,
    destinationAddress,
    feeSats
  } = opts;

  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid HTLC output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust threshold; lower fee or fund more sats.');

  const claimBuf = Buffer.isBuffer(claimScript) ? claimScript : Buffer.from(String(claimScript), 'hex');
  const refundBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1) throw new Error('refundLocktimeHeight is required.');

  const controlBlock = buildTapLeafControlBlock(claimBuf, refundBuf, refundBuf);
  const psbt = new Psbt({ network });
  psbt.setLocktime(lock);
  psbt.addInput({
    hash: tx.getId(),
    index: vout,
    sequence: 0xfffffffe,
    witnessUtxo: {
      script: out.script,
      value: inputSats
    },
    tapInternalKey: TAPROOT_INTERNAL_NUMS,
    tapLeafScript: [{
      leafVersion: bip341.LEAF_VERSION_TAPSCRIPT,
      script: refundBuf,
      controlBlock
    }]
  });
  psbt.addOutput({
    address: String(destinationAddress || '').trim(),
    value: destSats
  });

  return {
    psbt,
    claimScript: claimBuf,
    refundScript: refundBuf,
    vout,
    inputSats,
    destSats,
    fee,
    locktime: lock
  };
}

/**
 * Sign with buyer secp256k1 private key (32 bytes) and finalize witness for refund leaf:
 * [schnorr_sig, script, control_block].
 */
function signAndExtractInventoryHtlcBuyerRefund (bundle, buyerPriv32) {
  if (!bundle || !bundle.psbt) throw new Error('Invalid PSBT bundle.');
  const priv = Buffer.isBuffer(buyerPriv32) ? buyerPriv32 : Buffer.from(buyerPriv32);
  if (priv.length !== 32) throw new Error('Buyer private key must be 32 bytes.');
  const { psbt } = bundle;
  const keyPair = ecpair.fromPrivateKey(priv);
  psbt.signInput(0, keyPair);

  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on PSBT input.');
    }
    const lh = bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
    const tss = (input.tapScriptSig || []).find((t) => t.leafHash.equals(lh));
    if (!tss) throw new Error('Missing tapscript signature.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });

  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

module.exports = {
  buildInventoryHtlcP2tr,
  buildHtlcFundingHints,
  randomPreimage32,
  hash256,
  networkForFabricName,
  TAPROOT_INTERNAL_NUMS,
  findP2trVoutForAddress,
  buildTapLeafControlBlock,
  buildClaimControlBlock,
  prepareInventoryHtlcSellerClaimPsbt,
  signAndExtractInventoryHtlcSellerClaim,
  prepareInventoryHtlcBuyerRefundPsbt,
  signAndExtractInventoryHtlcBuyerRefund
};
