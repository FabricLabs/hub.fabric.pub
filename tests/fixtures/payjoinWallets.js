'use strict';

// Mock Bitcoin Core wallets for Payjoin tests: a sender wallet (bitcoind-style
// RPC over one or more P2WPKH coins) and a receiver Hub wallet (the Fabric
// Bitcoin service shape used by functions/payjoinReceiverContribution.js).

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);

bitcoin.initEccLib(ecc);
const ecpair = ECPairFactory(ecc);
const network = bitcoin.networks.regtest;

function fundingTx (script, value) {
  const tx = new bitcoin.Transaction();
  tx.addInput(crypto.randomBytes(32), 0, 0xffffffff);
  tx.addOutput(script, BigInt(value));
  return tx;
}

function outpoint (txInput) {
  return `${Buffer.from(txInput.hash).reverse().toString('hex')}:${txInput.index}`;
}

function txidOfPsbt (psbt) {
  return Buffer.from(bitcoin.crypto.hash256(Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()))).reverse().toString('hex');
}

/**
 * A Hub-side receiver wallet: coins at one P2WPKH key, an owned receive address.
 * @param {Object} [opts]
 * @param {number[]} [opts.values]
 * @param {Set<string>} [opts.alsoMine] more addresses `getaddressinfo` reports as ours
 */
function receiverWallet (opts = {}) {
  const kp = ecpair.makeRandom({ network });
  const pay = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network });
  const receiveKp = ecpair.makeRandom({ network });
  const receiveAddress = bitcoin.payments.p2wpkh({ pubkey: receiveKp.publicKey, network }).address;
  const coins = (opts.values || [90000, 160000, 400000]).map((value) => ({ tx: fundingTx(pay.output, value), value }));
  const mine = new Set([pay.address, receiveAddress, ...(opts.alsoMine || [])]);
  const calls = [];
  const svc = {
    network: 'regtest',
    mine,
    async _makeRPCRequest (method, params) {
      calls.push({ method, params });
      if (method === 'testmempoolaccept') return [{ allowed: true }];
      if (method === 'getaddressinfo') return { ismine: mine.has(params[0]) };
      if (method === 'listunspent') {
        return coins.map((c) => ({
          txid: c.tx.getId(),
          vout: 0,
          amount: c.value / 1e8,
          scriptPubKey: Buffer.from(pay.output).toString('hex'),
          spendable: true,
          solvable: true,
          safe: true
        }));
      }
      if (method === 'walletprocesspsbt') {
        const psbt = bitcoin.Psbt.fromBase64(params[0], { network });
        psbt.txInputs.forEach((txInput, i) => {
          const txid = Buffer.from(txInput.hash).reverse().toString('hex');
          if (coins.some((c) => c.tx.getId() === txid)) {
            psbt.signInput(i, kp, [bitcoin.Transaction.SIGHASH_ALL]);
            psbt.finalizeInput(i);
          }
        });
        return { psbt: psbt.toBase64(), complete: false };
      }
      if (method === 'lockunspent') return true;
      if (method === 'gettransaction' || method === 'getrawtransaction') throw new Error('No such transaction');
      if (method === 'sendrawtransaction') return bitcoin.Transaction.fromHex(params[0]).getId();
      throw new Error(`unexpected receiver RPC ${method}`);
    }
  };
  return { kp, pay, coins, svc, calls, receiveAddress, mine };
}

/**
 * A sender wallet behind a bitcoind-style RPC (`walletcreatefundedpsbt`,
 * `walletprocesspsbt`, `finalizepsbt`, ...), for the Hub sender.
 * @param {Object} [opts]
 * @param {number[]} [opts.values] coin values
 * @param {number} [opts.feeSats=400]
 */
