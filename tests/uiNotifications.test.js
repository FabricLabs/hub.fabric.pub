'use strict';

const assert = require('assert');
const { resetFabricBrowserStateStore } = require('../functions/fabricBrowserState');
const notifications = require('../functions/uiNotifications');

describe('uiNotifications (notification history)', function () {
  let previousWindow;
  let previousCustomEvent;

  function installWindowMock () {
    const store = new Map();
    global.window = {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key)
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true
    };
  }

  before(function () {
    previousWindow = global.window;
    previousCustomEvent = global.CustomEvent;
    if (typeof global.CustomEvent !== 'function') {
      global.CustomEvent = class CustomEvent {
        constructor (type, init) {
          this.type = type;
          this.detail = init && init.detail;
        }
      };
    }
  });

  beforeEach(function () {
    resetFabricBrowserStateStore();
    installWindowMock();
  });

  after(function () {
    global.window = previousWindow;
    global.CustomEvent = previousCustomEvent;
    resetFabricBrowserStateStore();
  });

  const read = () => notifications.readUiNotifications();
  const byId = (id) => read().find((n) => n.id === id);

  it('starts new rows unread and counts them', function () {
    notifications.pushUiNotification({ id: 'a', title: 'A' });
    notifications.pushUiNotification({ id: 'b', title: 'B' });
    assert.strictEqual(byId('a').readAt, null);
    assert.strictEqual(notifications.countUnread(read()), 2);
  });

  it('keeps read state when a row is updated in place', function () {
    notifications.pushUiNotification({ id: 'a', title: 'A' });
    notifications.markUiNotificationsRead(['a']);
    const readAt = byId('a').readAt;
    assert.ok(readAt > 0);
    notifications.pushUiNotification({ id: 'a', title: 'A again' });
    assert.strictEqual(byId('a').title, 'A again');
    assert.strictEqual(byId('a').readAt, readAt);
    assert.strictEqual(read().length, 1);
  });

  it('marks read, unread, and all read without deleting anything', function () {
    notifications.pushUiNotification({ id: 'a', title: 'A' });
    notifications.pushUiNotification({ id: 'b', title: 'B' });
    notifications.markUiNotificationsRead(['a']);
    assert.strictEqual(notifications.countUnread(read()), 1);
    notifications.markUiNotificationUnread('a');
    assert.strictEqual(notifications.countUnread(read()), 2);
    notifications.markAllUiNotificationsRead();
    assert.strictEqual(notifications.countUnread(read()), 0);
    assert.deepStrictEqual(read().map((n) => n.id).sort(), ['a', 'b']);
  });

  it('counts rows saved before read state as unread', function () {
    assert.strictEqual(notifications.countUnread([{ id: 'old', title: 'Old', ts: 1 }]), 1);
    assert.strictEqual(notifications.countUnread([{ id: 'old', title: 'Old', ts: 1, readAt: 5 }]), 0);
  });

  it('resolves a row: kept in history, read, and marked resolved', function () {
    notifications.pushUiNotification({ id: 'delegation:x', kind: 'delegation', title: 'Signing request' });
    notifications.resolveUiNotification('delegation:x');
    const row = byId('delegation:x');
    assert.ok(row, 'row kept');
    assert.ok(row.readAt > 0);
    assert.ok(row.resolvedAt > 0);
  });

  it('prunes other rows past the history cap but never wallet transactions', function () {
    const base = 1700000000000;
    const list = [];
    for (let i = 0; i < 3; i++) list.push({ id: `w${i}`, kind: 'wallet_receive_confirmed', title: 'Paid', ts: base + i });
    list.push({ id: 'inv', kind: 'l1_invoice', title: 'Invoice', ts: base + 3 });
    for (let i = 0; i < notifications.MAX_HISTORY + 20; i++) {
      list.push({ id: `n${i}`, kind: 'info', title: 'Info', ts: base + 1000 + i });
    }
    const kept = notifications.retainHistory(list);
    for (const id of ['w0', 'w1', 'w2', 'inv']) assert.ok(kept.some((n) => n.id === id), `${id} kept`);
    const others = kept.filter((n) => !notifications.isWalletTransactionNotification(n));
    assert.strictEqual(others.length, notifications.MAX_HISTORY);
    assert.ok(!others.some((n) => n.id === 'n0'), 'oldest other rows go first');
    assert.ok(kept[0].ts >= kept[kept.length - 1].ts, 'newest first');
  });

  it('keeps wallet rows through pushes past the cap', function () {
    notifications.pushUiNotification({ id: 'wallet-1', kind: 'wallet_receive', title: 'Received', ts: 1 });
    for (let i = 0; i < notifications.MAX_HISTORY + 5; i++) {
      notifications.pushUiNotification({ id: `n${i}`, title: 'Info', ts: 100 + i });
    }
    assert.ok(byId('wallet-1'), 'wallet transaction kept');
    assert.strictEqual(read().length, notifications.MAX_HISTORY + 1);
  });
});
