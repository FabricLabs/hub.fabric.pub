'use strict';

const assert = require('assert');
const {
  shouldStartManagedLightning,
  lightningdOnPath
} = require('../functions/hubLightningGate');

describe('Hub Lightning gate', function () {
  it('does not start managed CLN from datadir-only lightning settings', function () {
    assert.strictEqual(shouldStartManagedLightning({ lightning: { datadir: './stores/lightning/hub' } }), false);
    assert.strictEqual(shouldStartManagedLightning({ lightning: { stub: true, managed: true } }), false);
    assert.strictEqual(shouldStartManagedLightning({ lightning: { managed: false } }), false);
  });

  it('starts managed CLN only when managed or enable is true', function () {
    assert.strictEqual(shouldStartManagedLightning({ lightning: { managed: true } }), true);
    assert.strictEqual(shouldStartManagedLightning({ lightning: { enable: true } }), true);
  });

  it('lightningdOnPath returns a boolean', function () {
    assert.strictEqual(typeof lightningdOnPath(), 'boolean');
  });
});
