'use strict';

/**
 * CONTRACT_PROPOSAL + PSBT: re-exports `@fabric/core/functions/contractProposal` when available,
 * same pattern as `publishedDocumentEnvelope.js`.
 */

let impl;
try {
  impl = require('../../fabric/functions/contractProposal.js');
} catch (_) {
  impl = require('@fabric/core/functions/contractProposal');
}

module.exports = impl;