function senderWallet (opts = {}) {
  const kp = ecpair.makeRandom({ network });
  const pay = bitcoin.payments.p2wpkh({ pubkey: kp.publicKey, network });
  const changeAddress = bitcoin.payments.p2wpkh({ pubkey: ecpair.makeRandom({ network }).publicKey, network }).address;
  const coins = (opts.values || [300000]).map((value) => ({ tx: fundingTx(pay.output, value), value }));
  const ours = new Set(coins.map((c) => `${c.tx.getId()}:0`));
  const mine = new Set([pay.address, changeAddress]);
  const calls = [];
  const feeSats = opts.feeSats || 400;

  async function rpc (method, params = []) {
    calls.push({ method, params });
    if (method === 'walletcreatefundedpsbt') {
      const outputs = params[1];
      const [[address, btc]] = Object.entries(outputs[0]);
      const amount = Math.round(Number(btc) * 1e8);
      const psbt = new bitcoin.Psbt({ network });
      let total = 0;
      for (const c of coins) {
        psbt.addInput({ hash: c.tx.getId(), index: 0, sequence: 0xfffffffd, witnessUtxo: { script: pay.output, value: BigInt(c.value) } });
        total += c.value;
        if (total >= amount + feeSats + 1000) break;
      }
      psbt.addOutput({ address, value: BigInt(amount) });
      psbt.addOutput({ address: changeAddress, value: BigInt(total - amount - feeSats) });
      return { psbt: psbt.toBase64(), fee: feeSats / 1e8, changepos: 1 };
    }
    if (method === 'walletprocesspsbt') {
      const psbt = bitcoin.Psbt.fromBase64(params[0], { network });
      psbt.txInputs.forEach((txInput, i) => {
        const data = psbt.data.inputs[i];
        if (!ours.has(outpoint(txInput)) || data.finalScriptWitness) return;
        if (!data.witnessUtxo) {
          const c = coins.find((x) => `${x.tx.getId()}:0` === outpoint(txInput));
          psbt.updateInput(i, { witnessUtxo: { script: pay.output, value: BigInt(c.value) } });
        }
        psbt.signInput(i, kp, [bitcoin.Transaction.SIGHASH_ALL]);
        psbt.finalizeInput(i);
      });
      const complete = psbt.data.inputs.every((d) => d.finalScriptWitness || d.finalScriptSig);
      return { psbt: psbt.toBase64(), complete };
    }
    if (method === 'finalizepsbt') {
      const psbt = bitcoin.Psbt.fromBase64(params[0], { network });
      const complete = psbt.data.inputs.every((d) => d.finalScriptWitness || d.finalScriptSig);
      return complete ? { hex: psbt.extractTransaction().toHex(), complete } : { psbt: params[0], complete };
    }
    if (method === 'testmempoolaccept') return [{ allowed: true }];
    if (method === 'sendrawtransaction') return bitcoin.Transaction.fromHex(params[0]).getId();
    if (method === 'lockunspent') return true;
    if (method === 'getaddressinfo') return { ismine: mine.has(params[0]) };
    throw new Error(`unexpected sender RPC ${method}`);
  }

  return { kp, pay, coins, rpc, calls, changeAddress, mine };
}

/**
 * Rebuild a PSBT with its inputs in `order` (indices into the old inputs),
 * optionally changing input data. For tests of sender-side checks.
 */
function reorderInputs (psbtBase64, order, mutate) {
  const old = bitcoin.Psbt.fromBase64(psbtBase64, { network });
  const next = new bitcoin.Psbt({ network });
  next.setVersion(old.version);
  next.setLocktime(old.locktime);
  for (const i of order) {
    const txInput = old.txInputs[i];
    const data = Object.assign({}, old.data.inputs[i]);
    if (mutate) mutate(data, i);
    next.addInput({ hash: Buffer.from(txInput.hash), index: txInput.index, sequence: txInput.sequence });
    next.updateInput(next.txInputs.length - 1, data);
  }
  old.txOutputs.forEach((o) => next.addOutput({ script: o.script, value: o.value }));
  return next.toBase64();
}

module.exports = {
  bitcoin,
  ecpair,
  network,
  fundingTx,
  outpoint,
  txidOfPsbt,
  receiverWallet,
  senderWallet,
  reorderInputs
};
