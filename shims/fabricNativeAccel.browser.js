'use strict';

/**
 * Browser stub for @fabric/core/functions/fabricNativeAccel.
 * The real module uses require(addonPath) for fabric.node; webpack cannot parse that.
 * Native acceleration is Node-only; Hub/browser always uses @noble/hashes.
 */

const { sha256 } = require('@noble/hashes/sha2.js');

const SUPPORTED_ADDON_EXPORTS = Object.freeze(['doubleSha256']);

function status () {
  return {
    available: false,
    methods: [],
    nativeDoubleSha256OptIn: false,
    path: null,
    error: undefined
  };
}

function doubleSha256Buffer (buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('doubleSha256Buffer expects Buffer');
  const first = sha256(new Uint8Array(buf));
  const second = sha256(first);
  return Buffer.from(second);
}

function doubleSha256Hex (buf) {
  return doubleSha256Buffer(buf).toString('hex');
}

function isNativeBech32Callable () {
  return false;
}

module.exports = {
  SUPPORTED_ADDON_EXPORTS,
  status,
  doubleSha256Buffer,
  doubleSha256Hex,
  isNativeBech32Callable
};
