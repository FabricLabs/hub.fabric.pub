'use strict';

const assert = require('assert');
const ops = require('../functions/payjoinInternalOperations');
const PayjoinService = require('../services/payjoin');

describe('payjoinInternalOperations', function () {
  it('is off by default', function () {
    for (const op of ops.listOperations({ enable: true })) assert.strictEqual(op.enabled, false, op.id);
    assert.strictEqual(new PayjoinService({}).operationEnabled('walletSend'), false);
  });

  it('enables implemented operations only, with per-operation overrides', function () {
    const settings = { enable: true, internal: { enable: true, operations: { distributeInvoice: false } } };
    assert.strictEqual(ops.operationEnabled(settings, 'walletSend'), true);
    assert.strictEqual(ops.operationEnabled(settings, 'distributeInvoice'), false);
    for (const op of ops.OPERATIONS.filter((o) => o.status !== ops.STATUS.IMPLEMENTED)) {
      assert.strictEqual(ops.operationEnabled(settings, op.id), false, `${op.id} is ${op.status}`);
      assert.ok(op.reason, `${op.id} says why`);
    }
    assert.strictEqual(ops.operationEnabled({ enable: false, internal: { enable: true } }, 'walletSend'), false, 'payjoin.enable=false wins');
    assert.strictEqual(ops.operationEnabled(settings, 'nope'), false);
  });

  it('the Hub hook answers stubs and disabled operations without Payjoin', function () {
    const Hub = require('../services/hub');
    const hub = Object.create(Hub.prototype);
    hub._getPayjoinService = () => new PayjoinService({ internal: { enable: true } });
    assert.strictEqual(hub._payjoinHook('walletSend').payjoin, true);
    assert.deepStrictEqual(hub._payjoinHook('faucet'), { payjoin: false, reason: 'stub' });
    assert.deepStrictEqual(hub._payjoinHook('coinjoin'), { payjoin: false, reason: 'not-applicable' });
    hub._getPayjoinService = () => new PayjoinService({});
    assert.deepStrictEqual(hub._payjoinHook('walletSend'), { payjoin: false, reason: 'disabled' });
  });

  it('splits BIP21 destinations', function () {
    const Hub = require('../services/hub');
    const hub = Object.create(Hub.prototype);
    const addr = 'bcrt1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
    assert.deepStrictEqual(hub._paymentDestination({ to: addr }), { address: addr, bip21: '', amountSats: null });
    const uri = `bitcoin:${addr}?amount=0.0001&pj=https%3A%2F%2Fpay.example%2Fpj`;
    assert.deepStrictEqual(hub._paymentDestination({ to: uri }), { address: addr, bip21: uri, amountSats: 10000 });
    assert.strictEqual(hub._paymentDestination({ to: `bitcoin:${addr}?amount=0.0001` }).bip21, '');
  });
});

describe('PayjoinService sends (SatoshiPortal send / getSend / cancelSend)', function () {
  function svc (sender) {
    const s = new PayjoinService({ network: 'regtest', internal: { enable: true, maxAdditionalFeeContributionSats: 500 } });
    s.attach({ sender });
    return s;
  }

  it('records a broadcast send and caps the fee contribution', async function () {
    let opts;
    const s = svc(async (o) => {
      opts = o;
      o.onStage('original-built', {});
      return { txid: 'f'.repeat(64), originalTxid: 'e'.repeat(64), address: 'bcrt1q', amountSats: 1000, check: {} };
    });
    const events = [];
    s.on('send', (v) => events.push(v.status));
    const send = await s.createSend({ bip21: 'bitcoin:bcrt1q?amount=0.00001&pj=https://x/pj', maxAdditionalFeeContributionSats: 9999 });
    assert.strictEqual(send.status, 'broadcast');
    assert.strictEqual(send.txid, 'f'.repeat(64));
    assert.strictEqual(opts.maxAdditionalFeeContributionSats, 500);
    assert.strictEqual(s.getSend(send.id).status, 'broadcast');
    assert.strictEqual(s.listSends().length, 1);
    assert.deepStrictEqual(events, ['pending', 'broadcast']);
    await assert.rejects(s.cancelSend(send.id), /already broadcast/);
  });

  it('records a failed send with its code', async function () {
    const s = svc(async () => { throw Object.assign(new Error('Payjoin proposal lowered the payment.'), { code: 'proposal-rejected' }); });
    const send = await s.createSend({ bip21: 'bitcoin:x?pj=https://x/pj' });
    assert.strictEqual(send.status, 'failed');
    assert.strictEqual(send.error.code, 'proposal-rejected');
    assert.strictEqual(send.txid, undefined);
  });

  it('cancels a send in flight', async function () {
    let release;
    let cancelledSeen;
    const s = svc(async (o) => {
      await new Promise((resolve) => { release = resolve; });
      cancelledSeen = o.isCancelled();
      throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    });
    const pending = s.createSend({ bip21: 'bitcoin:x?pj=https://x/pj' });
    await new Promise((resolve) => setImmediate(resolve));
    const [id] = Object.keys(s._payjoinState.sends);
    assert.strictEqual((await s.cancelSend(id)).status, 'cancelled');
    release();
    const done = await pending;
    assert.strictEqual(cancelledSeen, true);
    assert.strictEqual(done.status, 'cancelled');
  });

  it('refuses without a wallet', async function () {
    await assert.rejects(new PayjoinService({}).createSend({ bip21: 'bitcoin:x' }), /sender unavailable/);
  });
});
