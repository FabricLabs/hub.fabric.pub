'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  allowedHostsFromSettings,
  buildContentSecurityPolicy,
  createBrowserSecretsGuard,
  createLoopbackHostGuard,
  hostnameFromHostHeader,
  isCrossOriginRead,
  isRebindSafeHost,
  isTrustedLoopbackRequest,
  setsBrowserIdentity
} = require('../functions/hubHttpLocalTrust');

function fakeReq (remoteAddress, headers = {}, extra = {}) {
  return { socket: { remoteAddress }, headers, method: 'GET', path: '/', ...extra };
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

  it('isCrossOriginRead flags other sites reading, not navigations or same-origin loads', () => {
    const local = { host: '127.0.0.1:8080' };
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors' })), false);
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', local)), false, 'non-browser clients');
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' })), true, '<script src>');
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' })), true, 'another localhost port');
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' })), false, 'link click');
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, origin: 'https://evil.example' })), true);
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, origin: 'null' })), true);
    assert.strictEqual(isCrossOriginRead(fakeReq('127.0.0.1', { ...local, origin: 'http://127.0.0.1:8080' })), false);
  });

  it('setsBrowserIdentity ignores commented-out examples', () => {
    assert.strictEqual(setsBrowserIdentity("// window.FABRIC_DEV_BROWSER_SEED = 'word1 word2';\nwindow.FABRIC_EDGE_AUTHORITY = 'x';"), false);
    assert.strictEqual(setsBrowserIdentity(' * FABRIC_DEV_BROWSER_SEED in a block comment'), false);
    assert.strictEqual(setsBrowserIdentity('window.FABRIC_DEV_BROWSER_SEED = "word1 word2";'), true);
    assert.strictEqual(setsBrowserIdentity("window['FABRIC_DEV_BROWSER_PASSPHRASE'] = 'p';"), true);
  });

  describe('createBrowserSecretsGuard', () => {
    let dir;
    let configPath;
    const secretConfig = 'window.FABRIC_EDGE_AUTHORITY = "http://localhost:8080";\nwindow.FABRIC_DEV_BROWSER_SEED = "word1 word2";\n';

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-secrets-guard-'));
      configPath = path.join(dir, 'config.local.js');
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    function run (guard, req) {
      const res = fakeRes();
      let passed = false;
      guard(req, res, () => { passed = true; });
      return { passed, res };
    }

    const configReq = (remote, headers) => fakeReq(remote, headers, { path: '/config.local.js' });

    it('serves config.local.js to this machine without CORS headers', () => {
      fs.writeFileSync(configPath, secretConfig);
      const out = run(createBrowserSecretsGuard({ configPath }), configReq('127.0.0.1', { host: '127.0.0.1:8080', 'sec-fetch-site': 'same-origin' }));
      assert.strictEqual(out.passed, false);
      assert.strictEqual(out.res.body, secretConfig);
      assert.strictEqual(out.res.headers['cross-origin-resource-policy'], 'same-origin');
      assert.strictEqual(out.res.headers['cache-control'], 'no-store');
      assert.strictEqual(out.res.headers['access-control-allow-origin'], undefined);
    });

    it('serves a stub when another site, a rebound name, a proxy, or the LAN asks for the seed', () => {
      fs.writeFileSync(configPath, secretConfig);
      const guard = createBrowserSecretsGuard({ configPath });
      const cases = [
        configReq('127.0.0.1', { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }),
        configReq('127.0.0.1', { host: '127.0.0.1:8080', origin: 'https://evil.example' }),
        configReq('127.0.0.1', { host: 'evil.example:8080' }),
        configReq('127.0.0.1', { host: 'hub.fabric.pub', 'x-forwarded-for': '203.0.113.9' }),
        configReq('192.168.1.9', { host: '192.168.1.2:8080' })
      ];
      for (const req of cases) {
        const out = run(guard, req);
        assert.strictEqual(out.res.statusCode, 200);
        assert.ok(!String(out.res.body).includes('word1'), JSON.stringify(req.headers));
      }
    });

    it('serves a config without a browser identity to everyone', () => {
      const plain = 'window.FABRIC_HUB_SEEDS = ["https://hub.fabric.pub"];\n';
      fs.writeFileSync(configPath, plain);
      const out = run(createBrowserSecretsGuard({ configPath }), configReq('192.168.1.9', { host: '192.168.1.2:8080' }));
      assert.strictEqual(out.res.body, plain);
    });

    it('falls through when there is no config.local.js, and for other paths', () => {
      const guard = createBrowserSecretsGuard({ configPath });
      assert.strictEqual(run(guard, configReq('127.0.0.1', { host: '127.0.0.1:8080' })).passed, true);
      assert.strictEqual(run(guard, fakeReq('192.168.1.9', { host: '192.168.1.2:8080', accept: 'text/html' }, { path: '/documents' })).passed, true);
    });

    it('with inline identity, refuses the HTML shell to anything but this machine', () => {
      const guard = createBrowserSecretsGuard({ configPath, inlineIdentity: true });
      const page = (remote, headers, p = '/documents') => fakeReq(remote, headers, { path: p });
      assert.strictEqual(run(guard, page('127.0.0.1', { host: '127.0.0.1:8080', accept: 'text/html' })).passed, true);
      assert.strictEqual(run(guard, page('127.0.0.1', { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' })).passed, true);
      assert.strictEqual(run(guard, page('192.168.1.9', { host: '192.168.1.2:8080', accept: 'text/html' })).res.statusCode, 403);
      assert.strictEqual(run(guard, page('127.0.0.1', { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', accept: '*/*' })).res.statusCode, 403);
      assert.strictEqual(run(guard, page('127.0.0.1', { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' }, '/')).res.statusCode, 403);
      assert.strictEqual(run(guard, page('192.168.1.9', { host: '192.168.1.2:8080' }, '/bundles/browser.min.js')).passed, true);
      assert.strictEqual(run(guard, page('192.168.1.9', { host: '192.168.1.2:8080', accept: 'application/json' })).passed, true);
    });
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
