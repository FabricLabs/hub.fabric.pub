'use strict';

/**
 * Thin re-export of `@fabric/core` authority Taproot vault / spend ladder.
 *
 * Default: k-of-n validators now + softer tier after ~144 CSV
 * (`taproot-authority-ladder-v1`). Opt into pre-ladder single leaf with
 * `{ legacySingleLeaf: true }`. Optional hashlock / arbitrary script leaves
 * via `composeTaprootTree` / `hashlock` on policy.
 *
 * @see @fabric/core/functions/contractTaproot
 * @see @fabric/core/functions/contractSpend
 */

const tap = require('@fabric/core/functions/contractTaproot');

/** Default CSV degradation window / deposit maturity (blocks). */
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
  buildContractTaproot: tap.buildContractTaproot,
  composeTaprootTree: tap.composeTaprootTree,
  compileLeaves: tap.compileLeaves,
  scriptTreeFromLeaves: tap.scriptTreeFromLeaves,
  buildHashlockLeaf: tap.buildHashlockLeaf,
  buildSpendLeaf: tap.buildSpendLeaf,
  buildScriptLeaf: tap.buildScriptLeaf,
  prepareHashlockWithdrawalPsbt: tap.prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt: tap.finalizeHashlockPsbt,
  prepareLeafPsbt: tap.prepareLeafPsbt,
  toAddress: tap.toAddress,
  synthesizeDefaultLadder: tap.synthesizeDefaultLadder,
  normalizeContractSpendPolicy: tap.normalizeContractSpendPolicy,
  selectActiveTiers: tap.selectActiveTiers,
  selectMigrateTarget: tap.selectMigrateTarget,
  prepareTierWithdrawalPsbt: tap.prepareTierWithdrawalPsbt,
  prepareDecayMigrationPsbt: tap.prepareDecayMigrationPsbt,
  policyAfterDecay: tap.policyAfterDecay
};
