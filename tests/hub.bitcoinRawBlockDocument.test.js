'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Hub = require('../services/hub');

/** A Hub with just what `_ensureBitcoinRawBlockDocument` touches. */
function hubWith (bitcoinSettings = {}) {
  const hub = Object.create(Hub.prototype);
  const files = new Map();
  hub.settings = { bitcoin: Object.assign({ documentRawBlocks: true }, bitcoinSettings) };
  hub._state = { documents: {}, content: { collections: { documents: {} }, counts: {} } };
  hub.fs = {
    readFile: (p) => (files.has(p) ? JSON.stringify(files.get(p)) : null),
    publish: async (p, v) => { files.set(p, v); }
  };
  hub.bitcoin = { _makeRPCRequest: async (method) => (method === 'getblockheader' ? { height: 812 } : null) };
  hub.messages = [];
  hub._appendFabricMessage = async (type, body) => { hub.messages.push({ type, body }); };
  hub._refreshChainState = () => {};
  hub.commit = () => {};
  hub.recordActivity = () => {};
  hub._pushNetworkStatus = () => {};
  return { hub, files };
}

describe('Hub raw block documents (documentRawBlocks)', function () {
  const raw = crypto.randomBytes(120 * 1024); // larger than one AMP frame
  const hash = 'ab'.repeat(32);
  const id = crypto.createHash('sha256').update(raw).digest('hex');

  it('stores a raw block as a published, priced document with its height', async function () {
    const { hub, files } = hubWith({ documentInventoryRawBlockPriceSats: 5000 });
    assert.strictEqual(await hub._ensureBitcoinRawBlockDocument({ raw: raw.toString('hex'), hash }), true);
    const row = hub._state.content.collections.documents[id];
    assert.ok(row && row.published);
    assert.strictEqual(row.mime, 'application/x-bitcoin-block');
    assert.strictEqual(row.size, raw.length);
    assert.strictEqual(row.bitcoinBlockHash, hash);
    assert.strictEqual(row.bitcoinHeight, 812);
    assert.strictEqual(row.purchasePriceSats, 5000);
    const stored = files.get(`documents/${id}.json`);
    assert.ok(Buffer.from(stored.contentBase64, 'base64').equals(raw));
    assert.deepStrictEqual(hub.messages.map((m) => m.type), ['PublishDocument']);
  });

  it('a second delivery of the same block is a no-op', async function () {
    const { hub } = hubWith();
    await hub._ensureBitcoinRawBlockDocument({ raw: raw.toString('hex'), hash });
    assert.strictEqual(await hub._ensureBitcoinRawBlockDocument({ raw: raw.toString('hex'), hash }), false);
    assert.strictEqual(hub.messages.length, 1);
  });

  it('stops at documentRawBlocksMaxBytes', async function () {
    const { hub } = hubWith({ documentRawBlocksMaxBytes: raw.length + 10 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.strictEqual(await hub._ensureBitcoinRawBlockDocument({ raw: raw.toString('hex'), hash }), true);
      const other = crypto.randomBytes(1024).toString('hex');
      assert.strictEqual(await hub._ensureBitcoinRawBlockDocument({ raw: other, hash: 'cd'.repeat(32) }), false);
    } finally {
      console.warn = warn;
    }
  });

  it('is pruned with the other Bitcoin documents below pruneheight', async function () {
    const { hub } = hubWith();
    await hub._ensureBitcoinRawBlockDocument({ raw: raw.toString('hex'), hash });
    let unpublished = null;
    hub._unpublishDocument = (docId) => { unpublished = docId; return { ok: true }; };
    hub.fs.delete = () => {};
    hub._ensureResourceCollections = () => {};
    const log = console.log;
    console.log = () => {};
    try {
      await hub._dropLocalPublishedBitcoinIndexBelowPruneHeight(900);
    } finally {
      console.log = log;
    }
    assert.strictEqual(unpublished, id);
  });
});
