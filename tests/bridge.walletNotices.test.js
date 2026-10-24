'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Message = require('@fabric/core/types/message');
const { resetFabricBrowserStateStore } = require('../functions/fabricBrowserState');
require('@babel/register');

describe('Bridge wallet updates (balance chip + receive notices)', function () {
  this.timeout(180000);

  let Bridge;
  let previousWindow;
  let events;

  function createLocalStorageMock () {
    const store = new Map();
    return {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    };
  }

  function installWindowMock () {
    events = [];
    global.window = {
      location: { hostname: 'localhost', port: '8080', protocol: 'http:', pathname: '/' },
      localStorage: createLocalStorageMock(),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: (ev) => { events.push(ev); return true; }
    };
  }

  function stateUpdatesFor (prefix) {
    return events.filter((ev) => ev && ev.type === 'globalStateUpdate' &&
      ev.detail && ev.detail.operation && String(ev.detail.operation.path || '').startsWith(prefix));
  }

  before(function () {
    previousWindow = global.window;
    installWindowMock();
    Bridge = require('../components/Bridge');
  });

  beforeEach(function () {
    resetFabricBrowserStateStore();
    installWindowMock();
  });

  after(function () {
    global.window = previousWindow;
  });

  it('applies the hub `/bitcoin` status push (wire type JSON_PATCH) so the header refreshes', async function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const hubKey = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const patch = { op: 'add', path: '/bitcoin', value: { available: true, height: 101 } };
    const msg = Message.fromVector(['JSONPatch', JSON.stringify(patch)]);
    msg.signWithKey(hubKey);
    assert.strictEqual(Message.fromBuffer(msg.toBuffer()).type, 'JSON_PATCH');

    await bridge.onSocketMessage({ data: msg.toBuffer() });

    const updates = stateUpdatesFor('/bitcoin');
    assert.strictEqual(updates.length, 1, 'the /bitcoin patch reaches globalStateUpdate listeners');
    assert.strictEqual(updates[0].detail.operation.value.height, 101);
  });

  it('announces mempool and confirmed receives fed by the header balance refresh', function () {
    const bridge = new Bridge({ responseCapture: () => {} });
    const walletId = 'w1';
    bridge.noteClientWalletBalance({ walletId, balanceSats: 1000, confirmedSats: 1000, unconfirmedSats: 0 });
    assert.strictEqual(stateUpdatesFor('/messages/').length, 0, 'first reading is only a baseline');

    bridge.noteClientWalletBalance({ walletId, balanceSats: 6000, confirmedSats: 1000, unconfirmedSats: 5000 });
    bridge.noteClientWalletBalance({ walletId, balanceSats: 6000, confirmedSats: 1000, unconfirmedSats: 5000 });
    bridge.noteClientWalletBalance({ walletId, balanceSats: 6000, confirmedSats: 6000, unconfirmedSats: 0 });

    const kinds = stateUpdatesFor('/messages/').map((ev) => ev.detail.operation.value.object.kind);
    assert.deepStrictEqual(kinds, ['wallet_receive_mempool', 'wallet_receive_confirmed'], 'one notice per phase, repeats are silent');
  });
});
