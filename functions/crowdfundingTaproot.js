'use strict';

/**
 * Taproot (BIP 341/342) on-chain crowdfunding vault.
 *
 * Deposits share one P2TR address. Tapscript encodes:
 *   - Payout path: 8-byte LE commitments to goalSats + minContributionSats (dropped), then
 *     Schnorr 2-of-2 (beneficiary + arbiter x-only keys, lexicographically sorted). The beneficiary
 *     cannot move funds alone; the arbiter co-signs only when aggregate confirmed value ≥ goal (policy).
 *   - Refund path: absolute CLTV + arbiter-only signature (sweep after deadline).
 *
 * Bitcoin Script cannot sum balances across separate UTXOs; the goal is enforced by tapleaf
 * commitments binding campaign parameters to the address, plus arbiter policy on payout PSBTs.
 * Min per donation is enforced in Hub APIs when recording UTXOs and is committed in the payout leaf.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const { payments, networks, script, Psbt } = bitcoin;

bitcoin.initEccLib(ecc);

const ecpair = ECPairFactory(ecc);

/** BIP341 NUMS x-only internal key (script-path spends only). */
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

function u64LePush (n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0 || num > Number.MAX_SAFE_INTEGER) {
    throw new Error('u64LePush: invalid uint53 value.');
  }
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(Math.floor(num)), 0);
  return b;
}

function parseCompressedPubkey33 (hex) {
  const s = String(hex || '').trim().toLowerCase();
  if (!/^(02|03)[0-9a-f]{64}$/i.test(s)) {
    throw new Error('Invalid compressed secp256k1 pubkey (expect 33-byte hex 02/03…).');
  }
  return Buffer.from(s, 'hex');
}

function sortedXOnlyPair (arbiterX, beneficiaryX) {
  const a = Buffer.isBuffer(arbiterX) ? arbiterX : Buffer.from(arbiterX);
  const b = Buffer.isBuffer(beneficiaryX) ? beneficiaryX : Buffer.from(beneficiaryX);
  if (a.length !== 32 || b.length !== 32) throw new Error('sortedXOnlyPair expects 32-byte x-only keys.');
  return a.compare(b) <= 0 ? [a, b] : [b, a];
}

/**
 * @param {Object} opts
 * @param {string} opts.networkName
 * @param {Buffer} opts.beneficiaryPubkeyCompressed
 * @param {Buffer} opts.arbiterPubkeyCompressed
 * @param {number} opts.goalSats
 * @param {number} opts.minContributionSats
 * @param {number} opts.refundLocktimeHeight - absolute block height for refund leaf
 */
function buildCrowdfundP2tr (opts = {}) {
  const {
    networkName,
    beneficiaryPubkeyCompressed,
    arbiterPubkeyCompressed,
    goalSats,
    minContributionSats,
    refundLocktimeHeight
  } = opts;

  const benX = toXOnly(beneficiaryPubkeyCompressed);
  const arbX = toXOnly(arbiterPubkeyCompressed);
  if (!benX || !arbX) throw new Error('Invalid beneficiary or arbiter compressed pubkey.');
  const goal = Math.round(Number(goalSats));
  const minC = Math.round(Number(minContributionSats));
  if (!Number.isFinite(goal) || goal < 1) throw new Error('goalSats must be a positive integer.');
  if (!Number.isFinite(minC) || minC < 1) throw new Error('minContributionSats must be a positive integer.');
  if (minC > goal) throw new Error('minContributionSats cannot exceed goalSats.');
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1 || lock >= 500000000) {
    throw new Error('refundLocktimeHeight must be a valid block height (< 500000000).');
  }

  const [k0, k1] = sortedXOnlyPair(arbX, benX);
  const goalPush = u64LePush(goal);
  const minPush = u64LePush(minC);
  const payoutScript = script.compile([
    goalPush,
    script.OPS.OP_DROP,
    minPush,
    script.OPS.OP_DROP,
    k0,
    script.OPS.OP_CHECKSIG,
    k1,
    script.OPS.OP_CHECKSIGADD,
    script.number.encode(2),
    script.OPS.OP_NUMEQUAL
  ]);

  const refundScript = script.compile([
    script.number.encode(lock),
    script.OPS.OP_CHECKLOCKTIMEVERIFY,
    script.OPS.OP_DROP,
    arbX,
    script.OPS.OP_CHECKSIG
  ]);

  const scriptTree = [{ output: payoutScript }, { output: refundScript }];
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree,
    network: networkForFabricName(networkName)
  });
  if (!pay.address || !pay.output) throw new Error('p2tr() did not produce address/output.');

  return {
    address: pay.address,
    output: pay.output,
    payoutScript,
    refundScript,
    goalSats: goal,
    minContributionSats: minC,
    refundLocktimeHeight: lock,
    sortedXOnlyHex: [k0.toString('hex'), k1.toString('hex')],
    arbiterXOnlyHex: arbX.toString('hex'),
    beneficiaryXOnlyHex: benX.toString('hex')
  };
}

