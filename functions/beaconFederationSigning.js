'use strict';

/**
 * Beacon Federation signature rounds — `@fabric/core` only.
 * Thin Hub wrapper: default `policy` so omitted callers do not TypeError.
 * @see @fabric/core/functions/beaconFederationSigning
 */

const core = require('@fabric/core/functions/beaconFederationSigning');

/**
 * @param {object} epochPayload
 * @param {{ validators?: string[], threshold?: number }} [policy]
 * @param {{ version?: number, signatures?: object }|null} [initialWitness]
 * @returns {object}
 */
function createRound (epochPayload, policy = {}, initialWitness = null) {
  return core.createRound(epochPayload, policy || {}, initialWitness);
}

module.exports = Object.assign({}, core, { createRound });
