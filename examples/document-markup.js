'use strict';

/**
 * A list price from a remote cost and the default markup policy.
 * Run: node examples/document-markup.js
 *
 * Default markup is 1000 bps (10 percent). A price above zero is at least
 * the smallest mainnet HTLC. A zero cost stays free.
 */

const { HTLC_MINIMUM_SATS } = require('@fabric/core/constants');
const { normalizeMarketPolicy, markupListPrice } = require('../functions/documentInventoryMarket');

function fail (message) {
  console.error('[EXAMPLES:DOCUMENT_MARKUP]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function main () {
  const policy = normalizeMarketPolicy({}, {});
  if (policy.markupBps !== 1000) fail('the default markup should be 1000 bps');

  const cost = 1000;
  const price = markupListPrice(cost, policy);
  const marked = Math.ceil((cost * (10000 + policy.markupBps)) / 10000) + policy.markupSats;
  const expected = Math.max(marked, policy.minPriceSats, HTLC_MINIMUM_SATS);
  if (price !== expected) fail('list price should be the marked cost, and at least the HTLC minimum');
  if (markupListPrice(0, policy) !== 0) fail('a free document stays free');

  console.log('[EXAMPLES:DOCUMENT_MARKUP]', 'cost', cost);
  console.log('[EXAMPLES:DOCUMENT_MARKUP]', 'bps', policy.markupBps);
  console.log('[EXAMPLES:DOCUMENT_MARKUP]', 'price', price);
}

main();
