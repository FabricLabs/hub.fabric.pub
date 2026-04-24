'use strict';

const assert = require('assert');
const { hydrateHubNetworkStatusViaHttp } = require('../functions/hydrateHubNetworkStatusViaHttp');

describe('functions/hydrateHubNetworkStatusViaHttp', function () {
  it('returns false when bridge cannot apply', async function () {
    const ok = await hydrateHubNetworkStatusViaHttp(null, 'http://127.0.0.1:8080');
    assert.strictEqual(ok, false);
  });

  it('calls applyHubNetworkStatusPayload with JSON-RPC result', async function () {
    const payload = { network: { address: '0.0.0.0:7777', listening: true }, peers: [] };
    let applied = null;
    const bridge = {
      applyHubNetworkStatusPayload (r) {
        applied = r;
        return true;
      }
    };
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      json: async () => ({ jsonrpc: '2.0', id: 1, result: payload })
    });
    try {
      const ok = await hydrateHubNetworkStatusViaHttp(bridge, 'http://127.0.0.1:8080');
      assert.strictEqual(ok, true);
      assert.strictEqual(applied, payload);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns false on fetch failure', async function () {
    const bridge = {
      applyHubNetworkStatusPayload () {
        return true;
      }
    };
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('net'); };
    try {
      const ok = await hydrateHubNetworkStatusViaHttp(bridge, 'http://127.0.0.1:8080');
      assert.strictEqual(ok, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
