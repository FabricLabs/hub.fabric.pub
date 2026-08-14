'use strict';

// Shim for @noble/curves/secp256k1. Uses internal alias to load the raw CJS
// file so Webpack always wraps it with (module, exports, __webpack_require__).
// Direct require() of the .js path can be mis-parsed in production builds.
module.exports = require('noble-secp256k1-raw');
