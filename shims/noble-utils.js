'use strict';

// Shim to provide @noble/curves/utils.js for noble-curves v1.x by delegating
// to the local @noble/hashes/utils implementation for secure randomBytes.

const { randomBytes } = require('../node_modules/@noble/hashes/utils.js');

module.exports = {
  randomBytes
};
