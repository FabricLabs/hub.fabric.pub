'use strict';

/**
 * @fileoverview {@link module:functions/hubContractsClient} for this Hub's own
 * pages: the operator reads with the admin token; anyone else reads as their
 * Passport session (a peer session has Passport sign each request).
 */

const { createHubContractsClient } = require('./hubContractsClient');
const { sessionFetch } = require('./passportSiteLogin');

/**
 * @param {string} [adminToken]
 * @returns {Object}
 */
function browserContractsClient (adminToken) {
  const win = typeof window !== 'undefined' ? window : null;
  const token = adminToken ? String(adminToken).trim() : '';
  return createHubContractsClient({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    fetch: token || !win ? (win && win.fetch ? win.fetch.bind(win) : undefined) : sessionFetch(win)
  });
}

module.exports = { browserContractsClient };
