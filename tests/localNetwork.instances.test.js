'use strict';

const assert = require('assert');
const net = require('../scripts/lib/localNetwork');
const deploy = require('../scripts/deploy');

describe('local network instances', function () {
  it('regtest runs the seed, both stand-ins, and the operator', function () {
    const names = net.instancesFor('regtest').map((i) => i.name);
    assert.deepStrictEqual(names, ['seed', 'hub-fabric-pub', 'hub-goon-vc', 'operator']);
  });

  it('signet has no seed but keeps the operator', function () {
    const names = net.instancesFor('signet').map((i) => i.name);
    assert.deepStrictEqual(names, ['hub-fabric-pub', 'hub-goon-vc', 'operator']);
  });

  it('drops the stand-ins when the public Hubs take part, keeping ports', function () {
    const all = net.instancesFor('regtest');
    const withRemotes = net.instancesFor('regtest', null, { remotes: true });
    assert.deepStrictEqual(withRemotes.map((i) => i.name), ['seed', 'operator']);
    const operator = (list) => list.find((i) => i.name === 'operator').ports;
    assert.deepStrictEqual(operator(withRemotes), operator(all));
  });

  it('keeps the operator clear of the slot just past the instances', function () {
    const list = net.instancesFor('regtest');
    const ports = list.find((i) => i.name === 'operator').ports;
    assert.strictEqual(ports.http, 30188);
    assert.ok(!list.some((i) => i.name !== 'operator' && i.ports.http === ports.http));
    assert.notStrictEqual(ports.http, 30000 + 180 + 3);
  });

  it('dials only the peers it was given, not whoever bitcoind remembers', function () {
    const list = net.instancesFor('regtest');
    const seed = list[0];
    const operator = list.find((i) => i.name === 'operator');
    const key = { xprv: 'xprv' };
    const seedAlone = net.buildFragment({ network: 'regtest', instance: seed, dir: '/tmp/x', key });
    assert.ok(seedAlone.bitcoin.bitcoinExtraParams.includes('-connect=0'));
    assert.ok(!seedAlone.bitcoin.bitcoinExtraParams.some((p) => String(p).startsWith('-addnode=')));
    const member = net.buildFragment({
      network: 'regtest', instance: operator, dir: '/tmp/x', key, seedPort: seed.ports.btcP2p
    });
    assert.ok(member.bitcoin.bitcoinExtraParams.includes(`-connect=127.0.0.1:${seed.ports.btcP2p}`));
    const joined = net.buildFragment({
      network: 'regtest', instance: seed, dir: '/tmp/x', key, bitcoinPeers: ['hub.fabric.pub:18444']
    });
    assert.ok(joined.bitcoin.bitcoinExtraParams.includes('-connect=hub.fabric.pub:18444'));
    assert.ok(!joined.bitcoin.bitcoinExtraParams.includes('-connect=0'));
  });

  it('lets a public chain sync from the internet when it was given no peers', function () {
    const operator = net.instancesFor('signet').find((i) => i.name === 'operator');
    const fragment = net.buildFragment({ network: 'signet', instance: operator, dir: '/tmp/x', key: { xprv: 'xprv' } });
    assert.ok(!fragment.bitcoin.bitcoinExtraParams.some((p) => String(p).startsWith('-connect=')));
  });

  it('turns the seed Beacon off when it should not mine', function () {
    const seed = net.instancesFor('regtest')[0];
    const opts = { network: 'regtest', instance: seed, dir: '/tmp/x', key: { xprv: 'xprv' } };
    assert.strictEqual(net.buildFragment(opts).beacon.enable, true);
    assert.strictEqual(net.buildFragment(Object.assign({ mine: false }, opts)).beacon.enable, false);
  });

  it('deploy --playnet starts no stand-ins', function () {
    const ctx = deploy.context({ network: 'regtest', playnet: true, root: '/tmp/fabric-localnet-test' });
    assert.deepStrictEqual(ctx.instances.map((i) => i.name), ['seed', 'operator']);
    assert.strictEqual(ctx.remotes.length, 2);
  });

  it('deploy --additive keeps the whole local network and adds the public Hubs', function () {
    assert.strictEqual(deploy.parseArgs(['--additive']).additive, true);
    const ctx = deploy.context({ network: 'regtest', additive: true, root: '/tmp/fabric-localnet-test' });
    assert.deepStrictEqual(ctx.instances.map((i) => i.name), ['seed', 'hub-fabric-pub', 'hub-goon-vc', 'operator']);
    assert.strictEqual(ctx.additive, true);
    assert.strictEqual(ctx.remotes.length, 2);
  });
});
