'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const Hub = require('../services/hub');

function getFreePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

describe('Hub BitcoinBlock Fabric relay', function () {
  this.timeout(60000);

  it('_broadcastBitcoinBlockToFabricPeers relays a signed BitcoinBlock with tip and height', async function () {
    const testFsPath = path.join(__dirname, '..', 'stores', `hub-test-bktip-${process.pid}-${Date.now()}`);
    fs.mkdirSync(testFsPath, { recursive: true });
    const p2pPort = await getFreePort();
    const relayCalls = [];
    const hub = new Hub({
      port: p2pPort,
      debug: false,
      persistent: false,
      fs: { path: testFsPath },
      http: { hostname: 'localhost', interface: '127.0.0.1', port: 0 },
      bitcoin: { enable: false },
      payjoin: { enable: false }
    });

    hub.alert = async () => {};
    hub.commit = () => {};
    hub.trust = () => {};
    hub._addAllRoutes = () => {};
    hub.contract = { id: 'test-contract', state: {}, deploy: () => {} };

    hub.fs = {
      start: async () => {},
      stop: async () => {},
      readFile: () => null,
      publish: async () => {},
      addToChain: async () => true
    };

    hub.http = {
      on: () => {},
      removeListener: () => {},
      _registerMethod: () => {},
      _addRoute: () => {},
      _addAllRoutes: () => {},
      broadcast: () => {},
      start: async () => {},
      agent: {}
    };

    await hub.start();
    hub._pushNetworkStatus = () => {};

    const key = hub._rootKey;
    assert.ok(key && key.private, 'hub root key has private material for signing');

    hub.agent.relayFrom = (origin, msg) => {
      relayCalls.push({ origin, msg });
    };
    hub.agent.key = key;

    const tip = `${'ab'.repeat(31)}cd`;
    hub._broadcastBitcoinBlockToFabricPeers({
      tip,
      height: 2743,
      network: 'regtest',
      at: new Date().toISOString()
    });

    assert.strictEqual(relayCalls.length, 1, 'relayFrom called once');
    assert.strictEqual(relayCalls[0].origin, '_hub');
    const m = relayCalls[0].msg;
    assert.ok(m, 'relayed a message');
    const raw = m.data != null ? m.data : m.body;
    assert.ok(raw != null, 'message has stringifiable body');
    const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    assert.strictEqual(parsed.height, 2743);
    assert.strictEqual(parsed.tip, tip);
    assert.strictEqual(parsed.network, 'regtest');

    await Promise.race([
      hub.stop(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop timeout')), 8000))
    ]).catch(() => {});

    try {
      fs.rmSync(testFsPath, { recursive: true, force: true });
    } catch (_) {}
  });
});
