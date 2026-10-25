'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub _redialConfiguredPeers', function () {
  function fakeHub (peers, connections = {}, dialing = []) {
    const dialed = [];
    return {
      dialed,
      settings: { peers },
      agent: { connections, _outboundDialTargets: new Set(dialing), _connect () {} },
      _connectPeer (address) { dialed.push(address); return address; }
    };
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

  it('does nothing without an agent that can dial', function () {
    const hub = fakeHub(['hub.fabric.pub:7777']);
    hub.agent = null;
    assert.deepStrictEqual(Hub.prototype._redialConfiguredPeers.call(hub), []);
  });
});
