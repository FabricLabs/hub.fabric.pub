'use strict';

/**
 * Thin re-export of `@fabric/core` authority Taproot vault / spend ladder.
 *
 * Default: k-of-n validators now + softer tier after ~144 CSV
 * (`taproot-authority-ladder-v1`). Opt into pre-ladder single leaf with
 * `{ legacySingleLeaf: true }`. Optional hashlock / arbitrary script leaves
 * via `composeTaprootTree` / `hashlock` on policy.
 *
 * **Internal key:** `@fabric/core` default for n≥2 is MuSig2 (new address).
 * Hub operators with historical NUMS UTXOs MUST pass `internalKeyMode: 'nums'`
 * (this module defaults Hub to `nums` via {@link resolveFederationInternalKeyMode}).
 * Rebuilds do not migrate coins. Set `FABRIC_FEDERATION_INTERNAL_KEY_MODE=musig2`
 * only after sweeping to the new address.
 *
 * @see @fabric/core/functions/contractTaproot
 * @see @fabric/core/functions/contractSpend
 */

const tap = require('@fabric/core/functions/contractTaproot');

/** Default CSV degradation window / deposit maturity (blocks). */
const DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS = tap.DEFAULT_CSV_BLOCKS;

/**
 * Hub federation Taproot internal key. Unset / unknown → `nums` (historical vault).
 * @param {*} raw
 * @returns {string} `nums` | `musig2`
 */
function normalizeFederationInternalKeyMode (raw) {
  const m = String(raw == null ? 'nums' : raw).trim().toLowerCase();
  if (m === 'musig2' || m === 'auto') return 'musig2';
  return 'nums';
}

/**
 * Resolve Hub vault / Beacon overlay mode (env wins, then settings, then nums).
 * @param {object} [settings]
 * @param {object} [env]
 * @returns {string} `nums` | `musig2`
 */
function resolveFederationInternalKeyMode (settings = {}, env = process.env) {
  const fromEnv = env && env.FABRIC_FEDERATION_INTERNAL_KEY_MODE;
  const fromSettings = (settings.federation && settings.federation.internalKeyMode)
    || (settings.distributed && settings.distributed.internalKeyMode);
  return normalizeFederationInternalKeyMode(fromEnv || fromSettings || 'nums');
}

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
  normalizeFederationInternalKeyMode,
  resolveFederationInternalKeyMode,
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
