'use strict';

/**
 * The `shims/` compatibility modules are only pulled in by the browser bundle, so
 * a broken one surfaces as a Webpack failure (or a runtime crash in the SPA)
 * rather than a test failure. `noble-secp256k1.js` sat pointing at a removed
 * `noble-secp256k1-raw` Webpack alias and threw MODULE_NOT_FOUND on every load.
 * Require each shim here so that class of rot fails the suite instead.
 */

const assert = require('assert');

describe('shims export surface', function () {
  it('noble-secp256k1 resolves through the @noble/curves exports map', function () {
    const shim = require('../shims/noble-secp256k1');
    assert.strictEqual(typeof shim.schnorr.sign, 'function');
    assert.strictEqual(typeof shim.schnorr.verify, 'function');
    assert.ok(shim.secp256k1);
    assert.ok(shim.secp256k1_hasher);
  });

  it('noble-nist exposes the NIST curves', function () {
    const shim = require('../shims/noble-nist');
    for (const name of ['p256', 'p384', 'p521']) {
      assert.ok(shim[name], `${name} missing`);
    }
  });

  it('noble-utils loads', function () {
    assert.ok(require('../shims/noble-utils'));
  });
});
