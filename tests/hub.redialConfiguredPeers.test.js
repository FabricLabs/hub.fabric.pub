'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub _redialConfiguredPeers', function () {
  function fakeHub (peers, connections = {}, dialing = [], redialPeers) {
    const dialed = [];
    const hub = Object.create(Hub.prototype);
    return Object.assign(hub, {
      dialed,
      settings: { peers, redialPeers },
      agent: { connections, _outboundDialTargets: new Set(dialing), _connect () {} },
      _connectPeer (address) { dialed.push(address); return address; }
    });
  }

  it('dials configured peers that are neither connected nor being dialed', function () {
    const hub = fakeHub(
      ['hub.fabric.pub:7777', '02abc@Relay.goon.vc:7777', '127.0.0.1:7778', 'sensemaker.io'],
      { 'relay.goon.vc:7777': {} },
      ['127.0.0.1:7778']
    );
    const result = Hub.prototype._redialConfiguredPeers.call(hub);
    assert.deepStrictEqual(result, ['hub.fabric.pub:7777', 'sensemaker.io:7777']);
    assert.deepStrictEqual(hub.dialed, result);
  });

  it('redials redialPeers too, which are kept out of the boot dial list', function () {
    const hub = fakeHub(['127.0.0.1:7778'], { '127.0.0.1:7778': {} }, [], ['02abc@hub.fabric.pub:7777', 'hub.goon.vc']);
    assert.deepStrictEqual(hub.settings.peers, ['127.0.0.1:7778']);
    assert.deepStrictEqual(Hub.prototype._redialConfiguredPeers.call(hub), ['hub.fabric.pub:7777', 'hub.goon.vc:7777']);
  });

  it('skips a hostname whose resolved address already has a session', async function () {
    const hub = fakeHub([], { '203.0.113.7:7777': {} }, [], ['hub.fabric.pub:7777', 'localhost:7790']);
    hub._peerHostAddresses = new Map([['hub.fabric.pub', { at: Date.now(), ips: ['203.0.113.7'] }]]);
    await hub._refreshPeerHostAddresses();
    // The fresh cache entry is kept; localhost was looked up.
    assert.deepStrictEqual(hub._peerHostAddresses.get('hub.fabric.pub').ips, ['203.0.113.7']);
    assert.ok(hub._peerHostAddresses.get('localhost').ips.length > 0);
    assert.deepStrictEqual(Hub.prototype._redialConfiguredPeers.call(hub), ['localhost:7790']);

    const ip = hub._peerHostAddresses.get('localhost').ips[0];
    hub.agent.connections = { [ip.includes(':') ? `[${ip}]:7790` : `${ip}:7790`]: {} };
    assert.deepStrictEqual(Hub.prototype._redialConfiguredPeers.call(hub), ['hub.fabric.pub:7777']);
  });

  it('does not dial redialPeers at boot and starts redialing after a jittered delay', function () {
    const src = require('fs').readFileSync(require.resolve('../services/hub'), 'utf8');
    const block = src.slice(src.indexOf('const peerRedialMs ='), src.indexOf('const peerRedialMs =') + 900);
    assert.match(block, /setTimeout\(/, 'first redial tick is a timeout');
    assert.match(block, /Math\.random\(\) \* peerRedialMs/, 'first tick is jittered within the interval');
    assert.match(block, /_refreshPeerHostAddresses\(\)/, 'hostnames are resolved before each redial');
  });

  it('does nothing without an agent that can dial', function () {
    const hub = fakeHub(['hub.fabric.pub:7777']);
    hub.agent = null;
    assert.deepStrictEqual(Hub.prototype._redialConfiguredPeers.call(hub), []);
  });
});
