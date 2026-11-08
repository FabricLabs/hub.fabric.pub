'use strict';

const assert = require('assert');
const { createHubContractsClient, query } = require('../functions/hubContractsClient');

function stubFetch (routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const hit = routes[path] || { status: 404, body: { status: 'error', message: 'not found' } };
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      json: async () => {
        if (hit.body === undefined) throw new Error('no body');
        return hit.body;
      }
    };
  };
  return { fetch, calls };
}

describe('hubContractsClient', function () {
  it('builds query strings without empty values', function () {
    assert.strictEqual(query({ a: 1, b: '', c: null, d: 'x y' }), '?a=1&d=x%20y');
    assert.strictEqual(query({}), '');
  });

  it('calls a Hub with its headers and unwraps records', async function () {
    const { fetch, calls } = stubFetch({
      '/federations': { status: 200, body: { type: 'Federations', viewer: { role: 'operator' }, federations: [] } },
      '/federations/abc': { status: 200, body: { type: 'Federation', federation: { id: 'abc' } } },
      '/federations/abc/messages?since=3&limit=5': { status: 200, body: { messages: [], next: 3, more: false } },
      '/messages?type=A%2CB&contract=c1&limit=10': { status: 200, body: { messages: [], total: 0 } },
      '/messages/m1': { status: 200, body: { type: 'FabricMessage', message: { id: 'm1' } } },
      '/contracts/k1': { status: 200, body: { status: 'ok', contract: null, application: { contractId: 'k1' } } }
    });
    const client = createHubContractsClient({
      baseUrl: 'https://hub.example/',
      fetch,
      headers: (method, path) => ({ 'X-Path': `${method} ${path}` })
    });
    assert.strictEqual(client.baseUrl, 'https://hub.example');
    assert.deepStrictEqual((await client.listFederations()).viewer, { role: 'operator' });
    assert.deepStrictEqual(await client.getFederation('abc'), { id: 'abc' });
    assert.strictEqual((await client.federationMessages('abc', { since: 3, limit: 5 })).next, 3);
    assert.strictEqual((await client.listMessages({ type: ['A', 'B'], contract: 'c1', limit: 10 })).total, 0);
    assert.deepStrictEqual(await client.getMessage('m1'), { id: 'm1' });
    assert.deepStrictEqual(await client.getContract('k1'), { contract: null, application: { contractId: 'k1' } });
    assert.strictEqual(calls[0].init.credentials, 'include');
    assert.strictEqual(calls[0].init.headers.Accept, 'application/json');
    assert.strictEqual(calls[1].init.headers['X-Path'], 'GET /federations/abc');
  });

  it('turns HTTP and body errors into errors with a status', async function () {
    const { fetch, calls } = stubFetch({
      '/messages/bad': { status: 200, body: { status: 'error', message: 'message not found' } },
      '/federations': { status: 503, body: { available: false, message: 'Federations are disabled on this Hub node.' } },
      '/contracts/x': { status: 500 }
    });
    const client = createHubContractsClient({ fetch, headers: { Authorization: 'Bearer t' } });
    await assert.rejects(client.getMessage('bad'), (e) => e.status === 404 && /message not found/.test(e.message));
    await assert.rejects(client.listFederations(), (e) => e.status === 503 && /disabled/.test(e.message));
    await assert.rejects(client.getContract('x'), (e) => e.status === 500 && e.message === 'HTTP 500');
    await assert.rejects(client.getFederation('none'), (e) => e.status === 404);
    assert.strictEqual(calls[0].init.credentials, 'same-origin');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer t');
  });

  it('needs a fetch', async function () {
    const saved = global.fetch;
    try {
      delete global.fetch;
      const client = createHubContractsClient({});
      await assert.rejects(client.listFederations(), /fetch unavailable/);
    } finally {
      if (saved) global.fetch = saved;
    }
  });
});
