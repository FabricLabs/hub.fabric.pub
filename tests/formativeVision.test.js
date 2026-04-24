'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const merge = require('lodash.merge');
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

function requestJson ({ hostname, port, method, route, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname,
      port,
      path: route,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {
          parsed = raw;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function rpc ({ hostname, port, method, params }) {
  const res = await requestJson({
    hostname,
    port,
    method: 'POST',
    route: '/services/rpc',
    body: { jsonrpc: '2.0', id: 1, method, params }
  });
  assert.strictEqual(res.status, 200, `RPC ${method} should return HTTP 200`);
  assert.ok(res.body && typeof res.body === 'object', `RPC ${method} should return JSON object`);
  if (res.body.error) throw new Error(`RPC ${method} error: ${JSON.stringify(res.body.error)}`);
  return res.body.result;
}

describe('Formative Vision Integration', function () {
  let hub;
  let testFsPath;
  let httpPort;
  let host;

  before(async function () {
    this.timeout(120000);
    const p2pPort = await getFreePort();
    httpPort = await getFreePort();
    host = '127.0.0.1';
    testFsPath = path.join(__dirname, '..', 'stores', `hub-vision-test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(testFsPath, { recursive: true });

    hub = new Hub(merge({}, settings, {
      port: p2pPort,
      fs: { path: testFsPath },
      bitcoin: {
        enable: false,
        network: 'regtest'
      },
      distributed: {
        enable: true
      },
      http: {
        hostname: '127.0.0.1',
        interface: '127.0.0.1',
        listen: true,
        port: httpPort
      },
      debug: false
    }));

    await hub.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  after(async function () {
    this.timeout(10000);
    if (hub) {
      await Promise.race([
        hub.stop(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop timeout')), 8000))
      ]).catch(() => {});
    }
    if (testFsPath) {
      try {
        fs.rmSync(testFsPath, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  it('distributed manifest exposes sidechain patch type and rejects keepalive types in the allowed set', async function () {
    const res = await requestJson({
      hostname: host,
      port: httpPort,
      method: 'GET',
      route: '/services/distributed/manifest'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object');
    assert.strictEqual(res.body.version, 1);
    assert.ok(Array.isArray(res.body.allowedMessageTypes), 'allowedMessageTypes should be an array');
    assert.ok(res.body.allowedMessageTypes.includes('SIDECHAIN_STATE_PATCH'), 'manifest should allow sidechain patches');
    assert.strictEqual(res.body.allowedMessageTypes.includes('Ping'), false, 'Ping must not be part of distributed contract message types');
    assert.strictEqual(res.body.allowedMessageTypes.includes('Pong'), false, 'Pong must not be part of distributed contract message types');
  });

  it('sidechain patch submit requires admin token when no federation validators are configured', async function () {
    const result = await rpc({
      hostname: host,
      port: httpPort,
      method: 'SubmitSidechainStatePatch',
      params: [{ basisClock: 0, patches: [{ op: 'add', path: '/vision', value: 'test' }] }]
    });
    assert.ok(result && typeof result === 'object');
    assert.strictEqual(result.status, 'error');
    assert.ok(String(result.message || '').toLowerCase().includes('admintoken required'));
  });

  it('worker queue strategy is visible and non-admin updates are denied', async function () {
    const status = await rpc({
      hostname: host,
      port: httpPort,
      method: 'GetWorkerStatus',
      params: [{}]
    });
    assert.strictEqual(status.status, 'success');
    assert.ok(Array.isArray(status.strategies));
    assert.ok(status.strategies.includes('highest_value_first'));
    assert.ok(status.strategies.includes('fifo'));
    assert.ok(status.strategies.includes('oldest_high_value_first'));

    const denied = await rpc({
      hostname: host,
      port: httpPort,
      method: 'SetWorkerQueueStrategy',
      params: [{ strategy: 'fifo' }]
    });
    assert.strictEqual(denied.status, 'error');
    assert.ok(String(denied.message || '').includes('adminToken required'));
  });

  it('operator health endpoint returns core node observability fields', async function () {
    const res = await requestJson({
      hostname: host,
      port: httpPort,
      method: 'GET',
      route: '/services/operator/health'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body && typeof res.body === 'object');
    assert.ok(res.body.node && typeof res.body.node === 'object');
    assert.ok(res.body.disk && typeof res.body.disk === 'object');
    assert.ok(res.body.network && typeof res.body.network === 'object');
    assert.ok(res.body.node.memory && typeof res.body.node.memory === 'object');
    assert.ok(res.body.node.cpu && typeof res.body.node.cpu === 'object');
    assert.strictEqual(typeof res.body.node.memory.rss, 'number');
    assert.strictEqual(typeof res.body.node.cpu.cores, 'number');
  });

  it('inventory HTLC seller reveal remains admin-gated for non-admin callers', async function () {
    const result = await rpc({
      hostname: host,
      port: httpPort,
      method: 'GetInventoryHtlcSellerReveal',
      params: [{ settlementId: 'vision-test-settlement' }]
    });
    assert.ok(result && typeof result === 'object');
    assert.strictEqual(result.status, 'error');
    assert.ok(String(result.message || '').toLowerCase().includes('admin token required'));
  });
});
