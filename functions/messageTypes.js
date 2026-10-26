'use strict';

/**
 * Canonical string names for Hub/Fabric **domain** message kinds (JSON `type` fields,
 * Fabric log `entry.type`, and matching activity rows in `globalState.messages`).
 *
 * - **Wire outer** opcodes (`Message.fromVector([name, …])`) stay in
 *   {@link ./fabricMessageRegistry.js} — mixed `PascalCase` (e.g. `ChatMessage`) and
 *   `SCREAMING_SNAKE` where Fabric registered them that way (e.g. `P2P_RELAY`).
 * - **ActivityStreams-style** hub activities from `recordActivity` often use verb
 *   types (`Send`, `Receive`, `Announce`, …) — see `services/hub.js`.
 * - **Domain events** in the activity feed and Fabric collections use
 *   `SCREAMING_SNAKE` for protocol-ish names (`P2P_CHAT_MESSAGE`, …).
 */

/** GenericMessage / activity envelope: document delivery reward offer (sidechain + L1 demo). */
const DOCUMENT_OFFER = 'DOCUMENT_OFFER';

const {
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE
} = require('./federationContractInvite');

let appNs = null;
try {
  appNs = require('@fabric/core/functions/applicationNamespaces');
} catch (_) {
  appNs = null;
}

/** Fabric log types for application-namespace events (see APPLICATION_NAMESPACES). */
const CONTRACT_PUBLISH_LOG = (appNs && appNs.LOG_TYPES && appNs.LOG_TYPES.ContractPublish) || 'ContractPublish';
const CONTRACT_MESSAGE_LOG = (appNs && appNs.LOG_TYPES && appNs.LOG_TYPES.ContractMessage) || 'ContractMessage';

/** Beacon Federation epoch signature collection (ADR-001; GenericMessage body `type`). */
const FEDERATION_SIGN_REQUEST = (appNs && appNs.ACTIVITY_TYPES && appNs.ACTIVITY_TYPES.FederationSignRequest) || 'FederationSignRequest';
const FEDERATION_SIGN_RESPONSE = (appNs && appNs.ACTIVITY_TYPES && appNs.ACTIVITY_TYPES.FederationSignResponse) || 'FederationSignResponse';

module.exports = {
  DOCUMENT_OFFER,
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE,
  CONTRACT_PUBLISH_LOG,
  CONTRACT_MESSAGE_LOG,
  FEDERATION_SIGN_REQUEST,
  FEDERATION_SIGN_RESPONSE
};
