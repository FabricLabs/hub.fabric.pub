'use strict';

/**
 * Device-link HTTP — re-export `@fabric/http` mount + message helpers.
 */
const deviceLinkHttp = require('@fabric/http/functions/fabricDeviceLinkHttp');

module.exports = {
  DEVICE_LINK_PREFIX: deviceLinkHttp.DEVICE_LINK_PREFIX,
  SESSION_TTL_MS: deviceLinkHttp.SESSION_TTL_MS,
  MAX_SESSIONS_PER_ORIGIN: deviceLinkHttp.MAX_SESSIONS_PER_ORIGIN,
  buildDeviceLinkMessage: deviceLinkHttp.buildDeviceLinkMessage,
  buildDeviceLinkOfferMessage: deviceLinkHttp.buildDeviceLinkOfferMessage,
  parseDeviceLinkMessage: deviceLinkHttp.parseDeviceLinkMessage,
  verifyIdentitySchnorr: deviceLinkHttp.verifyIdentitySchnorr,
  mountFabricDeviceLinkHttp: deviceLinkHttp.mountFabricDeviceLinkHttp,
  randomNonce: deviceLinkHttp.randomNonce,
  randomSessionId: deviceLinkHttp.randomSessionId,
  offerReplayKey: deviceLinkHttp.offerReplayKey,
  evictDeviceLinkOriginOverflow: deviceLinkHttp.evictDeviceLinkOriginOverflow,
  isCompanionWebViewOrigin: deviceLinkHttp.isCompanionWebViewOrigin,
  isExtensionOrigin: deviceLinkHttp.isExtensionOrigin,
  isThinClientOrigin: deviceLinkHttp.isThinClientOrigin,
  clientMayAccessDeviceLink: deviceLinkHttp.clientMayAccessDeviceLink
};
