'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { Transaction, address, networks } = bitcoin;
const Key = require('@fabric/core/types/key');
const FederationsService = require('../services/federations');

bitcoin.initEccLib(ecc);

/** Shared fake chain: wallet sends create confirmed vault UTXOs; broadcasts are recorded. */
function fakeChain () {
  const txs = new Map();
  const utxos = [];
  const broadcasts = [];
  return {
    broadcasts,
    walletSend ({ address: to, amountSats }) {
      const tx = new Transaction();
      tx.version = 2;
      tx.addInput(crypto.randomBytes(32), 0);
      tx.addOutput(address.toOutputScript(to, networks.regtest), BigInt(amountSats));
      txs.set(tx.getId(), tx.toHex());
      utxos.push({ address: to, txid: tx.getId(), vout: 0, amount: amountSats / 1e8, height: 200 });
      return tx.getId();
    },
    rpc (method, params) {
      if (method === 'scantxoutset') {
        const addr = /^addr\((.+)\)$/.exec(params[1][0])[1];
        return { unspents: utxos.filter((u) => u.address === addr) };
      }
      if (method === 'getblockhash') return '00'.repeat(32);
      if (method === 'getrawtransaction') {
        if (!txs.has(params[0])) throw new Error('No such transaction');
        return txs.get(params[0]);
      }
      if (method === 'sendrawtransaction') {
        const tx = Transaction.fromHex(params[0]);
        if (txs.has(tx.getId())) throw new Error('txn-already-in-mempool');
        txs.set(tx.getId(), params[0]);
        broadcasts.push(tx);
        return tx.getId();
      }
      throw new Error(`unexpected rpc ${method}`);
    }
  };
}

/** Three Hubs on a flooding mesh: a published body reaches every other Hub, signed by its sender. */
function mesh (n, opts = {}) {
  const chain = fakeChain();
  const hubs = [];
  const files = [];
  for (let i = 0; i < n; i++) {
    const key = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const store = new Map();
    files.push(store);
    const svc = new FederationsService({ network: 'regtest', tickMs: 0, resendMinMs: 0, ...opts });
    svc.attach({
      key,
      fs: { publish: async (p, v) => store.set(p, JSON.stringify(v)), readFile: (p) => store.get(p) || null },
      rpc: async (m, p) => chain.rpc(m, p),
      walletSend: async (o) => chain.walletSend(o),
      publish: (body) => {
        const wire = JSON.parse(JSON.stringify(body));
        for (const other of hubs) {
          if (other !== svc) other.handleContractMessage(wire, key.pubkey.slice(2));
        }
        return true;
      }
    });
    hubs.push(svc);
  }
  return { hubs, chain, files };
}

