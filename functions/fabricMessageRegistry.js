'use strict';

/**
 * Canonical catalog of Fabric **outer** wire types (`Message.type` ↔ numeric opcode).
 *
 * - **Source of truth for opcodes** remains `@fabric/core` (`constants.js` + `types/message.js` `Message.types`).
 * - **`GenericMessage` / `JSONBlob`** are *transitional*: UTF-8 JSON in the message body until a type
 *   earns a dedicated opcode and a structured (eventually fully binary) payload layout.
 *
 * @see MESSAGE_TRANSPORT.md
 * @see PAYMENTS_PROTOCOL.md
 * @see ./messageTypes.js — shared constants for domain `type` strings (incl. delegation activity + Fabric log alignment).
 */

const Stability = Object.freeze({
  stable: 'stable',
  transitional: 'transitional',
  planned: 'planned'
});

/** How the message `data` / body is encoded today. */
const PayloadEncoding = Object.freeze({
  utf8Json: 'utf8-json',
  utf8Text: 'utf8-text',
  structuredBinary: 'structured-binary'
});

/**
 * Suggested IANA-style block for **future** first-class hub/bridge opcodes in `@fabric/core`
 * (not allocated until reviewed). Do not emit on the wire until registered in `Message.types`.
 */
const SUGGESTED_HUB_OPCODE_BLOCK_START = 16200;
const SUGGESTED_HUB_OPCODE_BLOCK_END = 16299;

/**
 * Outer AMP types currently registered in Fabric `Message` (string name → opcode decimal).
 * Opcodes MUST stay in sync with `node_modules/@fabric/core/types/message.js` and `constants.js`.
 */