function buildTapLeafControlBlock (payoutScript, refundScript, leafScript) {
  const payBuf = Buffer.isBuffer(payoutScript) ? payoutScript : Buffer.from(String(payoutScript), 'hex');
  const refBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const leafBuf = Buffer.isBuffer(leafScript) ? leafScript : Buffer.from(String(leafScript), 'hex');
  const scriptTree = [{ output: payBuf }, { output: refBuf }];
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: leafBuf, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Leaf script not found in crowdfund tap tree.');
  const outputKey = bip341.tweakKey(TAPROOT_INTERNAL_NUMS, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed.');
  return Buffer.concat([
    Buffer.from([leafVersion | outputKey.parity]),
    TAPROOT_INTERNAL_NUMS,
    ...path
  ]);
}

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
 * Unsigned PSBT spending N crowdfund UTXOs (same address) via payout tapscript; enforces sum ≥ goalSats.
 * @param {Object} opts
 * @param {Array<{ txHex: string, vout?: number }>} opts.inputs - vout optional if only one P2TR output per tx
 * @param {string} opts.paymentAddress
 * @param {Buffer|string} opts.payoutScript
 * @param {Buffer|string} opts.refundScript
 * @param {string} opts.destinationAddress
 * @param {number} opts.feeSats
 * @param {number} opts.goalSats
 */
function prepareCrowdfundPayoutPsbt (opts = {}) {
  const {
    networkName,
    inputs,
    paymentAddress,
    payoutScript,
    refundScript,
    destinationAddress,
    feeSats,
    goalSats
  } = opts;

  const network = networkForFabricName(networkName);
  const payBuf = Buffer.isBuffer(payoutScript) ? payoutScript : Buffer.from(String(payoutScript), 'hex');
  const refBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const dest = String(destinationAddress || '').trim();
  if (!dest) throw new Error('destinationAddress is required.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const goal = Math.round(Number(goalSats || 0));
  if (!Number.isFinite(goal) || goal < 1) throw new Error('goalSats is required.');

  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length === 0) throw new Error('At least one funding input is required.');

  let totalIn = 0;
  const rows = [];
  for (const row of list) {
    const tx = bitcoin.Transaction.fromHex(String(row.txHex || '').trim());
    let vout = row.vout;
    if (vout == null) {
      vout = findP2trVoutForAddress(tx, paymentAddress, network);
    } else {
      vout = Number(vout);
    }
    if (vout < 0 || vout >= tx.outs.length) throw new Error('Invalid vout for crowdfund input.');
    const out = tx.outs[vout];
    const scriptPub = out.script;
    const wantScript = bitcoin.address.toOutputScript(String(paymentAddress).trim(), network);
    if (!Buffer.isBuffer(scriptPub) || !scriptPub.equals(wantScript)) {
      throw new Error('Input does not pay the crowdfund P2TR address.');
    }
    const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
    if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid input value.');
    totalIn += inputSats;
    rows.push({ tx, vout, out, inputSats });
  }

  if (totalIn < goal) {
    throw new Error(`Confirmed inputs sum ${totalIn} sats is below campaign goal ${goal} sats.`);
  }

  const destSats = totalIn - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust; increase funding or lower fee.');

  const psbt = new Psbt({ network });
  const controlBlock = buildTapLeafControlBlock(payBuf, refBuf, payBuf);

  for (const r of rows) {
    psbt.addInput({
      hash: r.tx.getId(),
      index: r.vout,
      witnessUtxo: {
        script: r.out.script,
        value: r.inputSats
      },
      tapInternalKey: TAPROOT_INTERNAL_NUMS,
      tapLeafScript: [{
        leafVersion: bip341.LEAF_VERSION_TAPSCRIPT,
        script: payBuf,
        controlBlock
      }]
    });
  }

  psbt.addOutput({
    address: dest,
    value: destSats
  });

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    totalInputSats: totalIn,
    destSats,
    feeSats: fee,
    inputCount: rows.length
  };
}

