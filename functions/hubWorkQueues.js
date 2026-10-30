'use strict';

/**
 * @fileoverview Serialized and shared async work for bursty inputs such as
 * Bitcoin block notifications during a chain sync or reorg.
 */

/**
 * Run `handler` one item at a time, in arrival order, keeping every item that
 * arrives while one is running. Callers should push small items: a burst
 * waits in memory until it is handled.
 * @param {Function} handler async (item) => any
 * @param {Object} [opts]
 * @param {Function} [opts.onError] (err, item) => void
 * @returns {{ push: Function, idle: Function, stats: Function }}
 */
function createSerialQueue (handler, opts = {}) {
  let running = false;
  const pending = [];
  let maxPending = 0;
  let processed = 0;
  let failed = 0;
  let idleWaiters = [];

  const drain = async () => {
    running = true;
    while (pending.length) {
      const item = pending.shift();
      try {
        await handler(item);
      } catch (err) {
        failed++;
        if (typeof opts.onError === 'function') opts.onError(err, item);
      }
      processed++;
    }
    running = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  return {
    push (item) {
      pending.push(item);
      if (pending.length > maxPending) maxPending = pending.length;
      if (!running) drain();
    },
    idle () {
      if (!running && !pending.length) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    stats () {
      return { running, pending: pending.length, maxPending, processed, failed };
    }
  };
}

/**
 * Share one in-flight call per key and reuse its result for `ttlMs` after it
 * settles. Failures are not cached.
 * @param {Object} [opts]
 * @param {number} [opts.ttlMs=0]
 * @param {Function} [opts.now]
 * @returns {{ run: Function, stats: Function }}
 */
function createSingleFlight (opts = {}) {
  const ttlMs = Math.max(0, Number(opts.ttlMs) || 0);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const inflight = new Map();
  const cache = new Map();
  let calls = 0;
  let shared = 0;
  let cached = 0;

  return {
    run (key, fn) {
      calls++;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) {
        cached++;
        return Promise.resolve(hit.value);
      }
      if (inflight.has(key)) {
        shared++;
        return inflight.get(key);
      }
      const task = Promise.resolve().then(fn).then((value) => {
        if (ttlMs > 0) cache.set(key, { value, at: now() });
        return value;
      }).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },
    stats () {
      return { inflight: inflight.size, calls, shared, cached };
    }
  };
}

module.exports = {
  createSerialQueue,
  createSingleFlight
};