async function settle (hubs) {
  for (let i = 0; i < 5; i++) {
    await Promise.all(hubs.map((h) => h._queue));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('FederationsService (in-memory mesh)', function () {
  it('creates, joins, deposits, and withdraws 2-of-3', async function () {
    const { hubs, chain } = mesh(3);
    await Promise.all(hubs.map((h) => h.start()));
    const [a, b, c] = hubs;

    const created = await a.create({
      name: 'Launch',
      threshold: 2,
      members: [{ pubkey: b.pubkey, url: 'http://127.0.0.1:30181/x', alias: 'b' }, { pubkey: c.pubkey }]
    });
    await settle(hubs);
    assert.strictEqual(created.status, 'pending');
    assert.deepStrictEqual(b.pending().invites.map((v) => v.id), [created.id]);
    assert.strictEqual(b.list()[0].vaultAddress, created.vaultAddress);
    assert.strictEqual(b.list()[0].members.find((m) => m.pubkey === b.pubkey).url, 'http://127.0.0.1:30181');

    await assert.rejects(a.deposit(created.id, { amountSats: 100000 }), /every member must accept/);
    await b.respond(created.id, true);
    await c.respond(created.id, true);
    await settle(hubs);
    for (const h of hubs) assert.strictEqual(h.list()[0].status, 'active');

    const dep = await a.deposit(created.id, { amountSats: 100000, feeRateSatVb: 2 });
    assert.strictEqual(dep.vaultAddress, created.vaultAddress);
    const view = await c.get(created.id);
    assert.strictEqual(view.balanceSats, 100000);

    const dest = address.toBech32(crypto.randomBytes(20), 0, 'bcrt');
    const w = await a.createWithdrawal(created.id, { destinationAddress: dest, amountSats: 60000, feeSats: 600 });
    await settle(hubs);
    assert.strictEqual(w.status, 'pending');
    assert.strictEqual(chain.broadcasts.length, 0, 'one signature must not broadcast');
    const waiting = b.pending().withdrawals;
    assert.strictEqual(waiting.length, 1);
    assert.strictEqual(waiting[0].requestId, w.requestId);

    await b.approveWithdrawal(created.id, w.requestId);
    await settle(hubs);
    assert.strictEqual(chain.broadcasts.length, 1);
    const tx = chain.broadcasts[0];
    assert.strictEqual(tx.ins[0].witness.length, 5);
    assert.strictEqual(tx.outs.length, 2);
    for (const h of hubs) {
      const ws = h.list()[0].withdrawals;
      assert.strictEqual(ws[0].status, 'broadcast', 'every member sees the broadcast');
      assert.strictEqual(ws[0].txid, tx.getId());
    }
    assert.strictEqual(c.pending().withdrawals.length, 0);
  });

  it('ignores invites not signed by the publisher and requests that do not match', async function () {
    const { hubs } = mesh(3);
    await Promise.all(hubs.map((h) => h.start()));
    const [a, b, c] = hubs;
    const created = await a.create({ threshold: 2, members: [{ pubkey: b.pubkey }, { pubkey: c.pubkey }] });
    await settle(hubs);
    const record = b._records.get(created.id);

    // Forged invite: same body, signed by c.
    const fresh = new FederationsService({ network: 'regtest', tickMs: 0 });
    fresh.attach({ key: b.key });
    await fresh.start();
    await fresh._handle({ contract: created.id, type: 'FederationInvite', federationId: created.id, descriptor: record.descriptor }, c.pubkey.slice(2))
      .then(() => assert.fail('accepted a forged invite'), (err) => assert.match(err.message, /publisher/));

    // Withdrawal whose request id does not match its contents.
    await b.respond(created.id, true);
    await c.respond(created.id, true);
    await settle(hubs);
    await assert.rejects(c._handle({
      contract: created.id,
      type: 'FederationWithdrawalRequest',
      federationId: created.id,
      requestId: 'ab'.repeat(32),
      fundedTxHex: '00',
      vout: 0,
      destinationAddress: 'x',
      amountSats: 1000,
      feeSats: 100
    }, a.pubkey.slice(2)));
  });

  it('refuses mainnet without the gate and caps it with the gate', async function () {
    const key = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const other = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const off = new FederationsService({ network: 'mainnet', tickMs: 0 });
    off.attach({ key });
    await off.start();
    await assert.rejects(off.create({ threshold: 2, members: [{ pubkey: other.pubkey }] }), /FABRIC_FEDERATION_MAINNET/);
    const on = new FederationsService({ network: 'mainnet', tickMs: 0, allowMainnet: true });
    assert.strictEqual(on.settings.maxDepositSats, 1000000);
    assert.throws(() => on._checkCap(1000001, on.settings.maxDepositSats, 'deposit'), /cap/);
  });

  it('keeps one-key thresholds out of multi-Hub federations', async function () {
    const { hubs } = mesh(2);
    await Promise.all(hubs.map((h) => h.start()));
    await assert.rejects(hubs[0].create({ threshold: 1, members: [{ pubkey: hubs[1].pubkey }] }), /at least 2/);
  });
});

describe('named federation mailbox', function () {
  const Message = require('@fabric/core/types/message');
  const Federation = require('@fabric/core/types/federation');
  const { encodeFabricUri, decodeFabricUri } = require('@fabric/core/functions/fabricUri');

  function frame (key, body) {
    const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
    msg.signWithKey(key);
    return encodeFabricUri(msg);
  }

  function read (uri) {
    return JSON.parse(decodeFabricUri(uri).message.data);
  }

  async function hubWithPassport () {
    const chain = fakeChain();
    const key = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const passport = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const relayed = [];
    const hub = new FederationsService({ network: 'regtest', tickMs: 0, resendMinMs: 0 });
    hub.attach({
      key,
      rpc: async (m, p) => chain.rpc(m, p),
      walletSend: async (o) => chain.walletSend(o),
      publish: (body) => {
        const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
        msg.signWithKey(key);
        return msg;
      },
      relay: (msg) => relayed.push(msg)
    });
    await hub.start();
    return { hub, chain, passport, relayed };
  }

  it('carries a whole withdrawal for a member without a Fabric peer', async function () {
    const { hub, chain, passport, relayed } = await hubWithPassport();
    const created = await hub.create({ name: 'Ops', threshold: 2, members: [{ pubkey: passport.pubkey }] });

    // The member finds its invite by pubkey and checks it.
    let inbox = hub.framesFor(passport.pubkey);
    assert.strictEqual(inbox.messages.length, 1);
    const invite = read(inbox.messages[0].fabric);
    const descriptor = Federation.verifyInvite(invite, decodeFabricUri(inbox.messages[0].fabric).author);
    assert.strictEqual(Federation.descriptorId(descriptor), created.id);
    assert.strictEqual(hub.framesFor(new Key({ private: crypto.randomBytes(32).toString('hex') }).pubkey).messages.length, 0);

    // Accepting over HTTP activates the federation and goes out to the mesh.
    await hub.submitFrame(frame(passport, Federation.responseMessage(created.id, true)));
    assert.strictEqual(relayed.length, 1);
    assert.strictEqual(hub.list()[0].status, 'active');
    // Signing is deterministic: the same member's retry is the same frame.
    const again = await hub.submitFrame(frame(passport, Federation.responseMessage(created.id, true)));
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(relayed.length, 1);

    // Fund the vault; the public read hands out what a member needs to build a spend.
    await hub.deposit(created.id, { amountSats: 100000 });
    const vault = await hub.vault(created.id);
    assert.strictEqual(vault.balanceSats, 100000);
    assert.deepStrictEqual(Object.keys(vault.utxos[0]).sort(), ['amountSats', 'height', 'txHex', 'txid', 'vout']);
    assert.strictEqual(vault.utxos[0].amountSats, 100000);

    // The Hub asks; the member rebuilds the request before signing it.
    const dest = address.toBech32(crypto.randomBytes(20), 0, 'bcrt');
    const w = await hub.createWithdrawal(created.id, { destinationAddress: dest, amountSats: 40000, feeSats: 500 });
    inbox = hub.framesFor(passport.pubkey, { since: inbox.next });
    const request = inbox.messages.map((m) => read(m.fabric)).find((b) => b.type === Federation.MESSAGE_TYPES.withdrawal);
    const prepared = Federation.verifyWithdrawalRequest(descriptor, request);
    assert.strictEqual(prepared.requestId, w.requestId);
    const signed = Federation.signWithdrawal({ psbtBase64: prepared.psbtBase64, privateKey: Buffer.from(passport.private, 'hex') });
    await hub.submitFrame(frame(passport, Federation.signatureMessage(created.id, w.requestId, signed.signatures)));
    assert.strictEqual(chain.broadcasts.length, 1);
    assert.strictEqual(hub.list()[0].withdrawals[0].status, 'broadcast');
  });

  it('posts its own frames to members it can reach by URL', async function () {
    const { hub, passport } = await hubWithPassport();
    const delivered = [];
    hub.attach({ deliver: async (url, fabric) => { delivered.push({ url, fabric }); } });
    const created = await hub.create({ threshold: 2, members: [{ pubkey: passport.pubkey, url: 'https://member.example' }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(delivered.map((d) => d.url), ['https://member.example']);
    const invite = read(delivered[0].fabric);
    assert.strictEqual(invite.type, Federation.MESSAGE_TYPES.invite);
    assert.strictEqual(Federation.descriptorId(invite.descriptor), created.id);
  });

  it('keeps only frames from members of federations it has seen', async function () {
    const { hub, passport } = await hubWithPassport();
    const stranger = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const created = await hub.create({ threshold: 2, members: [{ pubkey: passport.pubkey }] });
    await assert.rejects(hub.submitFrame(frame(stranger, Federation.responseMessage(created.id, true))), /not a member/);
    await assert.rejects(hub.submitFrame(frame(passport, Federation.responseMessage('ab'.repeat(32), true))), /unknown federation/);
    await assert.rejects(hub.submitFrame(frame(passport, { contract: created.id, type: 'ChatMessage' })), /not a federation message/);
    const unsigned = encodeFabricUri(Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(Federation.syncMessage(created.id))]));
    await assert.rejects(hub.submitFrame(unsigned), /unsigned/);

    // A federation the Hub is not in still gets a mailbox once its invite arrives.
    const other = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const descriptor = Federation.buildDescriptor({ validators: [passport.pubkey, other.pubkey], threshold: 2, network: 'regtest', publisher: other.pubkey });
    await hub.submitFrame(frame(other, Federation.inviteMessage({ descriptor })));
    assert.strictEqual(hub.framesFor(passport.pubkey).messages.filter((m) => m.federationId === Federation.descriptorId(descriptor)).length, 1);
    assert.strictEqual(hub.list().length, 1);
  });

  it('keeps the mailbox across restarts', async function () {
    const files = new Map();
    const fs = {
      readFile: (name) => (files.has(name) ? Buffer.from(JSON.stringify(files.get(name))) : null),
      publish: async (name, value) => { files.set(name, JSON.parse(JSON.stringify(value))); }
    };
    const key = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const passport = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const publish = (body) => {
      const msg = Message.fromVector(['CONTRACT_MESSAGE', JSON.stringify(body)]);
      msg.signWithKey(key);
      return msg;
    };
    const first = new FederationsService({ network: 'regtest', tickMs: 0 });
    first.attach({ key, fs, publish });
    await first.start();
    await first.create({ threshold: 2, members: [{ pubkey: passport.pubkey }] });
    await first.stop();
    const second = new FederationsService({ network: 'regtest', tickMs: 0 });
    second.attach({ key, fs, publish });
    await second.start();
    const inbox = second.framesFor(passport.pubkey);
    assert.strictEqual(inbox.messages.length, 1);
    assert.strictEqual(inbox.messages[0].type, Federation.MESSAGE_TYPES.invite);
    await second.stop();
  });

  it('broadcasts only transactions that spend the vault', async function () {
    const { hub, passport } = await hubWithPassport();
    const created = await hub.create({ threshold: 2, members: [{ pubkey: passport.pubkey }] });
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(address.toOutputScript(address.toBech32(crypto.randomBytes(20), 0, 'bcrt'), networks.regtest), 1000n);
    await assert.rejects(hub.broadcastTransaction(created.id, tx.toHex()), /does not spend/);
    await assert.rejects(hub.vault('cd'.repeat(32)), /unknown federation/);
  });
});
