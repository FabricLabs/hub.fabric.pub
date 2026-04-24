'use strict';

/**
 * Client-side Lightning helpers (relative URLs + tryRequests fallbacks).
 */

const assert = require('assert');
const {
  createLightningInvoice,
  payLightningInvoice,
  decodeLightningInvoice,
  fetchLightningStatus,
  fetchLightningChannels,
  createLightningChannel
} = require('../functions/bitcoinClient');

describe('bitcoinClient Lightning (L2)', function () {
  let originalFetch;

  beforeEach(function () {
    originalFetch = global.fetch;
  });

  afterEach(function () {
    global.fetch = originalFetch;
  });

  it('payLightningInvoice throws when invoice is empty', async function () {
    await assert.rejects(
      () => payLightningInvoice({ lightningBaseUrl: '/services/lightning' }, { walletId: 'w' }, ''),
      /Invoice is required/
    );
  });

  it('decodeLightningInvoice throws when invoice is empty', async function () {
    await assert.rejects(
      () => decodeLightningInvoice({ lightningBaseUrl: '/services/lightning' }, ''),
      /Invoice is required/
    );
  });

  it('createLightningInvoice POSTs /invoices with walletId and amount', async function () {
    const seen = [];
    global.fetch = async (reqUrl, init) => {
      const parsedBody = init.body ? JSON.parse(init.body) : null;
      seen.push({ url: String(reqUrl), method: init.method, body: parsedBody });
      const u = String(reqUrl);
      assert.ok(u.endsWith('/services/lightning/invoices'), u);
      assert.strictEqual(init.method, 'POST');
      assert.strictEqual(parsedBody.walletId, 'abc');
      assert.strictEqual(parsedBody.amountSats, 99);
      return new Response(JSON.stringify({ invoice: 'lnbc1test', paymentHash: 'ph' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const out = await createLightningInvoice(
      { lightningBaseUrl: 'http://127.0.0.1:1/services/lightning/' },
      { walletId: 'abc' },
      { amountSats: 99, memo: 'm' }
    );
    assert.strictEqual(out.invoice, 'lnbc1test');
    assert.strictEqual(seen.length, 1);
  });

  it('createLightningInvoice rejects when POST /invoices is not successful', async function () {
    global.fetch = async (reqUrl) => {
      assert.ok(String(reqUrl).endsWith('/invoices'));
      return new Response('not here', { status: 404 });
    };
    await assert.rejects(
      () => createLightningInvoice(
        { lightningBaseUrl: 'http://127.0.0.1:9/services/lightning' },
        { walletId: 'w' },
        { amountSats: 1, memo: '' }
      ),
      /404/
    );
  });

  it('payLightningInvoice uses /payments first', async function () {
    global.fetch = async (reqUrl) => {
      assert.ok(String(reqUrl).endsWith('/services/lightning/payments'));
      return new Response(JSON.stringify({ payment: { preimage: 'pre' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const out = await payLightningInvoice(
      { lightningBaseUrl: 'http://127.0.0.1:1/services/lightning' },
      { walletId: 'w1' },
      'lnbc1x'
    );
    assert.strictEqual(out.preimage, 'pre');
  });

  it('decodeLightningInvoice uses /decodes first', async function () {
    global.fetch = async (reqUrl) => {
      assert.ok(String(reqUrl).endsWith('/services/lightning/decodes'));
      return new Response(JSON.stringify({
        decoded: { numSatoshis: 123, paymentHash: 'h' }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const out = await decodeLightningInvoice({ lightningBaseUrl: 'http://127.0.0.1:1/services/lightning' }, 'lnbc1y');
    assert.strictEqual(out.numSatoshis, 123);
  });

  it('fetchLightningStatus GETs lightning base', async function () {
    global.fetch = async (reqUrl) => {
      assert.strictEqual(String(reqUrl), 'http://localhost/services/lightning');
      return new Response(JSON.stringify({ available: true, status: 'RUNNING' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const out = await fetchLightningStatus({
      lightningBaseUrl: 'http://localhost/services/lightning/'
    });
    assert.strictEqual(out.status, 'RUNNING');
    assert.strictEqual(out.available, true);
  });

  it('fetchLightningChannels normalizes channels and outputs arrays', async function () {
    global.fetch = async (reqUrl) => {
      assert.ok(String(reqUrl).endsWith('/channels'));
      return new Response(JSON.stringify({
        channels: [{ id: 'c1' }],
        outputs: [{ txid: 't', output: 0 }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const out = await fetchLightningChannels({ lightningBaseUrl: '/services/lightning' });
    assert.strictEqual(out.channels.length, 1);
    assert.strictEqual(out.outputs.length, 1);
  });

  it('normalizeLightning base: bitcoin root maps to /services/lightning', async function () {
    const urls = [];
    global.fetch = async (reqUrl) => {
      urls.push(String(reqUrl));
      return new Response(JSON.stringify({ invoice: 'x' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    await createLightningInvoice(
      { lightningBaseUrl: 'http://127.0.0.1:1/services/bitcoin' },
      {},
      { amountSats: 1 }
    );
    assert.ok(urls[0].endsWith('/services/lightning/invoices'), urls[0]);
  });

  it('createLightningChannel requires remote or peerId', async function () {
    await assert.rejects(
      () => createLightningChannel({ lightningBaseUrl: '/services/lightning' }, { amountSats: 10000 }),
      /remote \(id@ip:port\) or peerId is required/
    );
  });

  it('createLightningChannel returns error object on HTTP error', async function () {
    global.fetch = async () =>
      new Response(JSON.stringify({ error: 'bad', detail: 'nope' }), { status: 400 });

    const out = await createLightningChannel(
      { lightningBaseUrl: '/services/lightning' },
      { remote: '03ab@127.0.0.1:9735', amountSats: 10000 }
    );
    assert.strictEqual(out.error, 'bad');
    assert.strictEqual(out.detail, 'nope');
  });

  it('createLightningChannel parses channel on success', async function () {
    global.fetch = async (reqUrl, init) => {
      assert.ok(String(reqUrl).endsWith('/services/lightning/channels'));
      assert.strictEqual(init.method, 'POST');
      const b = JSON.parse(init.body);
      assert.ok(b.remote);
      assert.strictEqual(b.amountSats, 50000);
      return new Response(JSON.stringify({ channel: { id: 'ch1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const out = await createLightningChannel(
      { lightningBaseUrl: '/services/lightning' },
      { remote: '03ab@127.0.0.1:9735', amountSats: 50000 }
    );
    assert.strictEqual(out.id, 'ch1');
  });
});
