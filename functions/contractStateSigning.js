'use strict';

/**
 * Thin re-export of `@fabric/core` contract-namespace tip signing.
 *
 * Hub Beacon epochs use `beaconFederationSigning`; per-contract Statechain tips
 * (application Groups, accepted CONTRACT_PUBLISH namespaces) use this module.
 * If the tip kind or canonical string changes upstream, update Hub RPC/docs
 * (sidechain / distributed execution) in the same change.
 *
 * @see @fabric/core/functions/contractStateSigning
 * @see docs/SIDECHAIN_AND_EXECUTION_INDEX.md
 */

module.exports = require('@fabric/core/functions/contractStateSigning');
