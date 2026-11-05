'use strict';

// Payjoin security review regressions (docs/PAYJOIN.md, findings F1–F10).

const assert = require('assert');
const PayjoinService = require('../services/payjoin');
const { PayjoinAsyncMailbox } = require('../functions/payjoinAsyncMailbox');
const {
  analyzeOriginal,
  chooseContribution,
  contributeReceiverInput,
  MAX_MONEY_SATS
} = require('../functions/payjoinReceiverContribution');
const { bitcoin, network, senderWallet, receiverWallet } = require('./fixtures/payjoinWallets');

/** Signed original from a fresh sender wallet paying `address`. */
async function original (address, amountSats = 100000, sender = senderWallet()) {
  const funded = await sender.rpc('walletcreatefundedpsbt', [[], [{ [address]: amountSats / 1e8 }], 0, {}, true]);
  const signed = await sender.rpc('walletprocesspsbt', [funded.psbt, true, 'ALL', true, true]);
  return { psbt: signed.psbt, sender };
}

/** A Payjoin service on the mock Hub receiver wallet. */
function service (receiver, opts = {}) {
  const svc = new PayjoinService(Object.assign({ network: 'regtest', receiverContribution: true, sweepIntervalMs: 0 }, opts.settings || {}));
  svc.attach({
    bitcoin: receiver.svc,
    isOwnedAddress: opts.isOwnedAddress !== undefined ? opts.isOwnedAddress : async (a) => receiver.mine.has(a)
  });
  return svc;
}

function walletSigns (receiver) {
  return receiver.calls.filter((c) => c.method === 'walletprocesspsbt').length;
}

