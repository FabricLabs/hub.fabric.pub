'use strict';

/**
 * Thin re-export — invite JSON parse/build lives in `@fabric/http`.
 * Keep JSON bridges out of `@fabric/core`; Hub and GoonCitizen share one shape.
 *
 * @see @fabric/http/functions/federationContractInvite
 */

module.exports = require('@fabric/http/functions/federationContractInvite');
