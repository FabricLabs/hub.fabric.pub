'use strict';

const assert = require('assert');
const Hub = require('../services/hub');
const {
  PUBLIC_BITCOIND_RPC_METHODS,
  FORBIDDEN_BITCOIND_RPC_METHODS,
  bitcoindRpcAccess
} = require('../functions/bitcoindRpcPolicy');

function fakeRes () {
  return {
    statusCode: 200,
    body: null,
    setHeader () {},
    status (code) { this.statusCode = code; return this; },
    json (body) { this.body = body; return this; }
  };
}

function fakeHub (calls) {
  return {
    _getBitcoinService () {
      return {
        settings: { network: 'regtest' },
        async _makeRPCRequest (method, params) {
          calls.push({ method, params });
          return 'ok';
        }
      };
    }
  };
}

describe('functions/bitcoindRpcPolicy', function () {
  it('allows read-only chain methods without a token', function () {
    for (const m of ['getblockhash', 'getblock', 'getrawtransaction', 'estimatesmartfee']) {
      assert.strictEqual(bitcoindRpcAccess(m).allowed, true, m);
    }
  });

  it('requires the admin token for wallet, network and mining methods', function () {
    for (const m of ['sendtoaddress', 'getbalance', 'listunspent', 'walletpassphrase', 'getnetworkinfo', 'addnode', 'generatetoaddress', 'sendrawtransaction', 'scantxoutset']) {
      const a = bitcoindRpcAccess(m);
      assert.strictEqual(a.allowed, false, m);
      assert.strictEqual(a.status, 403);
      assert.strictEqual(bitcoindRpcAccess(m, { isAdmin: true }).allowed, true, m);
    }
  });

  it('refuses host-file and shutdown methods even for admin', function () {
    for (const m of ['dumpwallet', 'dumpprivkey', 'backupwallet', 'importwallet', 'loadwallet', 'stop', 'dumptxoutset', 'migratewallet']) {
      assert.strictEqual(bitcoindRpcAccess(m, { isAdmin: true }).allowed, false, m);
    }
  });

  it('normalizes case so mixed-case names cannot slip past', function () {
    assert.strictEqual(bitcoindRpcAccess('SendToAddress').allowed, false);
    assert.strictEqual(bitcoindRpcAccess('STOP', { isAdmin: true }).allowed, false);
    assert.strictEqual(bitcoindRpcAccess('').allowed, false);
  });

  it('keeps the public and forbidden sets disjoint', function () {
    for (const m of FORBIDDEN_BITCOIND_RPC_METHODS) assert.ok(!PUBLIC_BITCOIND_RPC_METHODS.has(m), m);
  });
});

describe('Hub#_hubBitcoindJsonRpc access', function () {
  it('forwards a public method without a token', async function () {
    const calls = [];
    const res = fakeRes();
    await Hub.prototype._hubBitcoindJsonRpc.call(fakeHub(calls), { jsonrpc: '2.0', id: 1, method: 'getblockhash', params: [1] }, res);
    assert.deepStrictEqual(calls, [{ method: 'getblockhash', params: [1] }]);
    assert.strictEqual(res.body.result, 'ok');
  });

  it('refuses a wallet method without a token and never reaches bitcoind', async function () {
    const calls = [];
    const res = fakeRes();
    await Hub.prototype._hubBitcoindJsonRpc.call(fakeHub(calls), { jsonrpc: '2.0', id: 7, method: 'sendtoaddress', params: ['bcrt1q', 1] }, res);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.id, 7);
    assert.ok(/admin token/.test(res.body.error.message));
  });

  it('forwards a wallet method for admin', async function () {
    const calls = [];
    const res = fakeRes();
    await Hub.prototype._hubBitcoindJsonRpc.call(fakeHub(calls), { jsonrpc: '2.0', id: 1, method: 'getbalance', params: [] }, res, { isAdmin: true });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(res.body.result, 'ok');
  });

  it('refuses dumpwallet for admin', async function () {
    const calls = [];
    const res = fakeRes();
    await Hub.prototype._hubBitcoindJsonRpc.call(fakeHub(calls), { jsonrpc: '2.0', id: 1, method: 'dumpwallet', params: ['/tmp/x'] }, res, { isAdmin: true });
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(res.statusCode, 403);
  });
});
