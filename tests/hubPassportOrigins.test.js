'use strict';

const assert = require('assert');
const { hubPinnedOrigins } = require('../functions/hubPassport');

describe('hubPinnedOrigins', function () {
  const hub = { settings: { http: { port: 8080 } } };

  it('pins loopback on the Hub port and nothing else by default', function () {
    assert.deepStrictEqual(hubPinnedOrigins(hub, {}).sort(), [
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'http://localhost:8080'
    ]);
  });

  it('adds the public origin, a second public name, and LAN hosts', function () {
    const pinned = hubPinnedOrigins(hub, {
      FABRIC_HUB_PUBLIC_ORIGIN: 'https://hub.fabric.pub/',
      FABRIC_HUB_PASSPORT_ORIGINS: ' https://hub.goon.vc , not a url,',
      FABRIC_HUB_ALLOWED_HOSTS: 'hub.lan'
    });
    assert.ok(pinned.includes('https://hub.fabric.pub'));
    assert.ok(pinned.includes('https://hub.goon.vc'));
    assert.ok(pinned.includes('http://hub.lan:8080'));
    assert.strictEqual(pinned.length, 6, 'malformed entries are skipped');
  });
});
