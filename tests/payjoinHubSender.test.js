'use strict';

// Hub wallet as BIP78 sender (functions/payjoinHubSender.js), against the
// Hub's own receiver contribution. Every refusal must broadcast nothing and
// unlock the original's coins.

const assert = require('assert');
const { encodeBitcoinUri } = require('@fabric/core/functions/bip21');
const { sendPayjoin } = require('../functions/payjoinHubSender');
const { contributeReceiverInput, parseBip78Params } = require('../functions/payjoinReceiverContribution');
const { bitcoin, network, senderWallet, receiverWallet, reorderInputs } = require('./fixtures/payjoinWallets');

const PJ = 'http://127.0.0.1:18080/services/payjoin/sessions/s1/proposals';

function bip21 (address, amountSats, pj = PJ) {
  return encodeBitcoinUri({ address, amount: amountSats / 1e8, extras: { pj } });
}

/** A receiver endpoint: the Hub's contribution, optionally tampered with. */
function receiverFetch (receiver, tamper) {
  const seen = [];
  const fetchFn = async (endpoint, init) => {
    seen.push({ endpoint, init });
    const query = Object.fromEntries(new URL(endpoint).searchParams.entries());
    const out = await contributeReceiverInput({
      psbtBase64: init.body,
      bitcoin: receiver.svc,
      receiverAddress: receiver.receiveAddress,
      networkName: 'regtest',
      params: parseBip78Params(query)
    });
    const body = tamper ? tamper(out.psbtBase64) : out.psbtBase64;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  };
  fetchFn.seen = seen;
  return fetchFn;
}

function broadcasts (sender) {
  return sender.calls.filter((c) => c.method === 'sendrawtransaction');
}

function unlocked (sender) {
  return sender.calls.filter((c) => c.method === 'lockunspent' && c.params[0] === true);
}

