'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { resetFabricBrowserStateStore, writeStorageString } = require('../functions/fabricBrowserState');
require('@babel/register');

describe('Bridge per-blob (v2) purchase deliveries', function () {
  this.timeout(180000);

  let Bridge;
  let previousWindow;
  let previousFetch;
  let events;
  let rpcCalls;

  function createLocalStorageMock () {
    const store = new Map();
    return {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    };
  }

  function installWindowMock () {
    events = [];
    global.window = {
      location: { hostname: 'localhost', port: '8080', protocol: 'http:', pathname: '/', origin: 'http://localhost:8080' },
      localStorage: createLocalStorageMock(),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: (ev) => { events.push(ev); return true; }
    };
  }

  function stubOpenPurchasedDocument (result) {
    rpcCalls = [];
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      rpcCalls.push({ url, body });
      return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    };
  }

  const hex = (n) => crypto.randomBytes(n).toString('hex');
  const ciphertext = Buffer.from('sealed bytes, not the document').toString('base64');

  function perBlobDelivery () {
    return {
      id: 'doc-v2',
      name: 'paper.txt',
      mime: 'text/plain',
      size: 30,
      sha256: 'doc-v2',
      contentBase64: ciphertext,
      merkleRootHex: hex(32),
      htlcFileV1: { v: 2, perBlob: true, merkleRootHex: hex(32), paymentHashHex: hex(32), blobTotal: 1 },
      parts: [{ index: 0, blobHashHex: hex(32), iv: 'aXY=', keyHashHex: hex(32) }]
    };
  }

  /** A document key that marks what it sealed, so a test can tell sealed from plain. */
  function withDocumentKey (bridge) {
    const key = { encrypt: (b64) => `sealed:${b64}`, decrypt: (v) => String(v).replace(/^sealed:/, '') };
    bridge._getDocumentKey = () => key;
    return bridge;
  }

  function deliver (bridge, doc) {
    bridge._handleP2pFileChunk(doc, { transferId: `${doc.id}:${doc.merkleRootHex || 'whole'}`, index: 0, total: 1 });
  }

  before(function () {
    previousWindow = global.window;
    previousFetch = global.fetch;
    installWindowMock();
    Bridge = require('../components/Bridge');
  });

  beforeEach(function () {
    resetFabricBrowserStateStore();
    installWindowMock();
  });

  after(function () {
    global.window = previousWindow;
    global.fetch = previousFetch;
  });

  it('stores a v2 delivery as pending ciphertext, never as readable content', function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const doc = perBlobDelivery();
    deliver(bridge, doc);
    const stored = bridge.globalState.documents['doc-v2'];
    assert.ok(stored, 'document stored');
    assert.strictEqual(stored.htlcPendingDecrypt, true);
    assert.strictEqual(stored.htlcPerBlob, true);
    assert.strictEqual(stored.htlcCiphertextBase64, ciphertext);
    assert.strictEqual(stored.contentBase64, undefined);
    assert.strictEqual(stored.contentEncrypted, undefined);
    assert.deepStrictEqual(stored.htlcFileV1, doc.htlcFileV1);
    assert.deepStrictEqual(stored.parts, doc.parts);
    assert.strictEqual(stored.htlcIvBase64, undefined);
  });

  it('opens a v2 copy through the Hub with the admin token', async function () {
    const bridge = withDocumentKey(new Bridge({ responseCapture: () => {} }));
    deliver(bridge, perBlobDelivery());
    writeStorageString('fabric.hub.adminToken', 'admin-token');
    const plaintext = Buffer.from('the readable paper').toString('base64');
    stubOpenPurchasedDocument({
      type: 'OpenPurchasedDocumentResult',
      status: 'success',
      document: { id: 'doc-v2', name: 'paper.txt', mime: 'text/plain', size: 18, contentBase64: plaintext }
    });

    const r = await bridge.unlockHtlcEncryptedDocument('doc-v2', '');
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(rpcCalls.length, 1);
    assert.strictEqual(rpcCalls[0].url, 'http://localhost:8080/services/rpc');
    assert.strictEqual(rpcCalls[0].body.method, 'OpenPurchasedDocument');
    assert.deepStrictEqual(rpcCalls[0].body.params, [{ id: 'doc-v2', adminToken: 'admin-token' }]);

    const stored = bridge.globalState.documents['doc-v2'];
    assert.ok(!Object.keys(stored).some((k) => k.startsWith('htlc')), 'htlc fields cleared');
    assert.strictEqual(stored.parts, undefined);
    assert.strictEqual(stored.contentBase64, undefined, 'no plaintext at rest');
    assert.strictEqual(stored.contentEncrypted, `sealed:${plaintext}`);
    assert.ok(events.some((ev) => ev.type === 'globalStateUpdate' && ev.detail.operation.path === '/documents/doc-v2'));
  });

  it('passes a hand-entered claim key to the Hub', async function () {
    const bridge = withDocumentKey(new Bridge({ responseCapture: () => {} }));
    deliver(bridge, perBlobDelivery());
    writeStorageString('fabric.hub.adminToken', 'admin-token');
    stubOpenPurchasedDocument({ status: 'error', message: 'no content key yet' });
    const key = hex(32);
    const r = await bridge.unlockHtlcEncryptedDocument('doc-v2', key.toUpperCase());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'no content key yet');
    assert.strictEqual(rpcCalls[0].body.params[0].preimageHex, key);
    assert.strictEqual(bridge.globalState.documents['doc-v2'].htlcPendingDecrypt, true, 'still pending');
  });

  it('uses the admin token it is handed when the browser stores none', async function () {
    const bridge = withDocumentKey(new Bridge({ responseCapture: () => {} }));
    deliver(bridge, perBlobDelivery());
    stubOpenPurchasedDocument({ status: 'error', message: 'later' });
    await bridge.unlockHtlcEncryptedDocument('doc-v2', '', { adminToken: 'prop-token' });
    assert.strictEqual(rpcCalls[0].body.params[0].adminToken, 'prop-token');
  });

  it('does not open a copy while the identity is locked, nor store one that came back after a lock', async function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    deliver(bridge, perBlobDelivery());
    writeStorageString('fabric.hub.adminToken', 'admin-token');
    stubOpenPurchasedDocument({ status: 'success', document: { contentBase64: 'cGxhaW4=' } });
    const locked = await bridge.unlockHtlcEncryptedDocument('doc-v2', '');
    assert.strictEqual(locked.ok, false);
    assert.match(locked.error, /Unlock your identity/);
    assert.strictEqual(rpcCalls.length, 0, 'no request while locked');

    withDocumentKey(bridge);
    const fetchOpen = global.fetch;
    global.fetch = async (url, init) => {
      bridge._getDocumentKey = () => null; // locks while the Hub answers
      return fetchOpen(url, init);
    };
    const late = await bridge.unlockHtlcEncryptedDocument('doc-v2', '');
    assert.strictEqual(late.ok, false);
    const stored = bridge.globalState.documents['doc-v2'];
    assert.strictEqual(stored.htlcPendingDecrypt, true, 'kept pending to retry after unlock');
    assert.strictEqual(stored.contentBase64, undefined);
  });

  it('drops a per-blob delivery with a malformed header or no parts', function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const noRoot = perBlobDelivery();
    delete noRoot.htlcFileV1.merkleRootHex;
    deliver(bridge, noRoot);
    const noParts = Object.assign(perBlobDelivery(), { id: 'doc-v2b', sha256: 'doc-v2b' });
    delete noParts.parts;
    deliver(bridge, noParts);
    assert.strictEqual(bridge.globalState.documents['doc-v2'], undefined);
    assert.strictEqual(bridge.globalState.documents['doc-v2b'], undefined);
  });

  it('says where to open it when this page has no admin token', async function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    deliver(bridge, perBlobDelivery());
    stubOpenPurchasedDocument({ status: 'success' });
    const r = await bridge.unlockHtlcEncryptedDocument('doc-v2', '');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Hub that bought it/);
    assert.strictEqual(rpcCalls.length, 0);
  });

  it('keeps v1 deliveries as before', function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const doc = {
      id: 'doc-v1',
      name: 'v1.txt',
      sha256: 'doc-v1',
      contentBase64: ciphertext,
      htlcFileV1: { v: 1, iv: 'aXZpdml2aXZpdml2', paymentHashHex: hex(32) }
    };
    deliver(bridge, doc);
    const stored = bridge.globalState.documents['doc-v1'];
    assert.strictEqual(stored.htlcPendingDecrypt, true);
    assert.strictEqual(stored.htlcPerBlob, undefined);
    assert.strictEqual(stored.htlcIvBase64, doc.htlcFileV1.iv);
    assert.strictEqual(stored.htlcPaymentHashHex, doc.htlcFileV1.paymentHashHex);
    assert.strictEqual(stored.htlcCiphertextBase64, ciphertext);
    assert.strictEqual(stored.contentBase64, undefined);
  });

  it('a v1 copy unlocked in the browser is no longer marked pending', async function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const sealed = Buffer.concat([cipher.update('v1 paper'), cipher.final(), cipher.getAuthTag()]);
    deliver(bridge, {
      id: 'doc-v1',
      name: 'v1.txt',
      sha256: 'doc-v1',
      contentBase64: sealed.toString('base64'),
      htlcFileV1: { v: 1, iv: iv.toString('base64'), paymentHashHex: crypto.createHash('sha256').update(key).digest('hex') }
    });
    const r = await bridge.unlockHtlcEncryptedDocument('doc-v1', key.toString('hex'));
    assert.strictEqual(r.ok, true, r.error);
    const stored = bridge.globalState.documents['doc-v1'];
    assert.strictEqual(stored.htlcPendingDecrypt, undefined);
    assert.strictEqual(stored.htlcCiphertextBase64, undefined);
    assert.ok(stored.contentBase64 || stored.contentEncrypted);
  });

  it('stores an unsealed whole file as plain content', function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    deliver(bridge, { id: 'plain', name: 'p.txt', contentBase64: Buffer.from('hello').toString('base64') });
    const stored = bridge.globalState.documents.plain;
    assert.strictEqual(stored.htlcPendingDecrypt, undefined);
    assert.ok(stored.contentBase64 || stored.contentEncrypted);
  });
});
