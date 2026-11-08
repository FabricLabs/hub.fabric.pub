'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub _l1PaymentVerificationDetail', function () {
  const addr = 'bcrt1qexamplepayeeaddress000000000000000000';

  function makeHubStub () {
    return Object.create(Hub.prototype);
  }

  it('returns verified with confirmations when vout pays address enough', async function () {
    const hub = makeHubStub();
    const bitcoin = {
      _makeRPCRequest: async (method) => {
        if (method === 'getrawtransaction') {
          return {
            confirmations: 3,
            vout: [
              { value: 0.00005, scriptPubKey: { address: 'bcrt1qother' } },
              { value: 0.0001, scriptPubKey: { address: addr } }
            ]
          };
        }
        if (method === 'getrawmempool') return [];
        throw new Error('unexpected ' + method);
      }
    };
    const d = await hub._l1PaymentVerificationDetail(bitcoin, 'a'.repeat(64), addr, 10_000);
    assert.strictEqual(d.verified, true);
    assert.strictEqual(d.confirmations, 3);
    assert.strictEqual(d.inMempool, false);
    assert.strictEqual(d.matchedSats, 10_000);
  });

  it('sets inMempool when confirmations 0 and txid in mempool', async function () {
    const txid = 'b'.repeat(64);
    const hub = makeHubStub();
    const bitcoin = {
      _makeRPCRequest: async (method, params) => {
        if (method === 'getrawtransaction') {
          return {
            confirmations: 0,
            vout: [{ value: 0.001, scriptPubKey: { address: addr } }]
          };
        }
        if (method === 'getrawmempool') return [txid];
        throw new Error('unexpected ' + method);
      }
    };
    const d = await hub._l1PaymentVerificationDetail(bitcoin, txid, addr, 50_000);
    assert.strictEqual(d.verified, true);
    assert.strictEqual(d.confirmations, 0);
    assert.strictEqual(d.inMempool, true);
  });

  it('returns empty shape when getrawtransaction fails', async function () {
    const hub = makeHubStub();
    const bitcoin = {
      _makeRPCRequest: async () => {
        throw new Error('no tx');
      }
    };
    const d = await hub._l1PaymentVerificationDetail(bitcoin, 'c'.repeat(64), addr, 1);
    assert.strictEqual(d.verified, false);
    assert.strictEqual(d.matchedSats, 0);
  });

  it('falls back to wallet gettransaction when getrawtransaction cannot see a wallet send', async function () {
    const hub = makeHubStub();
    const hex = '02000000000100';
    const bitcoin = {
      walletName: 'hub',
      _makeRPCRequest: async (method, params) => {
        if (method === 'getrawtransaction') {
          throw new Error('[-5] No such mempool or blockchain transaction. Use gettransaction for wallet transactions.');
        }
        if (method === 'decoderawtransaction') {
          assert.strictEqual(params[0], hex);
          return {
            vout: [{ value: 0.000025, scriptPubKey: { address: addr } }]
          };
        }
        if (method === 'getrawmempool') return [];
        throw new Error('unexpected ' + method);
      },
      _makeWalletRequest: async (method, params, wallet) => {
        assert.strictEqual(method, 'gettransaction');
        assert.strictEqual(wallet, 'hub');
        assert.strictEqual(params[0], 'd'.repeat(64));
        return { hex, confirmations: 1 };
      }
    };
    const d = await hub._l1PaymentVerificationDetail(bitcoin, 'd'.repeat(64), addr, 2500);
    assert.strictEqual(d.verified, true);
    assert.strictEqual(d.confirmations, 1);
    assert.strictEqual(d.inMempool, false);
    assert.strictEqual(d.matchedSats, 2500);
  });

  it('finds a mined payment that is not ours in the blocks since fromHeight (no txindex)', async function () {
    const hub = makeHubStub();
    const txid = 'e'.repeat(64);
    const blocks = { 100: ['x'], 101: ['y', txid], 102: ['z'], 103: [] };
    const asked = [];
    const bitcoin = {
      walletName: 'hub',
      _makeRPCRequest: async (method, params) => {
        if (method === 'getrawtransaction') {
          if (params[2] === 'hash101') return { confirmations: 3, hex: 'beef', vout: [{ value: 0.00005, scriptPubKey: { address: addr } }] };
          throw new Error('[-5] No such mempool transaction. Use -txindex or provide a block hash.');
        }
        if (method === 'getblockcount') return 103;
        if (method === 'getblockhash') { asked.push(params[0]); return `hash${params[0]}`; }
        if (method === 'getblock') return { tx: blocks[params[0].slice(4)] };
        if (method === 'getrawmempool') return [];
        throw new Error('unexpected ' + method);
      },
      _makeWalletRequest: async () => { throw new Error('[-5] Invalid or non-wallet transaction id'); }
    };
    assert.strictEqual((await hub._l1PaymentVerificationDetail(bitcoin, txid, addr, 5000)).verified, false);
    const d = await hub._l1PaymentVerificationDetail(bitcoin, txid, addr, 5000, { fromHeight: 100 });
    assert.strictEqual(d.verified, true);
    assert.strictEqual(d.confirmations, 3);
    assert.strictEqual(d.hex, 'beef');
    assert.deepStrictEqual(asked, [103, 102, 101]);
  });
});
