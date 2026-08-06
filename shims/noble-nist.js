'use strict';

// Shim to provide @noble/curves/nist.js-style exports for noble-curves v1.x
// by re-exporting the individual NIST curves.

const { p256 } = require('../node_modules/@noble/curves/p256.js');
const { p384 } = require('../node_modules/@noble/curves/p384.js');
const { p521 } = require('../node_modules/@noble/curves/p521.js');

module.exports = { p256, p384, p521 };
