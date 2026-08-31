'use strict';

// Compatibility shim for consumers importing secp256k1 from this package.
// Resolves through the `@noble/curves` package `exports` map rather than the
// removed `noble-secp256k1-raw` Webpack alias, so it survives npm hoisting when
// `@fabric/hub` is installed as a dependency (same pattern as `noble-nist.js`).

const { schnorr, secp256k1, secp256k1_hasher: hasher } = require('@noble/curves/secp256k1.js');

module.exports = { schnorr, secp256k1, secp256k1_hasher: hasher };
