'use strict';

const assert = require('assert');
const { createSerialQueue, createSingleFlight } = require('../functions/hubWorkQueues');

describe('hubWorkQueues', function () {
  it('runs a burst one at a time and handles every item in order', async function () {
    const seen = [];
    let active = 0;
    let maxActive = 0;
    const queue = createSerialQueue(async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      seen.push(item);
      active--;
    });
    const items = [];
    for (let i = 1; i <= 1000; i++) {
      items.push(i);
      queue.push(i);
    }
    await queue.idle();
    assert.deepStrictEqual(seen, items);
    assert.strictEqual(maxActive, 1);
    assert.deepStrictEqual(queue.stats(), { running: false, pending: 0, maxPending: 999, processed: 1000, failed: 0 });
  });

  it('keeps going after a handler fails', async function () {
    const errors = [];
    const seen = [];
    const queue = createSerialQueue(async (item) => {
      if (item === 'bad') throw new Error('boom');
      seen.push(item);
    }, { onError: (err) => errors.push(err.message) });
    queue.push('bad');
    queue.push('good');
    await queue.idle();
    assert.deepStrictEqual(errors, ['boom']);
    assert.deepStrictEqual(seen, ['good']);
    assert.strictEqual(queue.stats().failed, 1);
  });

  it('shares in-flight calls, caches results for the window, and never caches failures', async function () {
    let clock = 0;
    const flight = createSingleFlight({ ttlMs: 1000, now: () => clock });
    let calls = 0;
    const fn = () => { calls++; return new Promise((resolve) => setTimeout(() => resolve(calls), 5)); };
    const [a, b] = await Promise.all([flight.run('k', fn), flight.run('k', fn)]);
    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);
    assert.strictEqual(await flight.run('k', fn), 1);
    clock = 1001;
    assert.strictEqual(await flight.run('k', fn), 2);

    await assert.rejects(flight.run('e', () => Promise.reject(new Error('down'))), /down/);
    assert.strictEqual(await flight.run('e', () => 'up'), 'up');
    assert.strictEqual(flight.stats().inflight, 0);
  });
});
