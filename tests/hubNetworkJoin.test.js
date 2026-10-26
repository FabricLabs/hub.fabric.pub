'use strict';

const assert = require('assert');
const {
  parseHostPortList,
  applyNetworkJoinFromSetup,
  applyDesktopPlaynetDefaults,
  profileToSettings
} = require('../functions/hubNetworkJoin');

const profile = {
  type: 'FabricLocalNetworkProfile',
  version: 1,
  network: 'regtest',
  bitcoin: { network: 'regtest', addnode: ['127.0.0.1:30444'] },
  fabric: { peers: ['127.0.0.1:30277', '127.0.0.1:30278'] },
  instances: [
    { name: 'hub-goon-vc', label: 'hub.goon.vc', signer: true, http: 'http://127.0.0.1:30182', pubkey: '02aa', adminTokenFile: '/secret/path' }
  ]
};

describe('hubNetworkJoin', function () {
  it('parses lists in every accepted shape and rejects typos', function () {
    assert.deepStrictEqual(parseHostPortList('127.0.0.1:1, host.example:7777\nhost.example:7777'), ['127.0.0.1:1', 'host.example:7777']);
    assert.deepStrictEqual(parseHostPortList('["[::1]:18444"]'), ['[::1]:18444']);
    assert.deepStrictEqual(parseHostPortList(null), []);
    assert.throws(() => parseHostPortList(['127.0.0.1']), /host:port/);
    assert.throws(() => parseHostPortList(['127.0.0.1:70000']), /host:port/);
  });

  it('replaces default Fabric seeds and adds Bitcoin targets at boot', function () {
    const settings = applyNetworkJoinFromSetup({
      peers: ['hub.fabric.pub:7777'],
      bitcoin: { network: 'regtest', p2pAddNodes: ['10.0.0.1:18444'] }
    }, { BITCOIN_ADDNODES: ['127.0.0.1:30444'], FABRIC_PEERS: '127.0.0.1:30277' });
    assert.deepStrictEqual(settings.peers, ['127.0.0.1:30277']);
    assert.deepStrictEqual(settings.bitcoin.p2pAddNodes, ['10.0.0.1:18444', '127.0.0.1:30444']);
    assert.strictEqual(settings.bitcoin.skipPlaynetPeer, true);
  });

  it('leaves settings alone when nothing is saved', function () {
    const settings = applyNetworkJoinFromSetup({ peers: ['hub.fabric.pub:7777'], bitcoin: {} }, {});
    assert.deepStrictEqual(settings.peers, ['hub.fabric.pub:7777']);
    assert.strictEqual(settings.bitcoin.skipPlaynetPeer, undefined);
  });

  it('makes a desktop Hub a playnet node: Fabric seeds and regtest addnode', function () {
    const settings = applyDesktopPlaynetDefaults({
      peers: ['relay.goon.vc:7777', '127.0.0.1:7778'],
      bitcoin: { network: 'regtest', skipPlaynetPeer: true }
    }, {});
    assert.deepStrictEqual(settings.peers, ['relay.goon.vc:7777', '127.0.0.1:7778', 'hub.fabric.pub:7777']);
    assert.strictEqual(settings.bitcoin.skipPlaynetPeer, false);
  });

  it('keeps a joined private network off the playnet', function () {
    const setup = { BITCOIN_ADDNODES: ['127.0.0.1:30444'], FABRIC_PEERS: '127.0.0.1:30277' };
    const joined = applyNetworkJoinFromSetup({ peers: ['relay.goon.vc:7777'], bitcoin: { network: 'regtest' } }, setup);
    const settings = applyDesktopPlaynetDefaults(joined, setup);
    assert.deepStrictEqual(settings.peers, ['127.0.0.1:30277']);
    assert.strictEqual(settings.bitcoin.skipPlaynetPeer, true);
  });

  it('turns a profile into settings without exposing admin token paths', function () {
    const r = profileToSettings(JSON.stringify(profile), { network: 'regtest' });
    assert.strictEqual(r.network, 'regtest');
    assert.deepStrictEqual(r.settings.BITCOIN_ADDNODES, ['127.0.0.1:30444']);
    assert.deepStrictEqual(r.settings.FABRIC_PEERS, ['127.0.0.1:30277', '127.0.0.1:30278']);
    assert.ok(!JSON.stringify(r).includes('/secret/path'));
  });

  it('refuses a profile for another network or of another type', function () {
    assert.throws(() => profileToSettings(profile, { network: 'mainnet' }), /regtest/);
    assert.throws(() => profileToSettings({ type: 'Other' }), /FabricLocalNetworkProfile/);
  });
});
