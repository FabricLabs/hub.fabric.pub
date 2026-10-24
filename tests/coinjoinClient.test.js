'use strict';

const assert = require('assert');
const {
  blocksToDuration,
  bondLockText,
  bondCertificateText,
  offerFeeSats,
  fetchCoinjoinOffers,
  startCoinjoinRound
} = require('../functions/coinjoinClient');

describe('coinjoinClient', function () {
  it('turns blocks into rough durations', function () {
    assert.strictEqual(blocksToDuration(1), '10 minutes');
    assert.strictEqual(blocksToDuration(12), '2 hours');
    assert.strictEqual(blocksToDuration(144 * 3), '3 days');
    assert.strictEqual(blocksToDuration(4320 * 2), '2 months');
    assert.strictEqual(blocksToDuration(-5), '0 minutes');
  });

  it('describes a bond lock and certificate', function () {
    assert.strictEqual(
      bondLockText({ status: 'confirmed', locktime: 1100, blocksUntilUnlock: 144 }),
      'Locked until block 1100 (144 blocks, about 24 hours)'
    );
    assert.strictEqual(bondLockText({ status: 'confirmed', locktime: 1100, blocksUntilUnlock: 0 }), 'Unlocked at block 1100');
    assert.strictEqual(bondLockText({ status: 'redeemed', locktime: 1100 }), 'Redeemed');
    assert.strictEqual(bondCertificateText({ certExpiresAt: null }), 'No certificate');
    assert.strictEqual(bondCertificateText({ certExpiresAt: 900, certBlocksLeft: 0 }), 'Expired at block 900');
    assert.strictEqual(bondCertificateText({ certExpiresAt: 2000, certBlocksLeft: 288 }), 'Expires at block 2000 (about 2 days)');
  });

  it('computes the maker fee like the Hub', function () {
    assert.strictEqual(offerFeeSats({ feeSats: 250, feePpm: 200 }, 1000000), 450);
    assert.strictEqual(offerFeeSats({ feeSats: 0, feePpm: 1 }, 999999), 0);
  });

  describe('requests', function () {
    let calls;
    let reply;
    const realFetch = global.fetch;

    beforeEach(function () {
      calls = [];
      reply = { status: 200, body: { ok: true } };
      global.fetch = async (url, init) => {
        calls.push({ url, init });
        return {
          ok: reply.status < 400,
          status: reply.status,
          statusText: '',
          text: async () => JSON.stringify(reply.body)
        };
      };
    });

    afterEach(function () {
      global.fetch = realFetch;
    });

    it('filters offers by amount without a token', async function () {
      await fetchCoinjoinOffers({ amountSats: 50000 });
      assert.strictEqual(calls[0].url, '/services/coinjoin/offers?amountSats=50000');
      assert.strictEqual(calls[0].init.headers.Authorization, undefined);
    });

    it('sends the admin token and surfaces Hub errors', async function () {
      reply = { status: 400, body: { status: 'error', message: 'no makers offer 5000 sats' } };
      await assert.rejects(
        startCoinjoinRound('tok', { amountSats: 5000 }),
        (err) => err.status === 400 && /no makers offer/.test(err.message)
      );
      assert.strictEqual(calls[0].init.method, 'POST');
      assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok');
      assert.deepStrictEqual(JSON.parse(calls[0].init.body), { amountSats: 5000 });
    });
  });
});
