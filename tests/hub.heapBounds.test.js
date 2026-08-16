'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Hub = require('../services/hub');
const hubHeapBounds = require('../functions/hubHeapBounds');

function stubHeapHub () {
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
  hub.fs = {
    publish: async () => {},
    addToChain: async () => {},
    writeFile () { return true; },
    path: os.tmpdir()
  };
  hub.chain = null;
  hub._rootKey = null;
  hub.http = { broadcast () {}, settings: { resources: {} } };
  hub.agent = { identity: { id: 'test-agent' } };
  hub._bitcoinBlockTips = new Set();
  hub._bitcoinStatusCache = { value: null, updatedAt: 0 };
  hub._buildMessageTreeFromLog = function () { return '00'; };
  return hub;
}

describe('Hub heap bounds', function () {
  it('capMapKeepHighestSeq keeps the newest seqs', function () {
    const map = {};
    for (let i = 1; i <= 10; i++) map['id-' + i] = { id: 'id-' + i, seq: i };
    hubHeapBounds.capMapKeepHighestSeq(map, 3);
    assert.strictEqual(Object.keys(map).length, 3);
    assert.ok(map['id-8'] && map['id-9'] && map['id-10']);
    assert.strictEqual(map['id-1'], undefined);
  });

  it('capMapKeepNewest keeps the latest activity timestamps', function () {
    const map = {
      a: { object: { created: '2026-01-01T00:00:00.000Z' } },
      b: { object: { created: '2026-08-16T00:00:00.000Z' } },
      c: { object: { created: '2026-03-01T00:00:00.000Z' } }
    };
    hubHeapBounds.capMapKeepNewest(map, 1, hubHeapBounds.activityTime);
    assert.deepStrictEqual(Object.keys(map), ['b']);
  });

  it('recordActivity caps the in-memory activity map', function () {
    const hub = stubHeapHub();
    for (let i = 0; i < hubHeapBounds.MAX_ACTIVITY_MESSAGES + 40; i++) {
      hub.recordActivity({
        type: 'Create',
        object: { n: i, created: new Date(i * 1000).toISOString() }
      });
    }
    assert.strictEqual(Object.keys(hub._state.messages).length, hubHeapBounds.MAX_ACTIVITY_MESSAGES);
  });

  it('commit writes STATE via writeFile and does not publish', function () {
    const hub = stubHeapHub();
    const calls = { publish: 0, writeFile: 0, name: null };
    hub.fs.publish = function () { calls.publish++; };
    hub.fs.writeFile = function (name, body) {
      calls.writeFile++;
      calls.name = name;
      calls.body = body;
      return true;
    };
    hub.commit();
    assert.strictEqual(calls.publish, 0);
    assert.strictEqual(calls.writeFile, 1);
    assert.strictEqual(calls.name, 'STATE');
    assert.ok(typeof calls.body === 'string');
    const parsed = JSON.parse(calls.body);
    assert.ok(parsed.collections);
  });

  it('_appendFabricMessage caps the in-memory fabric log', async function () {
    this.timeout(15000);
    const hub = stubHeapHub();
    const extra = 40;
    const total = hubHeapBounds.MAX_FABRIC_MESSAGE_LOG + extra;
    for (let i = 0; i < total; i++) {
      await hub._appendFabricMessage('Ping', { i });
    }
    const map = hub._state.content.collections.messages;
    assert.ok(Object.keys(map).length <= hubHeapBounds.MAX_FABRIC_MESSAGE_LOG);
    const seqs = Object.values(map).map((e) => Number(e.seq));
    assert.ok(Math.min(...seqs) > extra);
  });

  it('_ingestP2pBitcoinBlockForFabricLog uses the tip set', async function () {
    const hub = stubHeapHub();
    const tip = 'ab'.repeat(32);
    hub._rememberBitcoinBlockTip(tip);
    let appends = 0;
    hub._appendFabricMessage = async function () { appends++; };
    await hub._ingestP2pBitcoinBlockForFabricLog({ tip, height: 1 }, 'peer');
    assert.strictEqual(appends, 0);
  });
});
