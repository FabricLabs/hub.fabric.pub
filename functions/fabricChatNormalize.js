'use strict';

/**
 * Re-export chat normalize from `@fabric/http`.
 * Local copy retained only as a fallback when published http lags.
 */
try {
  module.exports = require('@fabric/http/functions/fabricChatNormalize');
} catch (_) {
  module.exports = require('./fabricChatNormalize.local');
}
