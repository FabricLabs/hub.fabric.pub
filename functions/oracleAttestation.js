'use strict';

/**
 * Re-export OracleAttestation helpers from `@fabric/http`.
 * Local copy retained only as a fallback when published http lags.
 */
try {
  module.exports = require('@fabric/http/functions/oracleAttestation');
} catch (_) {
  module.exports = require('./oracleAttestation.local');
}
