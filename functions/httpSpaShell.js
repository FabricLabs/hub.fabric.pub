'use strict';

/**
 * Delegates to {@link import('@fabric/http/types/server') FabricHTTPServer#serveSpaShellIfHtmlNavigation}.
 * @deprecated Prefer `hub.http.serveSpaShellIfHtmlNavigation(req, res)` at call sites.
 */
const { acceptFirstHtmlNavigation } = require('@fabric/http/acceptNegotiation');

function serveSpaShellIfHtmlNavigation (hub, req, res) {
  if (!hub || !hub.http || typeof hub.http.serveSpaShellIfHtmlNavigation !== 'function') return false;
  return hub.http.serveSpaShellIfHtmlNavigation(req, res);
}

module.exports = {
  acceptFirstHtmlNavigation,
  serveSpaShellIfHtmlNavigation
};
