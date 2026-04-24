'use strict';

/**
 * JSON-RPC -32601 / older hubs: avoid blaming Bitcoin or transport when the method is missing.
 * @param {unknown} err
 * @param {string} [transportHint]
 * @returns {string}
 */
function describeHubRpcFailure (err, transportHint) {
  const msg = String(err || 'Request failed.');
  if (/method not found/i.test(msg)) {
    return `${msg} Restart the Hub (or run the latest \`services/hub.js\`) so JSON-RPC includes this method.`;
  }
  const hint = transportHint != null ? String(transportHint).trim() : '';
  return hint ? `${msg} ${hint}` : msg;
}

module.exports = { describeHubRpcFailure };