describe('payjoinHubSender (BIP78 sender on the Hub wallet)', function () {
  it('pays a pj= URI: one receiver input added, our inputs re-signed, broadcast', async function () {
    const sender = senderWallet();
    const receiver = receiverWallet();
    const fetchFn = receiverFetch(receiver);
    const stages = [];
    const out = await sendPayjoin({
      bip21: bip21(receiver.receiveAddress, 100000),
      rpc: sender.rpc,
      networkName: 'regtest',
      feeRateSatVb: 2,
      fetchFn,
      onStage: (s) => stages.push(s)
    });
    assert.ok(/^[0-9a-f]{64}$/.test(out.txid));
    assert.notStrictEqual(out.txid, out.originalTxid);
    assert.deepStrictEqual(stages, ['original-built', 'proposal-received', 'broadcast']);
    const sent = bitcoin.Transaction.fromHex(broadcasts(sender)[0].params[0]);
    assert.strictEqual(sent.ins.length, 2, 'sender coin + receiver coin');
    assert.strictEqual(unlocked(sender).length, 0);
    const url = new URL(fetchFn.seen[0].endpoint);
    assert.strictEqual(url.searchParams.get('v'), '1');
    assert.strictEqual(url.searchParams.get('additionalfeeoutputindex'), '1');
    assert.strictEqual(url.searchParams.get('disableoutputsubstitution'), 'true');
    assert.strictEqual(fetchFn.seen[0].init.redirect, 'error');
  });

  it('dry run builds and checks the original, unlocks, and never contacts the receiver', async function () {
    const sender = senderWallet();
    let contacted = false;
    const out = await sendPayjoin({
      bip21: bip21(receiverWallet().receiveAddress, 50000),
      rpc: sender.rpc,
      networkName: 'regtest',
      dryRun: true,
      fetchFn: async () => { contacted = true; }
    });
    assert.strictEqual(out.dryRun, true);
    assert.strictEqual(contacted, false);
    assert.strictEqual(broadcasts(sender).length, 0);
    assert.strictEqual(unlocked(sender).length, 1);
  });

  async function refuses (tamper, code, pattern, opts = {}) {
    const sender = senderWallet({ values: opts.values, feeSats: opts.feeSats });
    const receiver = receiverWallet();
    await assert.rejects(sendPayjoin({
      bip21: bip21(receiver.receiveAddress, opts.amount || 100000),
      rpc: opts.rpc ? opts.rpc(sender) : sender.rpc,
      networkName: 'regtest',
      fetchFn: opts.fetchFn || receiverFetch(receiver, tamper),
      timeoutMs: opts.timeoutMs,
      maxResponseBytes: opts.maxResponseBytes
    }), (err) => err.code === code && pattern.test(err.message));
    assert.strictEqual(broadcasts(sender).length, 0, 'nothing broadcast');
    assert.strictEqual(unlocked(sender).length, 1, 'original coins unlocked');
  }

  it('refuses a proposal that lowers the payment', async function () {
    await refuses((b64) => {
      const p = bitcoin.Psbt.fromBase64(b64, { network });
      const q = reorderInputs(b64, p.txInputs.map((_, i) => i));
      const r = bitcoin.Psbt.fromBase64(q, { network });
      // Rebuild outputs with the payee lowered.
      const out = new bitcoin.Psbt({ network });
      r.txInputs.forEach((txInput, i) => {
        out.addInput({ hash: Buffer.from(txInput.hash), index: txInput.index, sequence: txInput.sequence });
        out.updateInput(i, r.data.inputs[i]);
      });
      // The payee (output 0) ends below what the original paid it.
      r.txOutputs.forEach((o, i) => out.addOutput({ script: o.script, value: i === 0 ? 1000n : o.value }));
      return out.toBase64();
    }, 'proposal-rejected', /lowered the payment|dropped output/);
  });

  it('refuses a proposal that adds an output', async function () {
    await refuses((b64) => {
      const p = bitcoin.Psbt.fromBase64(b64, { network });
      p.addOutput({ address: senderWallet().changeAddress, value: 1000n });
      return p.toBase64();
    }, 'proposal-rejected', /added or removed outputs/);
  });

  it('refuses a proposal that reorders our inputs', async function () {
    await refuses((b64) => {
      const p = bitcoin.Psbt.fromBase64(b64, { network });
      const order = p.txInputs.map((_, i) => i);
      const ours = order.filter((i) => !p.data.inputs[i].finalScriptWitness);
      [order[ours[0]], order[ours[1]]] = [order[ours[1]], order[ours[0]]];
      return reorderInputs(b64, order);
    }, 'proposal-rejected', /reordered our inputs/, { values: [60000, 60000], feeSats: 1000 });
  });

  it('refuses a receiver input of another script type', async function () {
    await refuses((b64) => {
      const p = bitcoin.Psbt.fromBase64(b64, { network });
      const theirs = p.txInputs.map((_, i) => i).find((i) => p.data.inputs[i].finalScriptWitness);
      const p2tr = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 7)]);
      return reorderInputs(b64, p.txInputs.map((_, i) => i), (data, i) => {
        if (i === theirs) data.witnessUtxo = { script: p2tr, value: data.witnessUtxo.value };
      });
    }, 'proposal-rejected', /not of our script type/);
  });

  it('refuses a receiver input that is one of our own coins', async function () {
    await refuses(null, 'proposal-rejected', /spends one of our coins/, {
      rpc: (sender) => async (method, params) => {
        if (method === 'getaddressinfo') {
          sender.calls.push({ method, params });
          return { ismine: true };
        }
        return sender.rpc(method, params);
      }
    });
  });

  it('refuses a proposal that takes more fee from us than allowed', async function () {
    await refuses((b64) => {
      const p = bitcoin.Psbt.fromBase64(b64, { network });
      const out = new bitcoin.Psbt({ network });
      p.txInputs.forEach((txInput, i) => {
        out.addInput({ hash: Buffer.from(txInput.hash), index: txInput.index, sequence: txInput.sequence });
        out.updateInput(i, p.data.inputs[i]);
      });
      p.txOutputs.forEach((o, i) => out.addOutput({ script: o.script, value: i === 1 ? o.value - 50000n : o.value }));
      return out.toBase64();
    }, 'proposal-rejected', /more fee from us/);
  });

  it('times out a receiver that does not answer', async function () {
    await refuses(null, 'receiver-error', /did not answer within 50 ms/, {
      timeoutMs: 50,
      fetchFn: (endpoint, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    });
  });

  it('refuses an oversize response', async function () {
    await refuses(null, 'receiver-error', /larger than 100 bytes/, {
      maxResponseBytes: 100,
      fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => 'A'.repeat(500) })
    });
  });

  it('refuses unsafe endpoints before building anything', async function () {
    const sender = senderWallet();
    const address = receiverWallet().receiveAddress;
    const cases = [
      [bip21(address, 1000, 'http://x.onion:1@evil.com/pj'), 'regtest', null],
      [bip21(address, 1000, 'http://hub.example/pj'), 'regtest', false],
      [bip21(address, 1000, 'https://pj.example/pj'), 'regtest', false, async () => ['10.0.0.5']],
      [bip21(address, 1000, 'https://pj.example/pj'), 'regtest', false, async () => ['::1']]
    ];
    for (const [uri, networkName, allowInsecureEndpoints, lookup] of cases) {
      await assert.rejects(sendPayjoin({ bip21: uri, rpc: sender.rpc, networkName, allowInsecureEndpoints, lookup, fetchFn: async () => { throw new Error('dialed'); } }),
        (err) => ['invalid-uri', 'endpoint-refused'].includes(err.code), uri);
    }
    assert.strictEqual(sender.calls.filter((c) => c.method === 'walletcreatefundedpsbt').length, 0);
  });

  it('refuses a URI without an amount', async function () {
    const sender = senderWallet();
    const uri = encodeBitcoinUri({ address: receiverWallet().receiveAddress, extras: { pj: PJ } });
    await assert.rejects(sendPayjoin({ bip21: uri, rpc: sender.rpc, networkName: 'regtest' }), (err) => err.code === 'invalid-uri');
  });
});
