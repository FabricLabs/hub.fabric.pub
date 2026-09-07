'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HUB_SETUP_APPLY_MIN_MS } = require('../functions/hubBitcoinSetup');
const { seedHubStoresAfterSetup, HUB_SETUP_COLLECTION_NAMES } = require('../functions/hubSetupStores');

describe('hubSetupStores', function () {
  it('exports the same 2.5s apply floor as Bitcoin setup', function () {
    assert.strictEqual(HUB_SETUP_APPLY_MIN_MS, 2500);
  });

  it('seeds STATE collections, settings, and the peers directory then commit()s', function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-setup-stores-'));
    const peersDir = path.join(tmp, 'peers');
    const writes = [];
    const hub = {
      settings: { peersDb: peersDir },
      fs: {
        path: tmp,
        writeFile (name, body) { writes.push({ name, body }); }
      },
      setup: {
        listSettings () {
          return { IS_CONFIGURED: true, NODE_NAME: 'Test Hub', BITCOIN_MANAGED: false };
        }
      },
      _state: { content: {} },
      commit () {
        this._state.content.settings = Object.assign({}, this.setup.listSettings(), this._state.content.settings || {});
        this.fs.writeFile('STATE', JSON.stringify(this._state.content));
      }
    };

    const result = seedHubStoresAfterSetup(hub);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.configured, true);
    assert.strictEqual(result.peersDir, peersDir);
    assert.ok(fs.existsSync(peersDir));
    for (const name of HUB_SETUP_COLLECTION_NAMES) {
      assert.ok(hub._state.content.collections[name]);
    }
    assert.strictEqual(hub._state.content.settings.IS_CONFIGURED, true);
    assert.ok(writes.some((w) => w.name === 'STATE' && /IS_CONFIGURED/.test(w.body)));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
