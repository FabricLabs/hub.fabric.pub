'use strict';

/**
 * Re-export pubkey helpers from `@fabric/http`.
 */
try {
  module.exports = require('@fabric/http/functions/fabricPubkey');
} catch (_) {
  module.exports = require('./fabricPubkey.local');
}
