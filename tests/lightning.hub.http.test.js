'use strict';

/**
 * Lightning (L2) HTTP surface — stub mode without Core Lightning.
 * Covers GET/POST under /services/lightning when settings.lightning.stub is true.
 */

const assert = require('assert');
const http = require('http');
const url = require('url');
const merge = require('lodash.merge');
const Hub = require('../services/hub');
const settings = require('../settings/local');

describe('Lightning HTTP (stub)', function () {
  let hub;
  const baseUrl = 'http://localhost:8085';
  const httpPort = 8085;

  before(async function () {
    this.timeout(60000);
    hub = new Hub(merge({}, settings, {
      port: 7780,
      fs: { path: 'stores/hub-test-lightning' },
      bitcoin: {
        enable: false,
        network: 'regtest'
      },
      lightning: {
        stub: true,
        managed: false
      },
      http: {
        hostname: 'localhost',
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 8000))
      ]).catch(() => {});
    }
  });

  function makeRequest (method, path, data = null) {
    return new Promise((resolve, reject) => {
      const requestUrl = url.parse(`${baseUrl}${path}`);
      const options = {
        hostname: requestUrl.hostname,
        port: requestUrl.port,
        path: requestUrl.path,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, body });
          }
        });
      });
      req.on('error', reject);
      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  }

  it('GET /services/lightning returns STUB status', async function () {
    const { status, body } = await makeRequest('GET', '/services/lightning');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'STUB');
    assert.strictEqual(body.service, 'lightning');
    assert.strictEqual(body.available, true);
  });

  it('DELETE /services/lightning/channels/:channelId closes in stub mode', async function () {
    const { status, body } = await makeRequest('DELETE', '/services/lightning/channels/abc123');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.closed, true);
    assert.strictEqual(body.stub, true);
    assert.strictEqual(body.channelId, 'abc123');
  });

  it('GET /services/lightning/invoices returns empty list in stub', async function () {
    const { status, body } = await makeRequest('GET', '/services/lightning/invoices');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.invoices));
    assert.strictEqual(body.invoices.length, 0);
  });

  it('GET /services/lightning/channels returns empty channels in stub', async function () {
    const { status, body } = await makeRequest('GET', '/services/lightning/channels');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.channels));
    assert.ok(Array.isArray(body.outputs));
  });

  it('POST /services/lightning/invoices creates stub bolt11', async function () {
    const { status, body } = await makeRequest('POST', '/services/lightning/invoices', {
      amountSats: 42,
      memo: 'unit test'
    });
    assert.strictEqual(status, 200);
    assert.ok(body.invoice && String(body.invoice).startsWith('lnbc'), 'expected lnbc prefix');
    assert.strictEqual(body.amountSats, 42);
    assert.strictEqual(body.memo, 'unit test');
    assert.strictEqual(body.stub, true);
    assert.ok(body.paymentHash);
  });

  it('POST /services/lightning/decodes returns stub decode', async function () {
    const { status, body } = await makeRequest('POST', '/services/lightning/decodes', {
      invoice: 'lnbc100n1pstub'
    });
    assert.strictEqual(status, 200);
    assert.ok(body.decoded);
    assert.strictEqual(body.stub, true);
    assert.ok(typeof body.decoded.numSatoshis === 'number');
  });

  it('POST /services/lightning/payments returns stub preimage', async function () {
    const { status, body } = await makeRequest('POST', '/services/lightning/payments', {
      walletId: 'test-wallet',
      invoice: 'lnbc1fake'
    });
    assert.strictEqual(status, 200);
    assert.ok(body.payment);
    assert.strictEqual(body.payment.preimage, 'stub_preimage');
    assert.ok(body.payment.paymentHash);
    assert.strictEqual(body.stub, true);
  });

  it('stub L2 flow: invoice then decode then pay', async function () {
    const inv = await makeRequest('POST', '/services/lightning/invoices', {
      amountSats: 1000,
      memo: 'flow test'
    });
    assert.strictEqual(inv.status, 200);
    const bolt11 = inv.body.invoice;

    const dec = await makeRequest('POST', '/services/lightning/decodes', { invoice: bolt11 });
    assert.strictEqual(dec.status, 200);
    assert.ok(dec.body.decoded);

    const pay = await makeRequest('POST', '/services/lightning/payments', {
      walletId: 'w1',
      invoice: bolt11
    });
    assert.strictEqual(pay.status, 200);
    assert.ok(pay.body.payment.preimage);
  });
});

describe('Lightning HTTP (no node, no stub)', function () {
  let hub;
  const baseUrl = 'http://localhost:8086';
  const httpPort = 8086;

  before(async function () {
    this.timeout(60000);
    hub = new Hub(merge({}, settings, {
      port: 7781,
      fs: { path: 'stores/hub-test-lightning-nc' },
      bitcoin: { enable: false, network: 'regtest' },
      lightning: {
        stub: false,
        managed: false
      },
      http: {
        hostname: 'localhost',
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('hub.stop() timeout')), 8000))
      ]).catch(() => {});
    }
  });

  function makeRequest (method, path) {
    return new Promise((resolve, reject) => {
      const requestUrl = url.parse(`${baseUrl}${path}`);
      const req = http.request({
        hostname: requestUrl.hostname,
        port: requestUrl.port,
        path: requestUrl.path,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, body });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('GET /services/lightning returns NOT_CONFIGURED when lightning is absent', async function () {
    const { status, body } = await makeRequest('GET', '/services/lightning');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'NOT_CONFIGURED');
    assert.strictEqual(body.available, false);
  });
});
