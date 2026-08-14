'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const { xOnlyFromKey } = require('@fabric/core/functions/fabricOnion');
const {
  isOnionChatSeal,
  tryOpenOnionChatText
} = require('../functions/onionChatSeal');
const Hub = require('../services/hub');

describe('Hub SendOnion JSON-RPC method table', function () {
  this.timeout(120000);

  async function createStartedHubHarness () {
    const hub = new Hub({
      debug: false,
      persistent: false,
      fs: { path: './stores/hub-test-sendonion' },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });

    const methods = {};
    const onionCalls = [];
    const fsStore = new Map();

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.recordActivity = () => {};
    hub.contract = { id: 'test-contract', state: {}, deploy: () => {} };
    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => (fsStore.has(name) ? fsStore.get(name) : null),
      publish: async (name, value) => {
        fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      },
      addToChain: async () => true
    };

    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: (name, handler) => { methods[name] = handler; },
      _addRoute: () => {},
      _addAllRoutes: () => {},
      _handleCall: async () => ({}),
      broadcast: () => {},
      start: async () => {},
      stop: async () => {},
      agent: { listenAddress: '127.0.0.1:7777', listening: true },
      listenAddress: '127.0.0.1:8080',
      webrtcPeers: new Map()
    };

    hub.agent = {
      on: () => {},
      removeListener: () => {},
      start: async () => {},
      stop: async () => {},
      emit: () => {},
      identity: { id: 'agent-test-id' },
      key: hub._rootKey,
      listenAddress: '127.0.0.1:7777',
      connections: {},
      _state: { peers: {} },
      knownPeers: [],
      _addressToId: {},
      sendOnion (path, payload) {
        onionCalls.push({ path, payload });
        return true;
      },
      relayFrom: () => {}
    };

    await hub.start();
    return { hub, methods, onionCalls };
  }

  let harness;

  before(async function () {
    harness = await createStartedHubHarness();
  });

  after(async function () {
    this.timeout(8000);
    if (harness && harness.hub) {
      await Promise.race([
        harness.hub.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 7000))
      ]).catch(() => {});
    }
  });

  beforeEach(function () {
    harness.onionCalls.length = 0;
  });

  it('registers SendOnion and returns sealed:true for text via method table', function () {
    const { methods, onionCalls, hub } = harness;
    assert.ok(methods.SendOnion, 'SendOnion should be registered');
    const hop = new Key();
    const res = methods.SendOnion({
      path: [xOnlyFromKey(hop).toString('hex')],
      text: 'rpc-sealed'
    });
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.sealed, true);
    assert.strictEqual(onionCalls.length, 1);
    const wire = onionCalls[0].payload.data.toString('utf8');
    assert.ok(isOnionChatSeal(wire));
    assert.ok(!wire.includes('rpc-sealed'));
    const opened = tryOpenOnionChatText(wire, { keyOrPrivate: hop });
    assert.strictEqual(opened.opened, true);
    assert.strictEqual(opened.text, 'rpc-sealed');
    assert.ok(hub.agent.key);
  });

  it('SendPeerMessage mesh path does not tip-seal chat text', function () {
    const { methods, hub } = harness;
    assert.ok(methods.SendPeerMessage);
    const peerAddr = '127.0.0.1:17999';
    const sent = [];
    hub.agent.connections[peerAddr] = {
      _writeFabric (buf) { sent.push(buf); }
    };
    hub._resolvePeerAddress = () => peerAddr;
    hub._sendVectorToPeer = (address, vector) => {
      sent.push({ address, vector });
    };

    const res = methods.SendPeerMessage(peerAddr, { text: 'mesh-plain' });
    assert.strictEqual(res.status, 'success');
    const chat = sent.find((s) => s && s.vector && s.vector[0] === 'P2P_CHAT_MESSAGE');
    assert.ok(chat);
    assert.strictEqual(chat.vector[1], 'mesh-plain');
    assert.strictEqual(isOnionChatSeal(chat.vector[1]), false);
  });
});
