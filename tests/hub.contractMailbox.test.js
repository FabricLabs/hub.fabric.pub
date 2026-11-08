'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const Hub = require('../services/hub');
const { HUB_START_PHASES } = require('../functions/hubLifecycle');

const contractId = 'a'.repeat(64);

function signedFrameHex (key, body) {
  const json = JSON.stringify({ contract: contractId, type: 'GroupChat', object: { body } });
  return Message.fromVector(['CONTRACT_MESSAGE', json]).signWithKey(key).toBuffer().toString('hex');
}

function socket () {
  const writes = [];
  return {
    writes,
    _writeFabric (buf) {
      writes.push(Buffer.from(buf).toString('hex'));
    }
  };
}

describe('Hub contract message mailboxes', function () {
  this.timeout(60000);

  async function makeHub () {
    const fsStore = new Map();
    const hub = new Hub({
      debug: false,
      persistent: false,
      skipStartPhases: HUB_START_PHASES.slice(),
      fs: { path: './stores/hub-test-mailbox-' + crypto.randomBytes(8).toString('hex') },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0, listen: false },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });
    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub.recordActivity = () => {};
    hub._appendFabricMessage = async () => {};
    hub._refreshChainState = () => ({});
    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: (name) => (fsStore.has(name) ? fsStore.get(name) : null),
      publish: async (name, value) => {
        fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      }
    };
    const agent = new EventEmitter();
    Object.assign(agent, {
      identity: { id: 'hub-self-id' },
      connections: {},
      knownPeers: {},
      peers: {},
      _addressToId: {},
      _outboundDialTargets: new Set()
    });
    hub.agent = agent;
    await hub.start();
    hub._pushNetworkStatus = () => {};
    return hub;
  }

  function connect (hub, address, fabricId) {
    const sock = socket();
    hub.agent.connections[address] = sock;
    if (fabricId) hub.agent._addressToId[address] = fabricId;
    return sock;
  }

  function enqueue (hub, hex, origin) {
    return hub._enqueueOpaqueContractMessage({ contract: contractId, messageHex: hex, origin });
  }

  it('sends each frame once to an identity, whichever connection it uses', async function () {
    const hub = await makeHub();
    const author = new Key();
    const frames = [signedFrameHex(author, 'one'), signedFrameHex(author, 'two')];
    for (const hex of frames) assert.strictEqual(enqueue(hub, hex).accepted, true);

    hub.agent._outboundDialTargets.add('127.0.0.1:7777');
    const dialed = connect(hub, '127.0.0.1:7777', 'id-alice');
    const inbound = connect(hub, '10.0.0.5:51000', 'id-alice');
    assert.deepStrictEqual(hub._connectionsForFabricId('id-alice'), ['127.0.0.1:7777', '10.0.0.5:51000']);

    const first = hub._drainMailboxForConnection('10.0.0.5:51000');
    assert.strictEqual(first.delivered, 2);
    assert.strictEqual(first.peerId, 'id-alice');
    assert.deepStrictEqual(inbound.writes, frames);
    assert.strictEqual(hub._drainMailboxForConnection('127.0.0.1:7777').delivered, 0);
    assert.deepStrictEqual(dialed.writes, []);

    delete hub.agent.connections['10.0.0.5:51000'];
    hub._forgetMailboxConnection('10.0.0.5:51000');
    const reconnect = connect(hub, '10.0.0.5:51001', 'id-alice');
    assert.strictEqual(hub._drainMailboxForConnection('10.0.0.5:51001').delivered, 0);
    assert.deepStrictEqual(reconnect.writes, []);

    const byId = hub._drainContractMessageQueueToPeer('id-bob');
    assert.deepStrictEqual(byId, { delivered: 0, contracts: 0 }, 'no connection for that id');
    const bob = connect(hub, '10.0.0.6:52000', 'id-bob');
    assert.strictEqual(hub._drainContractMessageQueueToPeer('id-bob').delivered, 2);
    assert.deepStrictEqual(bob.writes, frames);
    await hub.stop().catch(() => {});
  });

  it('drains nothing to a connection whose session has not named the peer', async function () {
    const hub = await makeHub();
    assert.strictEqual(enqueue(hub, signedFrameHex(new Key(), 'wait')).accepted, true);
    const anon = connect(hub, '10.0.0.7:53000', null);
    const result = hub._drainContractMessageQueueToPeer('10.0.0.7:53000');
    assert.strictEqual(result.unidentified, true);
    assert.strictEqual(result.delivered, 0);
    assert.strictEqual(hub._drainMailboxForConnection('10.0.0.7:53000'), null);
    assert.deepStrictEqual(anon.writes, []);
    await hub.stop().catch(() => {});
  });

  it('does not send a frame back to the peer it came from', async function () {
    const hub = await makeHub();
    const sender = connect(hub, '10.0.0.8:54000', 'id-carol');
    const hex = signedFrameHex(new Key(), 'from carol');
    assert.strictEqual(enqueue(hub, hex, { name: '10.0.0.8:54000' }).accepted, true);
    assert.strictEqual(hub._drainMailboxForConnection('10.0.0.8:54000').delivered, 0);
    assert.deepStrictEqual(sender.writes, []);
    const other = connect(hub, '10.0.0.9:55000', 'id-dave');
    assert.strictEqual(hub._drainMailboxForConnection('10.0.0.9:55000').delivered, 1);
    assert.deepStrictEqual(other.writes, [hex]);
    await hub.stop().catch(() => {});
  });

  it('drains on peer:session', async function () {
    const hub = await makeHub();
    hub._bindContractMailboxEvents();
    const hex = signedFrameHex(new Key(), 'session');
    assert.strictEqual(enqueue(hub, hex).accepted, true);
    const sock = connect(hub, '10.0.0.10:56000', 'id-erin');
    hub.agent.emit('peer:session', { address: '10.0.0.10:56000', id: 'id-erin', publicKey: '02ab', direction: 'inbound' });
    assert.deepStrictEqual(sock.writes, [hex]);
    hub.agent.emit('peer:session', { address: '10.0.0.10:56000', id: 'id-erin', publicKey: '02ab', direction: 'inbound' });
    assert.deepStrictEqual(sock.writes, [hex], 'one drain per connection');
    await hub.stop().catch(() => {});
    assert.strictEqual(hub.agent.listenerCount('peer:session'), 0, 'stop removes the listeners');
  });

  it('drains once the identity appears when core has no peer:session', async function () {
    const hub = await makeHub();
    const hex = signedFrameHex(new Key(), 'fallback');
    assert.strictEqual(enqueue(hub, hex).accepted, true);
    const sock = connect(hub, '10.0.0.11:57000', null);
    hub._watchConnectionIdentity('10.0.0.11:57000');
    assert.deepStrictEqual(sock.writes, []);
    hub.agent._addressToId['10.0.0.11:57000'] = 'id-frank';
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepStrictEqual(sock.writes, [hex]);
    assert.ok(!hub._connectionIdentityWatches.has('10.0.0.11:57000'), 'watch stops after the drain');
    await hub.stop().catch(() => {});
  });
});
