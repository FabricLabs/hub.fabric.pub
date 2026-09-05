'use strict';

// Compatibility shim for consumers importing NIST curves from this package.
// Resolves through the `@noble/curves` package `exports` map rather than a
// hardcoded `../node_modules` path, so it survives npm hoisting when
// `@fabric/hub` is installed as a dependency.

const { p256, p384, p521 } = require('@noble/curves/nist.js');

module.exports = { p256, p384, p521 };
