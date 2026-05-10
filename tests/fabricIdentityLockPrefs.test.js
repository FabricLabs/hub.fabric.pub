'use strict';

const assert = require('assert');
const {
  readFabricIdentityLockTimeoutMinutes,
  writeFabricIdentityLockTimeoutMinutes,
  lockTimeoutMinutesToMs,
  DEFAULT_LOCK_TIMEOUT_MINUTES
} = require('../functions/fabricIdentityLockPrefs');

describe('fabricIdentityLockPrefs', function () {
  it('defaults minutes and converts to ms', function () {
    assert.strictEqual(DEFAULT_LOCK_TIMEOUT_MINUTES, 30);
    assert.strictEqual(lockTimeoutMinutesToMs(30), 30 * 60 * 1000);
    assert.strictEqual(lockTimeoutMinutesToMs(0), 0);
  });

  it('reads without browser storage (node)', function () {
    const m = readFabricIdentityLockTimeoutMinutes();
    assert.strictEqual(typeof m, 'number');
    assert.ok(m >= 0);
  });

  it('write is a no-op without browser storage (node)', function () {
    assert.strictEqual(writeFabricIdentityLockTimeoutMinutes(60), false);
  });
});
