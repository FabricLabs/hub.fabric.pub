'use strict';

/**
 * Hub desktop / site-login HTTP — re-exports `@fabric/http` with Hub hooks
 * (delegation registry + SPA shell). Prefer importing from `@fabric/http`
 * for new apps; use this module when mounting on a Hub instance.
 */

const { getDelegationSessionById } = require('./fabricDelegation');
const { serveSpaShellIfHtmlNavigation } = require('./httpSpaShell');
const siteLoginHttp = require('@fabric/http/functions/fabricSiteLoginHttp');

function bindHubHooks (hub) {
  if (!hub || typeof hub !== 'object') return hub;
  if (typeof hub.getDelegationSessionById !== 'function') {
    hub.getDelegationSessionById = (sessionId) => getDelegationSessionById(hub, sessionId);
  }
  if (typeof hub.serveSpaShellIfHtmlNavigation !== 'function') {
    hub.serveSpaShellIfHtmlNavigation = (h, req, res) => serveSpaShellIfHtmlNavigation(h || hub, req, res);
  }
  if (hub.allowHubSelfSign === undefined) hub.allowHubSelfSign = true;
  return hub;
}

function handleSessionCreate (hub, req, res) {
  return siteLoginHttp.handleSessionCreate(bindHubHooks(hub), req, res);
}

function handleSessionGet (hub, req, res) {
  return siteLoginHttp.handleSessionGet(bindHubHooks(hub), req, res);
}

function handleDesktopSign (hub, req, res) {
  return siteLoginHttp.handleDesktopSign(bindHubHooks(hub), req, res);
}

function mountFabricDesktopAuthHttp (hub) {
  return siteLoginHttp.mountFabricDesktopAuthHttp(bindHubHooks(hub));
}

module.exports = {
  DESKTOP_LOGIN_PREFIX: siteLoginHttp.DESKTOP_LOGIN_PREFIX,
  SESSION_TTL_MS: siteLoginHttp.SESSION_TTL_MS,
  buildLoginMessage: siteLoginHttp.buildLoginMessage,
  randomNonce: siteLoginHttp.randomNonce,
  randomSessionId: siteLoginHttp.randomSessionId,
  originsMatchForDesktopSession: siteLoginHttp.originsMatchForDesktopSession,
  hasClientSignatureBody: siteLoginHttp.hasClientSignatureBody,
  handleSessionCreate,
  handleSessionGet,
  handleDesktopSign,
  mountFabricDesktopAuthHttp
};
