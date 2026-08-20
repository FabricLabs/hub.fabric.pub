'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const merge = require('lodash.merge');
require('../functions/patchLinkedFabricNodePath');
const Hub = require('../services/hub');
const settings = require('../settings/local');

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

function jsonRequest (baseUrl, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, baseUrl);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method,
      headers: Object.assign({
        Accept: 'application/json'
      }, payload ? {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      } : {})
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = raw;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Hub first-time setup bootstrap', function () {
  this.timeout(30000);

  let hub;
  let testFsPath;
  let baseUrl;

  before(async function () {
    const [p2pPort, httpPort] = await Promise.all([getFreePort(), getFreePort()]);
    testFsPath = path.join(__dirname, '..', 'stores', `hub-setup-boot-${process.pid}-${Date.now()}`);
    fs.mkdirSync(testFsPath, { recursive: true });
    hub = new Hub(merge({}, settings, {
      port: p2pPort,
      fs: { path: testFsPath },
      peersDb: path.join(testFsPath, 'peers'),
      bitcoin: { enable: false, network: 'regtest' },
      http: { hostname: '127.0.0.1', interface: '127.0.0.1', listen: true, port: httpPort },
      debug: false
    }));
    await hub.start();
    baseUrl = `http://127.0.0.1:${httpPort}`;
    await new Promise((r) => setTimeout(r, 400));
  });

  after(async function () {
    if (hub) {
      await Promise.race([
        hub.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 8000))
      ]).catch(() => {});
    }
    if (testFsPath) {
      try { fs.rmSync(testFsPath, { recursive: true, force: true }); } catch (_) {}
    }
  });

  it('GET /settings reports needsSetup until POST writes STATE, then survives commit()', async function () {
    const before = await jsonRequest(baseUrl, 'GET', '/settings');
    assert.strictEqual(before.status, 200);
    assert.strictEqual(before.body.needsSetup, true);
    assert.strictEqual(before.body.configured, false);

    const boot = await jsonRequest(baseUrl, 'POST', '/settings', {
      NODE_NAME: 'Setup Boot Hub',
      BITCOIN_MANAGED: false,
      LIGHTNING_MANAGED: false,
      BITCOIN_PRESET: 'local-dev',
      BITCOIN_NETWORK: 'regtest',
      BITCOIN_LISTEN: false,
      BITCOIN_PRUNE: 0
    });
    assert.strictEqual(boot.status, 200, JSON.stringify(boot.body).slice(0, 400));
    assert.ok(boot.body.token);
    assert.strictEqual(boot.body.configured, true);
    assert.ok(boot.body.stores && boot.body.stores.configured);

    const after = await jsonRequest(baseUrl, 'GET', '/settings');
    assert.strictEqual(after.body.needsSetup, false);
    assert.strictEqual(after.body.configured, true);
    assert.strictEqual(after.body.settings.NODE_NAME, 'Setup Boot Hub');
    assert.strictEqual(after.body.settings.BITCOIN_PRESET, 'local-dev');

    hub.commit();
    const statePath = path.join(testFsPath, 'STATE');
    const disk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.ok(disk.settings);
    assert.strictEqual(disk.settings.IS_CONFIGURED, true);
    assert.ok(disk.collections && typeof disk.collections.messages === 'object');
    assert.ok(fs.existsSync(path.join(testFsPath, 'peers')));

    const again = await jsonRequest(baseUrl, 'GET', '/settings');
    assert.strictEqual(again.body.configured, true);
    assert.strictEqual(again.body.needsSetup, false);
  });
});
