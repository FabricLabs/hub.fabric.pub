'use strict';

const path = require('path');

/**
 * Loads `{ sendPaymentRequired402Response }` from `node_modules/@fabric/http` when the file exists.
 */
try {
  const root = path.dirname(require.resolve('@fabric/http/package.json'));
  module.exports = require(path.join(root, 'functions/sendPaymentRequired402Response.js'));
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
