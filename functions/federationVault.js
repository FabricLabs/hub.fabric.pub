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
 * @see @fabric/core/types/policy
 * @see @fabric/core/types/contract
 */

const Policy = require('@fabric/core/types/policy');

/** Default CSV degradation window / deposit maturity (blocks). */
const DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS = Policy.DEFAULT_CSV_BLOCKS;

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
  const built = Policy.buildFederationVaultFromPolicy(opts);
  if (built.depositMaturityBlocks == null) {
    built.depositMaturityBlocks = DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS;
  }
  return built;
}

module.exports = {
  TAPROOT_INTERNAL_NUMS: Policy.TAPROOT_INTERNAL_NUMS,
  DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS,
  normalizeFederationInternalKeyMode,
  resolveFederationInternalKeyMode,
  networkForFabricName: Policy.networkForFabricName,
  buildFederationVaultFromPolicy,
  prepareVaultWithdrawalPsbt: Policy.prepareVaultWithdrawalPsbt,
  buildVaultControlBlock: Policy.buildVaultControlBlock,
  composeTaprootTree: Policy.composeTaprootTree,
  compileLeaves: Policy.compileLeaves,
  scriptTreeFromLeaves: Policy.scriptTreeFromLeaves,
  buildHashlockLeaf: Policy.buildHashlockLeaf,
  buildSpendLeaf: Policy.buildSpendLeaf,
  buildScriptLeaf: Policy.buildScriptLeaf,
  prepareHashlockWithdrawalPsbt: Policy.prepareHashlockWithdrawalPsbt,
  finalizeHashlockPsbt: Policy.finalizeHashlockPsbt,
  prepareLeafPsbt: Policy.prepareLeafPsbt,
  toAddress: Policy.toAddress,
  synthesizeDefaultLadder: Policy.synthesizeDefaultLadder,
  selectActiveTiers: Policy.selectActiveTiers,
  selectMigrateTarget: Policy.selectMigrateTarget,
  prepareTierWithdrawalPsbt: Policy.prepareTierWithdrawalPsbt,
  prepareDecayMigrationPsbt: Policy.prepareDecayMigrationPsbt
};