const OUTER_WIRE_TYPES = [
  { name: 'JSONCall', opcodeDec: 16000, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Hub/browser JSON-RPC; body { method, params }.' },
  { name: 'JSONPatch', opcodeDec: 1024, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'State patch to clients.' },
  { name: 'ChatMessage', opcodeDec: 103, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Chat broadcast (0x67); legacy re-signed relay path.' },
  { name: 'P2P_CHAT_MESSAGE', opcodeDec: 104, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'First-class peer chat frame (0x68). Relayed with per-hop re-sign for key-pinning continuity; author carried in body.' },
  { name: 'Ping', opcodeDec: 18, stability: Stability.stable, encoding: PayloadEncoding.utf8Text, notes: 'P2P_PING keepalive.' },
  { name: 'Pong', opcodeDec: 19, stability: Stability.stable, encoding: PayloadEncoding.utf8Text, notes: 'P2P_PONG response.' },
  { name: 'P2P_RELAY', opcodeDec: 67, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Peer mesh: body = raw inner Message bytes. Hub↔browser WS may still use JSON { original, originalType, hops }.' },
  { name: 'P2P_MESSAGE_RECEIPT', opcodeDec: 68, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Server ack after handling inbound frame.' },
  { name: 'JSONBlob', opcodeDec: 15104, stability: Stability.transitional, encoding: PayloadEncoding.utf8Json, notes: 'GENERIC+1; JSON payload, prefer named type when available.' },
  { name: 'GenericMessage', opcodeDec: 15103, stability: Stability.transitional, encoding: PayloadEncoding.utf8Json, notes: 'Registered in @fabric/core as GENERIC_MESSAGE (15103); prefer dedicated opcodes when stable.' },
  { name: 'PeerMessage', opcodeDec: 49, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'P2P_BASE_MESSAGE; generic peer payload carrier.' },
  { name: 'DocumentPublish', opcodeDec: 998, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Document publish.' },
  { name: 'DocumentRequest', opcodeDec: 999, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Document request.' },
  { name: 'ContractProposal', opcodeDec: 138, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Batched messages + chain Merkle root + JSON Patch (+ optional PSBT); optional `contractId` namespace; see @fabric/core docs/CONTRACT_PROPOSAL.md.' },
  { name: 'CONTRACT_PUBLISH', opcodeDec: 95, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Publishes a contract definition; registers under a deterministic Actor id (contract namespace). Emits contract:publish (0x5f). Alias: P2P_CONTRACT_PUBLISH. See @fabric/core docs/APPLICATION_NAMESPACES.md.' },
  { name: 'CONTRACT_MESSAGE', opcodeDec: 96, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Namespaced contract event; body carries `contract: <id>`. Dispatch routes by namespace (contract:message). State ops apply only to locally registered contracts (0x60). Alias: P2P_CONTRACT_MESSAGE.' },
  // Encode aliases (same opcodes) — Message.fromVector accepts these names.
  { name: 'P2P_CONTRACT_PUBLISH', opcodeDec: 95, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Alias of CONTRACT_PUBLISH (0x5f).' },
  { name: 'P2P_CONTRACT_MESSAGE', opcodeDec: 96, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Alias of CONTRACT_MESSAGE (0x60).' },
  { name: 'P2P_CONTRACT_PROPOSAL', opcodeDec: 138, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Alias of ContractProposal / CONTRACT_PROPOSAL (0x8a).' }
];

/**
 * Shared CONTRACT_MESSAGE body `type` strings (application namespaces).
 * Prefer `@fabric/core/functions/applicationNamespaces` when the linked core
 * exports it; this list is kept in sync for Hub-only installs.
 */
const APPLICATION_CONTRACT_BODY_TYPES = [
  { type: 'FederationContractInvite', apps: ['hub', 'gooncitizen'], notes: 'Hub-shaped join / co-signer invite (v2 + proposedPolicy).' },
  { type: 'FederationContractInviteResponse', apps: ['hub', 'gooncitizen'], notes: 'Accept / reject invite.' },
  { type: 'MissionCreated', apps: ['gooncitizen'], notes: 'Network mission register upsert (GoonCitizen genesis).' },
  { type: 'MissionBroadcast', apps: ['gooncitizen'], notes: 'Network mission offer.' },
  { type: 'SCEventBatch', apps: ['gooncitizen'], notes: 'Log / event batch.' },
  { type: 'GroupChat', apps: ['gooncitizen'], notes: 'Group Federation channel chat.' },
  { type: 'GroupChange', apps: ['gooncitizen'], notes: 'Group membership / meta change.' },
  { type: 'GroupShare', apps: ['gooncitizen'], notes: 'Group-scoped share (e.g. mission offer).' }
];

/**
 * **Inner** domain payloads often carried today inside `GenericMessage` UTF-8 JSON (ActivityStreams-style `type` field).
 * These should graduate to **outer** `Message.type` values (+ opcode in `Message.types`) with versioned binary layouts.
 */
const INNER_DOMAIN_PENDING_PROMOTION = [
  { innerType: 'INVENTORY_REQUEST', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned },
  { innerType: 'INVENTORY_RESPONSE', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned },
  { innerType: 'FABRIC_DOCUMENT_OFFER', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned, notes: 'Canonical document-offer request; aliases INVENTORY_REQUEST on wire (@fabric/core).' },
  { innerType: 'FABRIC_DOCUMENT_OFFER_RESPONSE', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned, notes: 'Canonical document-offer reply; aliases INVENTORY_RESPONSE on wire (@fabric/core).' },
  { innerType: 'P2P_FILE_SEND', typicalCarrier: 'Peer P2P / GenericMessage fanout', stability: Stability.stable },
  { innerType: 'P2P_PEER_GOSSIP', typicalCarrier: 'GenericMessage / P2P_RELAY', stability: Stability.stable },
  { innerType: 'P2P_PEERING_OFFER', typicalCarrier: 'GenericMessage / P2P_RELAY', stability: Stability.stable },
  { innerType: 'Tombstone', typicalCarrier: 'GenericMessage (hub broadcast) + Fabric log type', stability: Stability.stable, notes: 'Hub `EmitTombstone`; object carries activityMessageId and/or documentId.' },
  { innerType: 'WebRTCSignal', typicalCarrier: 'JSONCall result payload', stability: Stability.transitional, notes: 'Could become dedicated outer type for fanout.' },
  { innerType: 'DELEGATION_SIGNATURE_REQUEST', typicalCarrier: 'Hub fabric message log (collections.messages)', stability: Stability.stable, notes: 'Browser asks Hub identity to sign; desktop resolves via ResolveDelegationSignatureMessage.' },
  { innerType: 'DELEGATION_SIGNATURE_RESOLUTION', typicalCarrier: 'Hub fabric message log', stability: Stability.stable, notes: 'Approved/rejected; references parentMessageId.' }
];

function outerTypeNames () {
  // Unique names only (aliases share opcodes with canonical rows).
  return [...new Set(OUTER_WIRE_TYPES.map((t) => t.name))];
}

function findOuterByName (name) {
  const n = String(name || '').trim();
  return OUTER_WIRE_TYPES.find((t) => t.name === n) || null;
}

function findOuterByOpcodeDec (opcode) {
  const n = Number(opcode);
  if (!Number.isFinite(n)) return null;
  return OUTER_WIRE_TYPES.find((t) => t.opcodeDec === n) || null;
}

module.exports = {
  Stability,
  PayloadEncoding,
  SUGGESTED_HUB_OPCODE_BLOCK_START,
  SUGGESTED_HUB_OPCODE_BLOCK_END,
  OUTER_WIRE_TYPES,
  APPLICATION_CONTRACT_BODY_TYPES,
  INNER_DOMAIN_PENDING_PROMOTION,
  outerTypeNames,
  findOuterByName,
  findOuterByOpcodeDec
};
