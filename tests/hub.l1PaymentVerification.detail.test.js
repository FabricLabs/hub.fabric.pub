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
});
