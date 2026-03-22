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
  { name: 'ChatMessage', opcodeDec: 103, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Chat broadcast (0x67).' },
  { name: 'Ping', opcodeDec: 18, stability: Stability.stable, encoding: PayloadEncoding.utf8Text, notes: 'P2P_PING keepalive.' },
  { name: 'Pong', opcodeDec: 19, stability: Stability.stable, encoding: PayloadEncoding.utf8Text, notes: 'P2P_PONG response.' },
  { name: 'P2P_RELAY', opcodeDec: 67, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Relay envelope (original + originalType + hops).' },
  { name: 'P2P_MESSAGE_RECEIPT', opcodeDec: 68, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Server ack after handling inbound frame.' },
  { name: 'JSONBlob', opcodeDec: 15104, stability: Stability.transitional, encoding: PayloadEncoding.utf8Json, notes: 'GENERIC+1; JSON payload, prefer named type when available.' },
  { name: 'GenericMessage', opcodeDec: 15103, stability: Stability.transitional, encoding: PayloadEncoding.utf8Json, notes: 'Placeholder outer type; prefer dedicated opcode + structured body.' },
  { name: 'PeerMessage', opcodeDec: 49, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'P2P_BASE_MESSAGE; generic peer payload carrier.' },
  { name: 'DocumentPublish', opcodeDec: 998, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Document publish.' },
  { name: 'DocumentRequest', opcodeDec: 999, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Document request.' },
  { name: 'ContractProposal', opcodeDec: 138, stability: Stability.stable, encoding: PayloadEncoding.utf8Json, notes: 'Batched messages + chain Merkle root + JSON Patch (+ optional PSBT); see @fabric/core docs/CONTRACT_PROPOSAL.md.' }
];

/**
 * **Inner** domain payloads often carried today inside `GenericMessage` UTF-8 JSON (ActivityStreams-style `type` field).
 * These should graduate to **outer** `Message.type` values (+ opcode in `Message.types`) with versioned binary layouts.
 */
const INNER_DOMAIN_PENDING_PROMOTION = [
  { innerType: 'INVENTORY_REQUEST', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned },
  { innerType: 'INVENTORY_RESPONSE', typicalCarrier: 'GenericMessage JSON body', stability: Stability.planned },
  { innerType: 'P2P_FILE_SEND', typicalCarrier: 'Peer P2P / GenericMessage fanout', stability: Stability.stable },
  { innerType: 'P2P_CHAT_MESSAGE', typicalCarrier: 'P2P / WebRTC / ChatMessage', stability: Stability.stable },
  { innerType: 'P2P_PEER_GOSSIP', typicalCarrier: 'GenericMessage / P2P_RELAY', stability: Stability.stable },
  { innerType: 'P2P_PEERING_OFFER', typicalCarrier: 'GenericMessage / P2P_RELAY', stability: Stability.stable },
  { innerType: 'Tombstone', typicalCarrier: 'GenericMessage (hub broadcast) + Fabric log type', stability: Stability.stable, notes: 'Hub `EmitTombstone`; object carries activityMessageId and/or documentId.' },
  { innerType: 'WebRTCSignal', typicalCarrier: 'JSONCall result payload', stability: Stability.transitional, notes: 'Could become dedicated outer type for fanout.' },
  { innerType: 'DELEGATION_SIGNATURE_REQUEST', typicalCarrier: 'Hub fabric message log (collections.messages)', stability: Stability.stable, notes: 'Browser asks Hub identity to sign; desktop resolves via ResolveDelegationSignatureMessage.' },
  { innerType: 'DELEGATION_SIGNATURE_RESOLUTION', typicalCarrier: 'Hub fabric message log', stability: Stability.stable, notes: 'Approved/rejected; references parentMessageId.' }
];

function outerTypeNames () {
  return OUTER_WIRE_TYPES.map((t) => t.name);
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
  INNER_DOMAIN_PENDING_PROMOTION,
  outerTypeNames,
  findOuterByName,
  findOuterByOpcodeDec
};
