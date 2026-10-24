'use strict';

const assert = require('assert');
const {
  allowedHostsFromSettings,
  buildContentSecurityPolicy,
  createLoopbackHostGuard,
  hostnameFromHostHeader,
  isRebindSafeHost,
  isTrustedLoopbackRequest
} = require('../functions/hubHttpLocalTrust');

function fakeReq (remoteAddress, headers = {}) {
  return { socket: { remoteAddress }, headers };
}

function fakeRes () {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status (code) { this.statusCode = code; return this; },
    setHeader (k, v) { this.headers[k.toLowerCase()] = v; },
    send (b) { this.body = b; }
  };
}

describe('functions/hubHttpLocalTrust', () => {
  it('hostnameFromHostHeader strips ports and IPv6 brackets', () => {
    assert.strictEqual(hostnameFromHostHeader('127.0.0.1:8080'), '127.0.0.1');
    assert.strictEqual(hostnameFromHostHeader('LocalHost:8080'), 'localhost');
    assert.strictEqual(hostnameFromHostHeader('[::1]:8080'), '::1');
    assert.strictEqual(hostnameFromHostHeader('::1'), '::1');
    assert.strictEqual(hostnameFromHostHeader('hub.fabric.pub'), 'hub.fabric.pub');
    assert.strictEqual(hostnameFromHostHeader(''), '');
  });

  it('isRebindSafeHost accepts IP literals, localhost, and configured names only', () => {
    assert.strictEqual(isRebindSafeHost('127.0.0.1:8080'), true);
    assert.strictEqual(isRebindSafeHost('192.168.1.5:8080'), true);
    assert.strictEqual(isRebindSafeHost('[::1]:8080'), true);
    assert.strictEqual(isRebindSafeHost('localhost:8080'), true);
    assert.strictEqual(isRebindSafeHost('hub.localhost:8080'), true);
    assert.strictEqual(isRebindSafeHost(''), true);
    assert.strictEqual(isRebindSafeHost('evil.example:8080'), false);
    assert.strictEqual(isRebindSafeHost('localhost.evil.example'), false);
    assert.strictEqual(isRebindSafeHost('hub.fabric.pub', ['hub.fabric.pub']), true);
  });

  it('isTrustedLoopbackRequest needs loopback socket, no proxy headers, and a safe Host', () => {
    assert.strictEqual(isTrustedLoopbackRequest(fakeReq('127.0.0.1', { host: '127.0.0.1:8080' })), true);
    assert.strictEqual(isTrustedLoopbackRequest(fakeReq('::ffff:127.0.0.1', { host: 'localhost:8080' })), true);
    assert.strictEqual(isTrustedLoopbackRequest(fakeReq('192.168.1.9', { host: '127.0.0.1:8080' })), false);
    assert.strictEqual(isTrustedLoopbackRequest(fakeReq('127.0.0.1', { host: 'evil.example:8080' })), false, 'DNS rebinding');
    assert.strictEqual(
      isTrustedLoopbackRequest(fakeReq('127.0.0.1', { host: 'hub.fabric.pub', 'x-forwarded-for': '203.0.113.9' }), { allowedHosts: ['hub.fabric.pub'] }),
      false,
      'reverse proxy traffic is never local'
    );
  });

  it('createLoopbackHostGuard refuses rebound hosts with 421 and passes everything else', () => {
    const guard = createLoopbackHostGuard({ allowedHosts: ['hub.example'] });
    const run = (req) => {
      const res = fakeRes();
      let passed = false;
      guard(req, res, () => { passed = true; });
      return { passed, res };
    };
    assert.strictEqual(run(fakeReq('127.0.0.1', { host: '127.0.0.1:8080' })).passed, true);
    assert.strictEqual(run(fakeReq('127.0.0.1', { host: 'hub.example:8080' })).passed, true);
    assert.strictEqual(run(fakeReq('10.0.0.2', { host: 'anything.example' })).passed, true);
    assert.strictEqual(run(fakeReq('127.0.0.1', { host: 'public.example', 'x-forwarded-for': '1.2.3.4' })).passed, true);
    const blocked = run(fakeReq('127.0.0.1', { host: 'evil.example:8080' }));
    assert.strictEqual(blocked.passed, false);
    assert.strictEqual(blocked.res.statusCode, 421);
  });

  it('allowedHostsFromSettings merges settings and env', () => {
    const hosts = allowedHostsFromSettings(
      { http: { hostname: 'hub.fabric.pub' } },
      { FABRIC_HUB_HOSTNAME: '127.0.0.1', FABRIC_HUB_ALLOWED_HOSTS: 'a.example, b.example' }
    );
    assert.deepStrictEqual(hosts, ['hub.fabric.pub', '127.0.0.1', 'a.example', 'b.example']);
  });

  it('buildContentSecurityPolicy keeps scripts same-origin unless dev inline is requested', () => {
    const csp = buildContentSecurityPolicy();
    assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval'"));
    assert.ok(!csp.includes("script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.ok(buildContentSecurityPolicy({ allowInlineScripts: true }).includes("script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'"));
  });
});
