'use strict';

const assert = require('assert');
const Hub = require('../services/hub');
const { createSingleFlight } = require('../functions/hubWorkQueues');

describe('Hub slow Bitcoin RPC', function () {
  it('sends UTXO-set-wide calls through a long-timeout copy of the RPC client', async function () {
    const quick = [];
    const bitcoin = {
      settings: {},
      rpc: { options: { host: '127.0.0.1', port: 1, timeout: 15000 }, request () {} },
      _makeRPCRequestOnce (method) {
        quick.push(method);
        return Promise.resolve('quick');
      }
    };
    const slow = [];
    const hub = Object.create(Hub.prototype);
    hub._bitcoinTxOutSet = createSingleFlight({ ttlMs: 30000 });
    hub._bitcoinSlowRPC = (btc, method, params) => {
      slow.push([method, params]);
      return Promise.resolve('slow');
    };

    hub._routeSlowBitcoinRPC(bitcoin);
    hub._routeSlowBitcoinRPC(bitcoin);

    assert.strictEqual(await bitcoin._makeRPCRequestOnce('getblockchaininfo'), 'quick');
    assert.strictEqual(await bitcoin._makeRPCRequestOnce('gettxoutsetinfo'), 'slow');
    assert.strictEqual(await bitcoin._makeRPCRequestOnce('scantxoutset', ['start', []]), 'slow');
    assert.deepStrictEqual(quick, ['getblockchaininfo']);
    assert.deepStrictEqual(slow, [['gettxoutsetinfo', ['none']], ['scantxoutset', ['start', []]]]);
  });

  it('shares one bare gettxoutsetinfo across a burst of blocks', async function () {
    const bitcoin = { settings: {}, rpc: null, _makeRPCRequestOnce: () => Promise.resolve('quick') };
    const hub = Object.create(Hub.prototype);
    hub._bitcoinTxOutSet = createSingleFlight({ ttlMs: 30000 });
    let calls = 0;
    hub._bitcoinSlowRPC = () => {
      calls++;
      return new Promise((resolve) => setTimeout(() => resolve({ height: 7 }), 10));
    };
    hub._routeSlowBitcoinRPC(bitcoin);
    const results = await Promise.all(Array.from({ length: 50 }, () => bitcoin._makeRPCRequestOnce('gettxoutsetinfo')));
    assert.strictEqual(calls, 1);
    assert.ok(results.every((r) => r.height === 7));
    await bitcoin._makeRPCRequestOnce('gettxoutsetinfo', ['muhash']);
    assert.strictEqual(calls, 2);
  });

  it('lets core finish its sync before the supply walk returns', async function () {
    let finish;
    const bitcoin = {
      settings: {},
      rpc: null,
      _state: { content: {} },
      commits: 0,
      commit () { this.commits++; },
      _makeRPCRequestOnce: () => Promise.resolve('quick'),
      async _syncSupply () { throw new Error('core supply sync ran'); }
    };
    const hub = Object.create(Hub.prototype);
    hub._bitcoinTxOutSet = createSingleFlight({ ttlMs: 30000 });
    hub._bitcoinSlowRPC = () => new Promise((resolve) => { finish = resolve; });
    hub._routeSlowBitcoinRPC(bitcoin);

    assert.strictEqual(await bitcoin._syncSupply(), bitcoin);
    assert.strictEqual(bitcoin._state.content.supply, undefined);
    finish({ total_amount: 21 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(bitcoin._state.content.supply, 21);
    assert.strictEqual(bitcoin.commits, 1);
  });

  it('builds the long-timeout client from the core client options', async function () {
    const hub = Object.create(Hub.prototype);
    const bitcoin = { settings: {}, rpc: { options: { host: '127.0.0.1', port: 9, timeout: 15000 }, request () {} } };
    await hub._bitcoinSlowRPC(bitcoin, 'gettxoutsetinfo').catch(() => {});
    assert.strictEqual(hub._bitcoinSlowClient.options.timeout, 300000);
    assert.strictEqual(hub._bitcoinSlowClient.options.port, 9);
  });
});
