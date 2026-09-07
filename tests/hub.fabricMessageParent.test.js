'use strict';

const assert = require('assert');
const os = require('os');

const Hub = require('../services/hub');
const Key = require('@fabric/core/types/key');

let parentLib = null;
try {
  parentLib = require('@fabric/core/functions/fabricMessageParent');
} catch (err) {
  if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
}

function stubAppendHub () {
  const hub = Object.create(Hub.prototype);
  hub._state = {
    content: {
      collections: { messages: {}, chain: {}, documents: {}, contracts: {} },
      counts: { messages: 0 },
      chain: { tree: { leaves: 0, root: null }, messages: [] }
    },
    messages: {},
    documents: {}
  };
  hub._outboundMessageTip = null;
  hub._rootKey = new Key();
  hub.chain = null;
  hub.http = { broadcast () {}, settings: { resources: {} } };
  hub.agent = { identity: { id: 'test-agent' } };
  hub._bitcoinBlockTips = new Set();
  hub._buildMessageTreeFromLog = function () { return '00'; };
  hub._capHeapCollections = function () {};
  hub.fs = {
    path: os.tmpdir(),
    publish: async () => {},
    addToChain: async () => {},
    writeFile () { return true; }
  };
  return hub;
}

describe('Hub _appendFabricMessage AMP parent', function () {
  it('still appends durable frames when the core parent helper is absent', async function () {
    const hub = stubAppendHub();
    const entry = await hub._appendFabricMessage('PublishDocument', { n: 1 });
    assert.ok(entry && entry.id);
    assert.strictEqual(entry.type, 'PublishDocument');
    assert.strictEqual(entry.seq, 1);
  });

  it('keeps genesis zeros on Ping without moving the tip', async function () {
    if (!parentLib) this.skip();
    const hub = stubAppendHub();
    const chained = [];
    hub.fs.addToChain = async (msg) => { chained.push(msg); };

    const genesis = await hub._appendFabricMessage('GENESIS_MESSAGE', { n: 0 });
    const ping = await hub._appendFabricMessage('Ping', { n: 1 });

    assert.strictEqual(parentLib.parentHexOf(chained[0]), parentLib.ZERO_PARENT);
    assert.strictEqual(parentLib.parentHexOf(chained[1]), parentLib.ZERO_PARENT);
    assert.strictEqual(genesis.parent, parentLib.ZERO_PARENT);
    assert.strictEqual(ping.parent, parentLib.ZERO_PARENT);
    assert.strictEqual(hub._outboundMessageTip, chained[0].id);
  });

  it('chains parent to the previous signed frame id for durable types', async function () {
    if (!parentLib) this.skip();
    const hub = stubAppendHub();
    const chained = [];
    hub.fs.addToChain = async (msg) => { chained.push(msg); };

    const genesis = await hub._appendFabricMessage('GENESIS_MESSAGE', { n: 0 });
    const first = await hub._appendFabricMessage('PublishDocument', { n: 1 });
    const second = await hub._appendFabricMessage('Tombstone', { n: 2 });

    assert.strictEqual(parentLib.parentHexOf(chained[0]), parentLib.ZERO_PARENT);
    assert.strictEqual(parentLib.parentHexOf(chained[1]), chained[0].id);
    assert.strictEqual(parentLib.parentHexOf(chained[2]), chained[1].id);
    assert.strictEqual(genesis.frameId, chained[0].id);
    assert.strictEqual(first.parent, chained[0].id);
    assert.strictEqual(first.frameId, chained[1].id);
    assert.strictEqual(second.parent, chained[1].id);
    assert.strictEqual(second.frameId, chained[2].id);
    assert.strictEqual(hub._outboundMessageTip, chained[2].id);
  });
});
