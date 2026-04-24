'use strict';

const assert = require('assert');
const { isHttpSharedModeEnabled } = require('../functions/httpSharedMode');

describe('httpSharedMode', () => {
  it('treats common truthy persisted shapes as shared', () => {
    assert.strictEqual(isHttpSharedModeEnabled(true), true);
    assert.strictEqual(isHttpSharedModeEnabled(1), true);
    assert.strictEqual(isHttpSharedModeEnabled('true'), true);
    assert.strictEqual(isHttpSharedModeEnabled('1'), true);
    assert.strictEqual(isHttpSharedModeEnabled(' YES '), true);
  });

  it('treats falsey and unknown as not shared', () => {
    assert.strictEqual(isHttpSharedModeEnabled(false), false);
    assert.strictEqual(isHttpSharedModeEnabled(0), false);
    assert.strictEqual(isHttpSharedModeEnabled('false'), false);
    assert.strictEqual(isHttpSharedModeEnabled(undefined), false);
    assert.strictEqual(isHttpSharedModeEnabled(null), false);
  });
});
