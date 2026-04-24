'use strict';

/**
 * Deterministic P2TR federation vault: NUMS internal key + single tapscript leaf
 * implementing k-of-n Schnorr multisig (BIP342 CHECKSIG / CHECKSIGADD + NUMEQUAL).
 *
 * Used by GET /services/distributed/vault and PrepareFederationVaultWithdrawalPsbt.
 */

const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const bip341 = require('bitcoinjs-lib/src/payments/bip341');
const { payments, networks, script, Psbt } = bitcoin;
const { DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS } = require('./beaconFederationConstants');

bitcoin.initEccLib(ecc);

/** BIP341-style NUMS x-only internal key (script-path spend only). */
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

function parseCompressedPubkeysSorted (hexList) {
  const out = [];
  for (const h of hexList) {
    const s = String(h || '').trim().toLowerCase();
    if (!/^(02|03)[0-9a-f]{64}$/i.test(s)) {
      throw new Error(`Invalid validator pubkey (expect 33-byte compressed hex): ${s.slice(0, 18)}…`);
    }
    out.push(Buffer.from(s, 'hex'));
  }
  out.sort((a, b) => a.compare(b));
  const uniq = [];
  for (const b of out) {
    if (!uniq.length || uniq[uniq.length - 1].compare(b) !== 0) uniq.push(b);
  }
  return uniq;
}

function toXOnly (pubkey33) {
  if (!Buffer.isBuffer(pubkey33) || pubkey33.length !== 33) return null;
  if (pubkey33[0] !== 0x02 && pubkey33[0] !== 0x03) return null;
  return pubkey33.subarray(1, 33);
}

function buildKOfNTapscript (sortedPubkeys33, threshold) {
  const keys = sortedPubkeys33.map(toXOnly).filter(Boolean);
  if (keys.length !== sortedPubkeys33.length) throw new Error('Internal pubkey parse error.');
  const k = Math.max(1, Math.min(Number(threshold) || 1, keys.length));
  if (keys.length === 1) {
    if (k !== 1) throw new Error('With one validator, threshold must be 1.');
    return script.compile([keys[0], script.OPS.OP_CHECKSIG]);
  }
  const chunks = [keys[0], script.OPS.OP_CHECKSIG];
  for (let i = 1; i < keys.length; i++) {
    chunks.push(keys[i], script.OPS.OP_CHECKSIGADD);
  }
  chunks.push(script.number.encode(k), script.OPS.OP_NUMEQUAL);
  return script.compile(chunks);
}

/**
 * @param {Object} opts
 * @param {string[]} opts.validatorPubkeysHex — compressed secp256k1 pubkeys (02/03…)
 * @param {number} opts.threshold — k for k-of-n
 * @param {string} [opts.networkName]
 */
function buildFederationVaultFromPolicy ({ validatorPubkeysHex, threshold, networkName }) {
  const pks = parseCompressedPubkeysSorted(validatorPubkeysHex);
  if (!pks.length) throw new Error('At least one validator pubkey is required.');
  const thr = Math.max(1, Math.min(Number(threshold) || 1, pks.length));
  const multisigScript = buildKOfNTapscript(pks, thr);
  const network = networkForFabricName(networkName);
  const pay = payments.p2tr({
    internalPubkey: TAPROOT_INTERNAL_NUMS,
    scriptTree: { output: multisigScript },
    network
  });
  if (!pay.address || !pay.output) throw new Error('p2tr did not produce vault address.');
  return {
    address: pay.address,
    output: pay.output,
    multisigScript,
    network: networkName,
    threshold: thr,
    validatorsSortedHex: pks.map((b) => b.toString('hex')),
    internalPubkeyHex: TAPROOT_INTERNAL_NUMS.toString('hex'),
    depositMaturityBlocks: DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
  };
}

function buildVaultControlBlock (multisigScript) {
  const scriptTree = { output: multisigScript };
  const hashTree = bip341.toHashTree(scriptTree);
  const leafVersion = bip341.LEAF_VERSION_TAPSCRIPT;
  const leafHash = bip341.tapleafHash({ output: multisigScript, version: leafVersion });
  const path = bip341.findScriptPath(hashTree, leafHash);
  if (path === undefined) throw new Error('Vault script not in tap tree.');
  const outputKey = bip341.tweakKey(TAPROOT_INTERNAL_NUMS, hashTree.hash);
  if (!outputKey) throw new Error('Taproot tweak failed for vault.');
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
 * Unsigned PSBT spending a vault UTXO via the k-of-n tapscript path (admin workflow).
 */
function prepareVaultWithdrawalPsbt (opts = {}) {
  const {
    networkName,
    fundedTxHex,
    vaultAddress,
    multisigScript,
    destinationAddress,
    feeSats
  } = opts;
  const network = networkForFabricName(networkName);
  const tx = bitcoin.Transaction.fromHex(String(fundedTxHex || '').trim());
  const vout = findP2trVoutForAddress(tx, vaultAddress, network);
  if (vout < 0) throw new Error('Funding tx has no P2TR output matching vault address.');
  const out = tx.outs[vout];
  const inputSats = typeof out.value === 'bigint' ? Number(out.value) : Number(out.value);
  if (!Number.isFinite(inputSats) || inputSats <= 0) throw new Error('Invalid vault output value.');
  const fee = Math.max(1, Math.round(Number(feeSats || 1000)));
  const destSats = inputSats - fee;
  if (destSats < 546) throw new Error('Amount after fee is below dust; lower fee or use a larger UTXO.');

  const ms = Buffer.isBuffer(multisigScript)
    ? multisigScript
    : Buffer.from(String(multisigScript || '').replace(/^0x/i, ''), 'hex');
  if (!ms.length) throw new Error('multisigScript is required (from GET /services/distributed/vault).');

  const dest = String(destinationAddress || '').trim();
  if (!dest) throw new Error('destinationAddress is required.');

  const controlBlock = buildVaultControlBlock(ms);
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
      script: ms,
      controlBlock
    }]
  });
  psbt.addOutput({
    address: dest,
    value: destSats
  });

  return {
    psbtBase64: psbt.toBase64(),
    vaultAddress: String(vaultAddress || '').trim(),
    vout,
    inputSats,
    destSats,
    feeSats: fee,
    tapscriptHex: ms.toString('hex'),
    controlBlockHex: controlBlock.toString('hex'),
    signingNotes: 'Validators partially sign the same PSBT input (tapscript leaf). Witness stack order when finalized: <sig_1> … <sig_k> <tapscript> <control_block> (BIP341 script path). Pubkey order in the script is sorted compressed pubkeys (same as manifest).'
  };
}

module.exports = {
  TAPROOT_INTERNAL_NUMS,
  buildFederationVaultFromPolicy,
  prepareVaultWithdrawalPsbt,
  buildVaultControlBlock,
  networkForFabricName,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS
};