describe('Payjoin security review', function () {
  describe('F1: no Hub coin for an address the Hub does not own', function () {
    it('forces the contribution off when the session address is foreign', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const foreign = senderWallet().changeAddress;
      const session = await svc.createDepositSession({ address: foreign, amountSats: 1000, receiverContribution: true });
      assert.strictEqual(session.receiverContribution, false);
      assert.strictEqual(session.addressOwned, false);
      const { psbt } = await original(foreign, 1000);
      const result = await svc.submitProposal(session.id, { psbt });
      assert.ok(result.bip78Error, 'answers with a BIP78 error');
      assert.strictEqual(walletSigns(receiver), 0, 'the Hub signed nothing');
    });

    it('fails closed when ownership cannot be checked', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { isOwnedAddress: async () => { throw new Error('rpc down'); } });
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 1000, receiverContribution: true });
      assert.strictEqual(session.receiverContribution, false);
    });

    it('re-checks at contribution time (sessions created before the check, no checker attached)', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { isOwnedAddress: null });
      const foreign = senderWallet().changeAddress;
      const session = await svc.createDepositSession({ address: foreign, amountSats: 1000, receiverContribution: true });
      assert.strictEqual(session.receiverContribution, true, 'unknown at create time');
      const { psbt } = await original(foreign, 1000);
      const result = await svc.submitProposal(session.id, { psbt });
      assert.strictEqual(result.proposal.receiverContribution.ok, false);
      assert.match(result.proposal.receiverContribution.error, /not owned/);
      assert.strictEqual(receiver.calls.filter((c) => c.method === 'listunspent').length, 0, 'no coin was even chosen');
    });

    it('a payer cannot turn the contribution on for its own proposal', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 1000, receiverContribution: false });
      const { psbt } = await original(receiver.receiveAddress, 1000);
      await svc.submitProposal(session.id, { psbt, receiverContribution: true });
      assert.strictEqual(walletSigns(receiver), 0);
    });

    it('contributes to an owned address', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 100000 });
      const { psbt } = await original(receiver.receiveAddress, 100000);
      const result = await svc.submitProposal(session.id, { psbt });
      assert.strictEqual(result.proposal.receiverContribution.ok, true);
      assert.strictEqual(result.bip78Error, null);
    });

    it('refuses an original that pays the session less than its amount (no padded underpayment)', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 100000 });
      const { psbt } = await original(receiver.receiveAddress, 600);
      const result = await svc.submitProposal(session.id, { psbt });
      assert.strictEqual(result.proposal.receiverContribution.errorCode, 'original-psbt-rejected');
      assert.match(result.proposal.receiverContribution.error, /less than the 100000 requested/);
    });
  });

  describe('F2: UTXO probing', function () {
    it('gives one Hub coin per session; a second original is refused', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt });
      const second = await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 150000)).psbt });
      assert.strictEqual(second.bip78Error.errorCode, 'unavailable');
      assert.strictEqual(walletSigns(receiver), 1);
    });

    it('answers the same original with the same proposal', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      const { psbt } = await original(receiver.receiveAddress, 50000);
      const a = await svc.submitProposal(session.id, { psbt });
      const b = await svc.submitProposal(session.id, { psbt });
      assert.strictEqual(a.bip78Psbt, b.bip78Psbt);
      assert.strictEqual(walletSigns(receiver), 1);
    });

    it('refuses inputs already answered in another session', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const sender = senderWallet();
      const s1 = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      await svc.submitProposal(s1.id, { psbt: (await original(receiver.receiveAddress, 50000, sender)).psbt });
      const s2 = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 150000 });
      const r2 = await svc.submitProposal(s2.id, { psbt: (await original(receiver.receiveAddress, 150000, sender)).psbt });
      assert.strictEqual(r2.bip78Error.errorCode, 'unavailable');
      assert.strictEqual(walletSigns(receiver), 1);
    });

    it('caps proposals per session', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { settings: { maxProposalsPerSession: 1 } });
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 1000 });
      await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 1000)).psbt });
      await assert.rejects(svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 1000)).psbt }),
        (err) => err.bip78ErrorCode === 'unavailable');
    });
  });

  describe('F10: fallback and coin release', function () {
    it('broadcasts the original and unlocks the Hub coin when the payjoin never appears', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { settings: { fallbackAfterSeconds: 1 } });
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      const { psbt } = await original(receiver.receiveAddress, 50000);
      const result = await svc.submitProposal(session.id, { psbt });
      const contributed = result.proposal.receiverContribution.contributedOutpoint;
      assert.strictEqual(await svc.sweep(Date.now() - 60000), 0, 'not before the fallback time');
      assert.strictEqual(await svc.sweep(Date.now() + 5000), 1);
      const sent = receiver.calls.filter((c) => c.method === 'sendrawtransaction');
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(bitcoin.Transaction.fromHex(sent[0].params[0]).getId(), result.proposal.receiverContribution.originalTxid);
      const unlock = receiver.calls.find((c) => c.method === 'lockunspent' && c.params[0] === true);
      assert.strictEqual(`${unlock.params[1][0].txid}:${unlock.params[1][0].vout}`, contributed);
      const view = svc.getSession(session.id);
      assert.strictEqual(view.status, 'fallback-broadcast');
      assert.strictEqual(await svc.sweep(Date.now() + 10000), 0, 'settled once');
    });

    it('keeps the coin locked when the payjoin itself was broadcast', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { settings: { fallbackAfterSeconds: 1 } });
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      const result = await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt });
      const payjoinTxid = result.proposal.receiverContribution.proposalTxid;
      const rpc = receiver.svc._makeRPCRequest.bind(receiver.svc);
      receiver.svc._makeRPCRequest = async (method, params) => (method === 'gettransaction' && params[0] === payjoinTxid ? { txid: payjoinTxid } : rpc(method, params));
      await svc.sweep(Date.now() + 5000);
      assert.strictEqual(receiver.calls.filter((c) => c.method === 'sendrawtransaction').length, 0);
      assert.strictEqual(receiver.calls.filter((c) => c.method === 'lockunspent' && c.params[0] === true).length, 0);
      assert.strictEqual(svc.getSession(session.id).status, 'payjoin-broadcast');
    });

    it('cancels a session without a Hub proposal, and refuses once there is one', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const open = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      assert.strictEqual((await svc.cancelSession(open.id)).status, 'cancelled');
      await assert.rejects(svc.submitProposal(open.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt }), /cancelled/);
      const busy = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      await svc.submitProposal(busy.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt });
      await assert.rejects(svc.cancelSession(busy.id), /already has a Hub proposal/);
    });
  });

  describe('F3: no public session or coin data', function () {
    it('capabilities list recent sessions only for the operator', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 1000 });
      assert.strictEqual(svc.getCapabilities().recentSessions, undefined);
      assert.strictEqual(svc.getCapabilities({ operator: true }).recentSessions.length, 1);
    });

    it('the payer view has no proposals or contributions', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt });
      const view = svc.getSession(session.id, { view: 'payer' });
      assert.ok(view.bip21Uri);
      assert.strictEqual(view.proposals, undefined);
      assert.strictEqual(view.receiverContribution, undefined);
      assert.strictEqual(view.merkle, undefined);
    });

    it('the Hub session route gives anonymous callers the payer view', async function () {
      const Hub = require('../services/hub');
      const hub = Object.create(Hub.prototype);
      const receiver = receiverWallet();
      const svc = service(receiver);
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 50000 });
      await svc.submitProposal(session.id, { psbt: (await original(receiver.receiveAddress, 50000)).psbt });
      hub._getPayjoinService = () => svc;
      hub.http = { jsonOrShell (_req, _res, run) { return Promise.resolve().then(run); } };
      hub.setup = { verifyAdminToken: (t) => t === 'admin' };
      hub._extractOptionalAdminTokenFromRequest = (req) => req.headers.authorization;
      let body;
      const res = { status () { return this; }, json (b) { body = b; return this; } };
      await hub._handlePayjoinSessionViewRequest({ headers: {}, params: { sessionId: session.id } }, res);
      assert.strictEqual(body.session.proposals, undefined);
      await hub._handlePayjoinSessionViewRequest({ headers: { authorization: 'admin' }, params: { sessionId: session.id } }, res);
      assert.strictEqual(body.session.proposals.length, 1);
    });

    it('anonymous deposit sessions never get a Hub coin', async function () {
      const Hub = require('../services/hub');
      const hub = Object.create(Hub.prototype);
      const calls = [];
      hub._getPayjoinService = () => ({
        async createDepositSession (input) { calls.push(input); return { id: 's' }; },
        state: { counts: { sessions: 1 } }
      });
      hub._getBitcoinService = () => null;
      hub._state = { content: { services: {} } };
      hub.http = { jsonOrShell (_req, _res, run) { return Promise.resolve().then(run); } };
      hub.setup = { verifyAdminToken: (t) => t === 'admin' };
      hub._extractOptionalAdminTokenFromRequest = (req) => req.headers.authorization;
      const res = { status () { return this; }, json () { return this; } };
      await hub._handlePayjoinDepositRequest({ headers: {}, body: { address: 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', receiverContribution: true } }, res);
      assert.strictEqual(calls[0].receiverContribution, false);
    });
  });

  describe('F4: mailbox capabilities', function () {
    it('uses random 32-byte ids', function () {
      const box = new PayjoinAsyncMailbox({});
      const a = box.createMailbox({});
      const b = box.createMailbox({});
      assert.match(a.id, /^[0-9a-f]{64}$/);
      assert.notStrictEqual(a.id, b.id);
    });

    it('caps open mailboxes', function () {
      const box = new PayjoinAsyncMailbox({ maxMailboxes: 2 });
      box.createMailbox({});
      box.createMailbox({});
      assert.throws(() => box.createMailbox({}), (err) => err.code === 'MAILBOX_LIMIT');
    });
  });

  describe('F5–F8: original checks', function () {
    it('F5: refuses an original that spends a Hub wallet coin', async function () {
      const receiver = receiverWallet();
      const { psbt, sender } = await original(receiver.receiveAddress, 50000);
      receiver.mine.add(sender.pay.address);
      await assert.rejects(contributeReceiverInput({
        psbtBase64: psbt, bitcoin: receiver.svc, receiverAddress: receiver.receiveAddress, networkName: 'regtest'
      }), (err) => err.code === 'original-psbt-rejected' && /spends a Hub wallet coin/.test(err.message));
      assert.strictEqual(receiver.calls.filter((c) => c.method === 'listunspent').length, 0);
    });

    it('F6: never contributes an output of an earlier Hub payjoin', function () {
      const rows = [
        { txid: 'a'.repeat(64), vout: 0, amount: 0.001, scriptPubKey: '0014' + '11'.repeat(20) },
        { txid: 'b'.repeat(64), vout: 0, amount: 0.003, scriptPubKey: '0014' + '22'.repeat(20) }
      ];
      assert.strictEqual(chooseContribution(rows, { paymentSats: 100000 }).txid, 'a'.repeat(64));
      assert.strictEqual(chooseContribution(rows, { paymentSats: 100000, excludeParentTxids: new Set(['a'.repeat(64)]) }).txid, 'b'.repeat(64));
      assert.strictEqual(chooseContribution(rows, { paymentSats: 100000, excludeParentTxids: new Set(['a'.repeat(64), 'b'.repeat(64)]) }), null);
    });

    function forgedOriginal (receiverScript, opts = {}) {
      const psbt = new bitcoin.Psbt({ network });
      const senderScript = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 9)]);
      psbt.addInput({ hash: Buffer.alloc(32, 1), index: 0, witnessUtxo: { script: senderScript, value: BigInt(opts.inValue || 200000) } });
      psbt.addOutput({ script: receiverScript, value: BigInt(opts.outValue || 100000) });
      const r = Buffer.alloc(32, 1);
      const der = Buffer.concat([Buffer.from([0x30, 0x44, 0x02, 0x20]), r, Buffer.from([0x02, 0x20]), r, Buffer.from([opts.sighash || 0x01])]);
      psbt.updateInput(0, { partialSig: [{ pubkey: Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 3)]), signature: der }] });
      return psbt.toBase64();
    }

    it('F7: refuses originals not signed with SIGHASH_ALL', function () {
      const script = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 5)]);
      assert.doesNotThrow(() => analyzeOriginal({ psbtBase64: forgedOriginal(script), receiverScript: script, network }));
      for (const sighash of [0x02, 0x03, 0x81, 0x82]) {
        assert.throws(() => analyzeOriginal({ psbtBase64: forgedOriginal(script, { sighash }), receiverScript: script, network }),
          /only SIGHASH_ALL/, `sighash 0x${sighash.toString(16)}`);
      }
    });

    it('F8: refuses values above MAX_MONEY', function () {
      const script = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 5)]);
      const huge = Number(MAX_MONEY_SATS) + 1;
      assert.throws(() => analyzeOriginal({ psbtBase64: forgedOriginal(script, { inValue: huge }), receiverScript: script, network }), /out of range/);
    });

    it('F8: refuses oversize originals before parsing', async function () {
      const receiver = receiverWallet();
      const svc = service(receiver, { settings: { maxPsbtChars: 100 } });
      const session = await svc.createDepositSession({ address: receiver.receiveAddress, amountSats: 1000 });
      await assert.rejects(svc.submitProposal(session.id, { psbt: 'A'.repeat(101) }), /too large/);
    });
  });
});
