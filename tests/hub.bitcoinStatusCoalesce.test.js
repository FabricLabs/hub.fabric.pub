'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

function hub (settings = {}) {
  const h = Object.create(Hub.prototype);
  h.settings = { bitcoin: settings };
  h._bitcoinStatusCache = { value: null, updatedAt: 0 };
  h._bitcoinCacheTTL = 15000;
  h.runs = 0;
  h.broadcasts = 0;
  h._collectBitcoinStatusNow = async function () {
    const run = ++this.runs;
    await new Promise((r) => setTimeout(r, 10));
    const value = { available: true, run };
    this._bitcoinStatusCache = { value, updatedAt: Date.now() };
    return value;
  };
  h._broadcastBitcoinStatusToClients = function () { this.broadcasts++; };
  return h;
}

describe('Hub Bitcoin status coalescing', function () {
  it('forced collects during a run share one follow-up run', async function () {
    const h = hub();
    const first = h._collectBitcoinStatus({ force: true });
    const later = Array.from({ length: 20 }, () => h._collectBitcoinStatus({ force: true }));
    const [a, ...rest] = await Promise.all([first, ...later]);
    assert.strictEqual(a.run, 1);
    assert.ok(rest.every((s) => s.run === 2), 'every later caller gets the run started after it asked');
    assert.strictEqual(h.runs, 2);
  });

  it('serves the cache when not forced', async function () {
    const h = hub();
    await h._collectBitcoinStatus({ force: true });
    await h._collectBitcoinStatus();
    assert.strictEqual(h.runs, 1);
  });

  it('a transaction burst refreshes status once per window, trailing', async function () {
    const h = hub({ transactionStatusMs: 30 });
    const pending = [];
    for (let i = 0; i < 100; i++) pending.push(h._handleBitcoinTransactionUpdate({}));
    assert.strictEqual(pending.filter(Boolean).length, 1, 'one refresh scheduled');
    await pending[0];
    assert.strictEqual(h.runs, 1);
    assert.strictEqual(h.broadcasts, 1);
    const next = h._handleBitcoinTransactionUpdate({});
    const started = Date.now();
    await next;
    assert.ok(Date.now() - started >= 15, 'the next refresh waits out the window');
    assert.strictEqual(h.runs, 2);
  });
});
