'use strict';

const assert = require('assert');
const {
  isAllowedFabricHub,
  assertAllowedFabricHub
} = require('../functions/fabricHubAllowlist');

describe('fabricHubAllowlist (hub re-export)', function () {
  it('allows network hubs and rejects phishing', function () {
    assert.strictEqual(isAllowedFabricHub('https://hub.fabric.pub'), true);
    assert.strictEqual(isAllowedFabricHub('https://evil.example'), false);
    const bad = assertAllowedFabricHub('https://evil.example');
    assert.strictEqual(bad.ok, false);
  });
});
