'use strict';

// Fabric Constants
const {
  GENESIS_HASH,
  MAGIC_BYTES,
  VERSION_NUMBER,
  FIXTURE_SEED
} = require('@fabric/core/constants');

const ALLOWED_UPLOAD_TYPES = [];
const ENABLE_CONVERSATION_SIDEBAR = false;
const ENABLE_NETWORK = true;

/**
 * Feature flags. Override via env: FABRIC_FEATURE_<NAME>=0|1|true|false
 * @example FABRIC_FEATURE_BITCOIN=0 npm start
 */
function featureFlag (name, defaultValue = true) {
  const env = typeof process !== 'undefined' && process.env
    ? process.env[`FABRIC_FEATURE_${name}`]
    : undefined;
  if (env === undefined || env === '') return defaultValue;
  return env === '1' || env === 'true';
}

const FEATURE_FLAGS = {
  BITCOIN: featureFlag('BITCOIN', true),
  DOCUMENT_PURCHASE: featureFlag('DOCUMENT_PURCHASE', true),
  PAYJOIN: featureFlag('PAYJOIN', false),
  INVOICES: featureFlag('INVOICES', true),
  DISTRIBUTE: featureFlag('DISTRIBUTE', false),
  LIGHTNING: featureFlag('LIGHTNING', false),
  WEBRTC: featureFlag('WEBRTC', true)
};

module.exports = {
  AUTHORITY: 'hub.fabric.pub',
  GENESIS_HASH,
  MAGIC_BYTES,
  VERSION_NUMBER,
  FIXTURE_SEED,
  ALLOWED_UPLOAD_TYPES,
  ENABLE_CONVERSATION_SIDEBAR,
  ENABLE_NETWORK,
  FEATURE_FLAGS,
  featureFlag
};
