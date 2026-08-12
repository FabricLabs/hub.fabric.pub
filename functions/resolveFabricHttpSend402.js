'use strict';

/**
 * Loads `{ sendPaymentRequired402Response }` from `@fabric/http` when the export exists.
 * Prefer the package `exports` entry (not `package.json` resolve — blocked by http `exports`).
 */
try {
  // Package-controlled path via `@fabric/http` exports map.
  module.exports = require('@fabric/http/functions/sendPaymentRequired402Response');
} catch (_) {
  module.exports = {
    /** @deprecated Upgrade @fabric/http to a build that ships functions/sendPaymentRequired402Response.js */
    sendPaymentRequired402Response: async () => {
      throw new Error(
        '[hub] Missing @fabric/http functions/sendPaymentRequired402Response.js — upgrade @fabric/http (RC1+) or link the monorepo package.'
      );
    }
  };
}
