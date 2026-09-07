'use strict';

const assert = require('assert');
const {
  parseFabricHubSeedEntry,
  collectFabricHubSeeds,
  isMixedContentSeed,
  pickPrimarySignalingSeed,
  recommendedMaxWebrtcPeers
} = require('../functions/fabricHubSeeds');

describe('fabricHubSeeds', function () {
  it('parses HTTP origins and infers Fabric :7777', function () {
    const s = parseFabricHubSeedEntry('https://hub.fabric.pub');
    assert.ok(s);
    assert.strictEqual(s.http, 'https://hub.fabric.pub');
    assert.strictEqual(s.fabric, 'hub.fabric.pub:7777');
  });

  it('parses Fabric listen strings', function () {
    const s = parseFabricHubSeedEntry('relay.goon.vc:7777');
    assert.ok(s);
    assert.strictEqual(s.fabric, 'relay.goon.vc:7777');
    assert.strictEqual(s.http, 'https://relay.goon.vc');
  });

  it('collects window seeds, env, and FABRIC_EDGE_AUTHORITY without duplicates', function () {
    const seeds = collectFabricHubSeeds({
      window: {
        FABRIC_HUB_SEEDS: ['https://hub.fabric.pub', 'https://hub.fabric.pub/'],
        FABRIC_EDGE_AUTHORITY: 'http://localhost:8080'
      },
      envSeeds: 'https://relay.goon.vc'
    });
    assert.strictEqual(seeds.length, 3);
    assert.strictEqual(seeds[0].http, 'https://hub.fabric.pub');
    assert.strictEqual(seeds[1].http, 'https://relay.goon.vc');
    assert.strictEqual(seeds[2].http, 'http://localhost:8080');
  });

  it('rejects http seeds on an https page', function () {
    assert.strictEqual(isMixedContentSeed('http://localhost:8080', 'https:'), true);
    assert.strictEqual(isMixedContentSeed('https://hub.fabric.pub', 'https:'), false);
    assert.strictEqual(isMixedContentSeed('http://localhost:8080', 'http:'), false);
  });

  it('picks the first hub-like seed the browser can reach', function () {
    const probes = [
      { seed: { http: 'http://localhost:8080' }, hubLike: true, features: { webrtc: true } },
      { seed: { http: 'https://hub.fabric.pub' }, hubLike: true, features: { webrtc: true } }
    ];
    const picked = pickPrimarySignalingSeed(probes, { pageProtocol: 'https:' });
    assert.ok(picked);
    assert.strictEqual(picked.http, 'https://hub.fabric.pub');
  });

  it('raises WebRTC mesh slots with seed count', function () {
    assert.ok(recommendedMaxWebrtcPeers(2) >= 32);
  });
});
