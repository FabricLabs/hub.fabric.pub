'use strict';

/**
 * Hub sidechain document helpers (distributed execution — not a Fabric type).
 * Prefer `@fabric/core/functions/sidechainState` when linked; fall back to vendored copy.
 *
 * @see docs/BEACON_SIDECHAIN_DESIGN_AND_ROADMAP.md
 * @see @fabric/core docs/DISTRIBUTED_EXECUTION.md
 */

let sidechainState;
try {
  sidechainState = require('@fabric/core/functions/sidechainState');
} catch (_) {
  sidechainState = require('./fabricStatechain');
}

module.exports = sidechainState;
