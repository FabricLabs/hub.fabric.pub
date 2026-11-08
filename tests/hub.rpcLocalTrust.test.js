'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

function fakeReq (headers = {}, remoteAddress = '127.0.0.1') {
  return { socket: { remoteAddress }, headers, method: 'POST', path: '/services/rpc' };
}

describe('Hub#_isLocalRpcRequest', function () {
  const hub = { _loopbackAllowedHosts: [] };
  const isLocal = (req) => Hub.prototype._isLocalRpcRequest.call(hub, req);
  const host = { host: '127.0.0.1:8080' };

  it('trusts same-origin pages and non-browser clients on loopback', function () {
    assert.strictEqual(isLocal(fakeReq(host)), true, 'curl / scripts (no Origin)');
    assert.strictEqual(isLocal(fakeReq({ ...host, origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })), true, 'Hub UI');
  });

  it('does not trust another site reaching the Hub over loopback', function () {
    assert.strictEqual(isLocal(fakeReq({ ...host, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' })), false);
    assert.strictEqual(isLocal(fakeReq({ ...host, origin: 'https://evil.example' })), false, 'Origin without Sec-Fetch headers');
    assert.strictEqual(isLocal(fakeReq({ ...host, origin: 'null' })), false, 'sandboxed iframe / file:');
    assert.strictEqual(isLocal(fakeReq({ ...host, origin: 'http://127.0.0.1:9998', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' })), false, 'another local port');
  });

  it('still refuses non-loopback sockets and rebound Host names', function () {
    assert.strictEqual(isLocal(fakeReq(host, '192.168.1.9')), false);
    assert.strictEqual(isLocal(fakeReq({ host: 'evil.example:8080' })), false);
  });

  it('is what the HTTP JSON-RPC handler uses', async function () {
    const seen = [];
    const fake = {
      http: { methods: { Probe: () => 'ok' } },
      _isLocalRpcRequest (req) { seen.push(req.headers.origin); return false; }
    };
    const res = {
      statusCode: 200,
      body: null,
      setHeader () {},
      status (c) { this.statusCode = c; return this; },
      json (b) { this.body = b; return this; }
    };
    const req = fakeReq({ ...host, origin: 'https://evil.example' });
    req.body = { jsonrpc: '2.0', id: 1, method: 'Probe', params: [] };
    await Hub.prototype._handleHttpJsonRpcRequest.call(fake, req, res);
    assert.deepStrictEqual(seen, ['https://evil.example']);
    assert.strictEqual(res.body.result, 'ok');
  });
});

describe('Hub#_rpcCallerIsOperator', function () {
  const GOOD = 'good-token';
  const base = { _verifyOperatorAdminToken: (t) => t === GOOD };

  /** Run `_rpcCallerIsOperator(params)` inside the HTTP JSON-RPC handler (sets the local store). */
  async function viaHttp (params, local) {
    const fake = Object.assign({}, base, {
      http: { methods: { Probe: (...p) => Hub.prototype._rpcCallerIsOperator.call(fake, p) } },
      _isLocalRpcRequest: () => local
    });
    const res = {
      body: null,
      setHeader () {},
      status () { return this; },
      json (b) { this.body = b; return this; }
    };
    const req = { headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'Probe', params } };
    await Hub.prototype._handleHttpJsonRpcRequest.call(fake, req, res);
    return res.body.result;
  }

  it('accepts a valid admin token in any object param', function () {
    const isOp = (p) => Hub.prototype._rpcCallerIsOperator.call(base, p);
    assert.strictEqual(isOp([{ adminToken: GOOD }]), true);
    assert.strictEqual(isOp(['127.0.0.1:7777', { token: GOOD }]), true, 'token after a string param');
    assert.strictEqual(isOp([{ address: 'x' }, 'nick', { adminToken: GOOD }]), true);
  });

  it('refuses missing or wrong tokens outside a local HTTP call (WebSocket, remote)', function () {
    const isOp = (p) => Hub.prototype._rpcCallerIsOperator.call(base, p);
    assert.strictEqual(isOp([]), false);
    assert.strictEqual(isOp(['127.0.0.1:7777']), false);
    assert.strictEqual(isOp([{ adminToken: 'forged' }]), false);
  });

  it('treats a same-origin loopback HTTP call as the operator, and a cross-site one not', async function () {
    assert.strictEqual(await viaHttp([], true), true);
    assert.strictEqual(await viaHttp([], false), false);
    assert.strictEqual(await viaHttp([{ adminToken: GOOD }], false), true);
  });
});

describe('Payjoin session lists (gap 3)', function () {
  function fakeHub (calls) {
    return {
      http: { jsonOrShell: (req, res, fn) => fn() },
      setup: { verifyAdminToken: (t) => t === 'good' },
      _extractOptionalAdminTokenFromRequest: Hub.prototype._extractOptionalAdminTokenFromRequest,
      _requireAdminTokenForHubWalletHttp: Hub.prototype._requireAdminTokenForHubWalletHttp,
      _getPayjoinService: () => ({
        listSessions () { calls.push('list'); return [{ id: 's1' }]; },
        getSession (id) { return { id, amountSats: 1000 }; }
      })
    };
  }
  function res () {
    return { statusCode: 200, body: null, setHeader () {}, status (c) { this.statusCode = c; return this; }, json (b) { this.body = b; return this; } };
  }

  it('GET /services/payjoin/sessions needs the admin token', async function () {
    const calls = [];
    const r = res();
    await Hub.prototype._handlePayjoinSessionsListRequest.call(fakeHub(calls), { headers: {}, query: {} }, r);
    assert.strictEqual(r.statusCode, 403);
    assert.strictEqual(calls.length, 0);
    const ok = res();
    await Hub.prototype._handlePayjoinSessionsListRequest.call(fakeHub(calls), { headers: { authorization: 'Bearer good' }, query: {} }, ok);
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(ok.body.sessions[0].id, 's1');
  });
});
