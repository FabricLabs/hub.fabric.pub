'use strict';

const assert = require('assert');
const {
  bitcoinStatusLine,
  lightningStatusLine,
  restorableWindowBounds,
  trayStatusLines
} = require('../functions/desktopShellStatus');

describe('desktop shell status', function () {
  it('shows only the Hub state until it is running', function () {
    assert.deepStrictEqual(trayStatusLines({ hubStatus: 'starting', peering: { p2p: { connections: 3 } } }), ['Hub: Starting…']);
  });

  it('summarises peers, Bitcoin, and Lightning', function () {
    const lines = trayStatusLines({
      hubStatus: 'running',
      peering: { p2p: { connections: 1, listening: true } },
      bitcoin: { available: true, network: 'regtest', height: 812, blockchain: { verificationprogress: 1 } },
      lightning: { available: true, status: 'RUNNING' }
    });
    assert.deepStrictEqual(lines, [
      'Hub: Running',
      'Fabric: 1 peer',
      'Bitcoin (regtest): block 812',
      'Lightning: running'
    ]);
  });

  it('reports Bitcoin sync progress and hides unconfigured Lightning', function () {
    assert.strictEqual(
      bitcoinStatusLine({ available: true, network: 'main', blockchain: { blocks: 100, verificationprogress: 0.4231, initialblockdownload: true } }),
      'Bitcoin (main): syncing 42.3% · block 100'
    );
    assert.strictEqual(bitcoinStatusLine({ available: false }), 'Bitcoin: unavailable');
    assert.strictEqual(lightningStatusLine({ available: false, status: 'NOT_CONFIGURED' }), null);
  });

  it('restores window bounds only onto a display that still exists', function () {
    const displays = [{ x: 0, y: 0, width: 1440, height: 900 }];
    assert.deepStrictEqual(
      restorableWindowBounds({ x: 100, y: 80, width: 700, height: 500 }, displays, { width: 800, height: 600 }),
      { x: 100, y: 80, width: 800, height: 600 }
    );
    assert.strictEqual(restorableWindowBounds({ x: 3000, y: 80, width: 1280, height: 840 }, displays), undefined);
    assert.strictEqual(restorableWindowBounds(null, displays), undefined);
  });
});
