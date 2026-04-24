'use strict';

/**
 * Operator-facing constants for Beacon / Beacon Federation UX.
 * On-chain vault address + UTXO scan: GET /services/distributed/vault and …/vault/utxos.
 * Cooperative signing remains off-hub (PSBT); Fabric epochs / sidechain enforcement are separate.
 */
module.exports = {
  /** Regtest hub default from settings.beacon.interval */
  REGTEST_EPOCH_INTERVAL_MS: Number(process.env.FABRIC_BEACON_INTERVAL_MS || 600000),
  REGTEST_EPOCH_INTERVAL_MINUTES: Math.round(Number(process.env.FABRIC_BEACON_INTERVAL_MS || 600000) / 60000) || 10,
  NON_REGTEST_CADENCE_LABEL: 'each new Bitcoin block',
  /** Default policy: L1 deposits to the federation Taproot remain unspendable for this many main-chain confirmations. */
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS: 144
};