/**
 * Unsigned PSBT for refund path (arbiter only). Sets nLocktime = refundLocktimeHeight; CSV sequence on inputs.
 */
function prepareCrowdfundRefundPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    paymentAddress,
    payoutScript,
    refundScript,
    refundLocktimeHeight,
    destinationAddress,
    feeSats
  } = opts;

  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, paymentAddress, network);
  if (vout < 0) throw new Error('Funding tx has no P2TR output matching paymentAddress.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid crowdfund output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust.');
  const payBuf = Buffer.isBuffer(payoutScript) ? payoutScript : Buffer.from(String(payoutScript), 'hex');
  const refBuf = Buffer.isBuffer(refundScript) ? refundScript : Buffer.from(String(refundScript), 'hex');
  const lock = Number(refundLocktimeHeight);
  if (!Number.isFinite(lock) || lock < 1) throw new Error('refundLocktimeHeight is required.');

  const controlBlock = buildTapLeafControlBlock(payBuf, refBuf, refBuf);
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
      script: refBuf,
      controlBlock
    }]
  });
  psbt.addOutput({
    address: String(destinationAddress || '').trim(),
    value: destSats
  });

  return {
    psbt,
    psbtBase64: psbt.toBase64(),
    inputSats,
    destSats,
    feeSats: fee,
    locktime: lock
  };
}

function signAllInputsWithKey (psbt, priv32) {
  const priv = Buffer.isBuffer(priv32) ? priv32 : Buffer.from(priv32);
  if (priv.length !== 32) throw new Error('Private key must be 32 bytes.');
  const kp = ecpair.fromPrivateKey(priv);
  for (let i = 0; i < psbt.inputCount; i++) {
    psbt.signInput(i, kp);
  }
}

/**
 * Finalize payout inputs (2-of-2 tapscript with leading DROP commitments).
 */
function finalizeCrowdfundPayoutPsbt (psbt) {
  for (let i = 0; i < psbt.inputCount; i++) {
    psbt.finalizeInput(i, (_inputIndex, input) => {
      const leaf = (input.tapLeafScript || [])[0];
      if (!leaf || !leaf.script || !leaf.controlBlock) {
        throw new Error('Missing tapLeafScript on PSBT input.');
      }
      const lh = bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
      const sigs = (input.tapScriptSig || []).filter((t) => t.leafHash.equals(lh));
      if (sigs.length < 2) throw new Error('Need two tapscript signatures for crowdfund payout leaf.');
      const ordered = sigs.slice().sort((a, b) => a.pubkey.compare(b.pubkey));
      const witness = [];
      for (const t of ordered) {
        const sig = t.signature.length >= 64 ? t.signature.subarray(0, 64) : t.signature;
        witness.push(sig);
      }
      witness.push(leaf.script, leaf.controlBlock);
      return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
    });
  }
}

function finalizeCrowdfundRefundPsbt (psbt) {
  psbt.finalizeInput(0, (_inputIndex, input) => {
    const leaf = (input.tapLeafScript || [])[0];
    if (!leaf || !leaf.script || !leaf.controlBlock) {
      throw new Error('Missing tapLeafScript on refund input.');
    }
    const lh = bip341.tapleafHash({ output: leaf.script, version: leaf.leafVersion });
    const tss = (input.tapScriptSig || []).find((t) => t.leafHash.equals(lh));
    if (!tss) throw new Error('Missing tapscript signature for refund leaf.');
    const sig = tss.signature.length >= 64 ? tss.signature.subarray(0, 64) : tss.signature;
    const witness = [sig, leaf.script, leaf.controlBlock];
    return { finalScriptWitness: psbtutils.witnessStackToScriptWitness(witness) };
  });
}

function extractPsbtTransaction (psbt) {
  const extracted = psbt.extractTransaction();
  return { txHex: extracted.toHex(), txid: extracted.getId() };
}

module.exports = {
  TAPROOT_INTERNAL_NUMS,
  networkForFabricName,
  parseCompressedPubkey33,
  buildCrowdfundP2tr,
  buildTapLeafControlBlock,
  findP2trVoutForAddress,
  prepareCrowdfundPayoutPsbt,
  prepareCrowdfundRefundPsbt,
  signAllInputsWithKey,
  finalizeCrowdfundPayoutPsbt,
  finalizeCrowdfundRefundPsbt,
  extractPsbtTransaction,
  u64LePush,
  sortedXOnlyPair
};
