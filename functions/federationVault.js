'use strict';

/**
 * Thin re-export of `@fabric/core` contract Taproot vault / failover ladder.
 *
 * Legacy single-leaf Hub vault APIs remain address-stable via
 * `buildFederationVaultFromPolicy` (no failover flag).
 * Full ladders: `buildContractTaproot` / `synthesizeDefaultLadder`.
 *
 * @see @fabric/core/functions/contractTaproot
 * @see docs/UPSTREAM_MONOREPO.md
 */

const tap = require('@fabric/core/functions/contractTaproot');

/** Regtest-oriented deposit maturity default (Hub UX). */
const DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS = tap.DEFAULT_CSV_BLOCKS;

function buildFederationVaultFromPolicy (opts) {
  const built = tap.buildFederationVaultFromPolicy(opts);
  if (built.depositMaturityBlocks == null) {
    built.depositMaturityBlocks = DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS;
  }
  return built;
}

module.exports = {
  TAPROOT_INTERNAL_NUMS: tap.TAPROOT_INTERNAL_NUMS,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS,
  networkForFabricName: tap.networkForFabricName,
  buildFederationVaultFromPolicy,
  prepareVaultWithdrawalPsbt: tap.prepareVaultWithdrawalPsbt,
  buildVaultControlBlock: tap.buildVaultControlBlock,
  // Ladder surface for Beacon / Groups
  buildContractTaproot: tap.buildContractTaproot,
  toAddress: tap.toAddress,
  synthesizeDefaultLadder: tap.synthesizeDefaultLadder,
  normalizeContractSpendPolicy: tap.normalizeContractSpendPolicy,
  selectActiveTiers: tap.selectActiveTiers,
  selectMigrateTarget: tap.selectMigrateTarget,
  prepareTierWithdrawalPsbt: tap.prepareTierWithdrawalPsbt,
  prepareDecayMigrationPsbt: tap.prepareDecayMigrationPsbt,
  policyAfterDecay: tap.policyAfterDecay
};
