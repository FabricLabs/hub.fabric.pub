'use strict';

const assert = require('assert');
const { createDocumentContractsClient, versionStatus } = require('../functions/documentContractsClient');

describe('documentContractsClient', function () {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const history = {
    contractId: 'f'.repeat(64),
    revisions: [
      { revision: 1, documentIdentifier: a, frameId: '1' },
      { revision: 2, documentIdentifier: b, frameId: '2' }
    ],
    forks: [{ revision: 2, documentIdentifier: c, frameId: '3' }],
    head: { revision: 2, documentIdentifier: b, frameId: '2' }
  };

  it('places a version in its history', function () {
    assert.deepStrictEqual(versionStatus(history, b), { editable: true, revision: 2, latest: true, fork: false, newer: null });
    const old = versionStatus(history, a);
    assert.strictEqual(old.latest, false);
    assert.strictEqual(old.newer.documentIdentifier, b);
    assert.strictEqual(versionStatus(history, c).fork, true);
    assert.strictEqual(versionStatus({ contractId: null, revisions: [] }, a).editable, false);
  });

  it('reads versions over HTTP and edits over JSON-RPC with the given headers', async function () {
    const calls = [];
    const client = createDocumentContractsClient({
      baseUrl: 'http://hub.test/',
      headers: () => ({ Authorization: 'Bearer t' }),
      fetch: async (url, init = {}) => {
        calls.push({ url, init });
        const body = url.endsWith('/services/rpc')
          ? { jsonrpc: '2.0', id: 1, result: { type: 'EditDocumentResult', document: { id: b } } }
          : history;
        return { ok: true, status: 200, json: async () => body };
      }
    });

    assert.strictEqual((await client.revisions(a)).contractId, history.contractId);
    assert.strictEqual(calls[0].url, `http://hub.test/documents/${a}/revisions`);
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer t');

    const edited = await client.edit(a, { content: 'next', adminToken: 'x' });
    assert.strictEqual(edited.document.id, b);
    const sent = JSON.parse(calls[1].init.body);
    assert.strictEqual(sent.method, 'EditDocument');
    assert.deepStrictEqual(sent.params, [{ id: a, content: 'next', adminToken: 'x' }]);
  });

  it('turns refusals into errors', async function () {
    const client = createDocumentContractsClient({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'error', message: 'adminToken required' } }) })
    });
    await assert.rejects(() => client.makeEditable(a), /adminToken required/);
  });
});
