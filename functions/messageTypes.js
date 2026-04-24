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

/** @deprecated Prefer {@link DELEGATION_SIGNATURE_REQUEST}. Old client localStorage rows. */
const LEGACY_DELEGATION_SIGN_REQUEST = 'DELEGATION_SIGN_REQUEST';

const DELEGATION_SIGNATURE_REQUEST = 'DELEGATION_SIGNATURE_REQUEST';
const DELEGATION_SIGNATURE_RESOLUTION = 'DELEGATION_SIGNATURE_RESOLUTION';

/** GenericMessage / activity envelope: document delivery reward offer (sidechain + L1 demo). */
const DOCUMENT_OFFER = 'DOCUMENT_OFFER';

const {
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE
} = require('./federationContractInvite');

/**
 * Whether `m` is a delegation-signing activity row (pending UI / notifications).
 * Accepts the legacy alias written before the name was aligned with the Fabric log.
 * @param {{ type?: string }|null|undefined} m
 */
function isDelegationSignatureRequestActivity (m) {
  if (!m || typeof m !== 'object') return false;
  const t = m.type;
  return t === DELEGATION_SIGNATURE_REQUEST || t === LEGACY_DELEGATION_SIGN_REQUEST;
}

module.exports = {
  LEGACY_DELEGATION_SIGN_REQUEST,
  DELEGATION_SIGNATURE_REQUEST,
  DELEGATION_SIGNATURE_RESOLUTION,
  DOCUMENT_OFFER,
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE,
  isDelegationSignatureRequestActivity
};
