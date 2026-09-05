'use strict';

const assert = require('assert');
const {
  HUB_START_PHASES,
  resolveStartPhases,
  runHubStartPhase,
  hookMethodName,
  callHubLifecycleHook
} = require('../functions/hubLifecycle');

describe('hubLifecycle', function () {
  it('exports the canonical Hub.start phase list', function () {
    assert.deepStrictEqual(HUB_START_PHASES.slice(), [
      'diagnostics',
      'filesystem',
      'bitcoin',
      'services',
      'state',
      'shell',
      'routes',
      'rpc',
      'listen',
      'runtime'
    ]);
    assert.strictEqual(hookMethodName('before', 'routes'), 'beforeRoutes');
    assert.strictEqual(hookMethodName('after', 'runtime'), 'afterRuntime');
  });

  it('resolveStartPhases respects skipStartPhases and startPhases', function () {
    assert.deepStrictEqual(
      resolveStartPhases({ settings: { skipStartPhases: ['bitcoin'] } }),
      HUB_START_PHASES.filter((p) => p !== 'bitcoin')
    );
    assert.deepStrictEqual(
      resolveStartPhases({ settings: { startPhases: ['routes', 'listen'] } }),
      ['routes', 'listen']
    );
  });

  it('runHubStartPhase invokes before/after method hooks and settings.startHooks', async function () {
    const order = [];
    const hub = {
      settings: {
        startHooks: {
          beforeRoutes: async () => { order.push('settings:beforeRoutes'); },
          afterRoutes: async () => { order.push('settings:afterRoutes'); }
        }
      },
      emit (ev, payload) {
        order.push(`emit:${ev}:${payload.status}:${payload.phase}`);
      },
      async beforeRoutes () { order.push('method:beforeRoutes'); },
      async afterRoutes () { order.push('method:afterRoutes'); }
    };
    await runHubStartPhase(hub, 'routes', async function () {
      order.push('body');
      assert.strictEqual(this, hub);
    });
    assert.deepStrictEqual(order, [
      'method:beforeRoutes',
      'settings:beforeRoutes',
      'emit:hub:start:phase:begin:routes',
      'body',
      'emit:hub:start:phase:end:routes',
      'method:afterRoutes',
      'settings:afterRoutes'
    ]);
  });

  it('callHubLifecycleHook is a no-op when hooks are absent', async function () {
    await callHubLifecycleHook({}, 'before', 'listen');
  });
});

describe('Hub start phase methods', function () {
  it('exposes _startPhase_* implementations for every START_PHASES entry', function () {
    const Hub = require('../services/hub');
    assert.strictEqual(Hub.START_PHASES, HUB_START_PHASES);
    for (const phase of Hub.START_PHASES) {
      assert.strictEqual(
        typeof Hub.prototype[`_startPhase_${phase}`],
        'function',
        `missing _startPhase_${phase}`
      );
    }
    assert.strictEqual(typeof Hub.prototype.start, 'function');
  });
});

describe('Hub mocha bind isolation', function () {
  // Hub construction under c8 on macOS runners routinely exceeds mocha's
  // default 2s (settings merge + Peer/HTTP wiring). Keep assertions sync.
  this.timeout(30000);

  it('binds HTTP and Peer to loopback even when settings copy a host NIC', function () {
    const path = require('path');
    const merge = require('lodash.merge');
    const Hub = require('../services/hub');
    const settings = require('../settings/local');
    const hub = new Hub(merge({}, settings, {
      bitcoin: { enable: false },
      fs: { path: path.join(__dirname, '..', 'stores', `hub-bind-iso-${process.pid}`) },
      http: {
        hostname: 'localhost',
        listen: true,
        port: 18080,
        interface: '203.0.113.50'
      },
      interface: '203.0.113.50',
      port: 17777,
      peers: []
    }));
    assert.strictEqual(hub.settings.http.interface, '127.0.0.1');
    assert.strictEqual(hub.settings.interface, '127.0.0.1');
    assert.strictEqual(hub.http.interface, '127.0.0.1');
    assert.strictEqual(hub.agent.settings.interface, '127.0.0.1');
    assert.strictEqual(hub.settings.peersDb, null);
    assert.deepStrictEqual(hub.settings.peers, []);
  });
});
