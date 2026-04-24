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

/** Satoshis per 1 BTC (BIP-176 / fixed-point sats in this Hub). */
const SATS_PER_BTC = 100_000_000;

/** ~21M BTC cap (Joinmarket / UI sanity clamps). */
const BITCOIN_MAX_SUPPLY_BTC = 21_000_000;

/**
 * Epsilon for “whole sats” vs sub-sat remainder in display helpers.
 * @see functions/formatSats.js
 */
const SUB_SATOSHI_EPSILON = 0.000000001;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** FNV-1a 32-bit (e.g. stable graph node ids) — @see functions/peerTopologyDot.js */
const FNV1A_32_OFFSET = 2_166_136_261;
const FNV1A_32_PRIME = 16_777_619;

/** Mulberry32 PRNG — @see functions/playnetMarketSimulation.js */
const MULBERRY32_A = 0x6d2b79f5;
/** 2^32, maps unsigned 32-bit hash to [0, 1) */
const UINT32_MAX_PLUS_ONE = 2 ** 32;

/** Difficulty / large-number display: use exponential at or above this value. */
const UI_NUMBER_LOG_EXP_THRESHOLD = 10 ** 12;
/** Prefer compact grouping with limited fraction digits at or above this value. */
const UI_NUMBER_COMPACT_FRACTION_THRESHOLD = 10 ** 6;

/** Browser localStorage key for Joinmarket pool size tiers (BTC). */
const JOINMARKET_POOL_SIZES_STORAGE_KEY = 'fabric.joinmarket.poolSizesBtc';

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
  featureFlag,
  SATS_PER_BTC,
  BITCOIN_MAX_SUPPLY_BTC,
  SUB_SATOSHI_EPSILON,
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_DAY,
  FNV1A_32_OFFSET,
  FNV1A_32_PRIME,
  MULBERRY32_A,
  UINT32_MAX_PLUS_ONE,
  UI_NUMBER_LOG_EXP_THRESHOLD,
  UI_NUMBER_COMPACT_FRACTION_THRESHOLD,
  JOINMARKET_POOL_SIZES_STORAGE_KEY
};
