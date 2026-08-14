'use strict';

/**
 * Build Peer-mesh P2P_RELAY frames for WebRTC → Fabric TCP fan-out.
 *
 * @fabric/core Peer expects P2P_RELAY body = raw inner Message bytes (see
 * Peer._handleFabricMessage / _relayWirePayload). Hub↔browser WS may still use a
 * JSON hops envelope; this helper is for the TCP path only.
 */

const Message = require('@fabric/core/types/message');
const { HEADER_SIZE, MAGIC_BYTES } = require('@fabric/core/constants');
const { chatTextOf } = require('@fabric/core/functions/fabricChatText');

/** Inner types that are not first-class outer opcodes — carry as GENERIC_MESSAGE JSON. */
const GENERIC_CARRIER_TYPES = new Set([
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER'
]);

/**
 * Author-signed outer types that must never be re-encoded by the hub.
 * Prefer base64 AMP bytes (same as `fabric-message`).
 */
const PRESERVE_WIRE_TYPES = new Set([
  'fabric-message',
  'CONTRACT_MESSAGE',
  'P2P_CONTRACT_MESSAGE'
]);

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
function looksLikeFabricMessageBuffer (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_SIZE) return false;
  return buf.readUInt32BE(0) === MAGIC_BYTES;
}

/**
 * Decode envelope.original to raw AMP bytes when the caller sent base64 wire.
 * @param {string|Buffer} original
 * @returns {Buffer|null}
 */
function tryDecodeWireBuffer (original) {
  if (Buffer.isBuffer(original)) {
    return looksLikeFabricMessageBuffer(original) ? original : null;
  }
  const s = String(original || '').trim();
  if (!s) return null;
  // Reject obvious JSON before base64 decode attempts.
  if (s.startsWith('{') || s.startsWith('[')) return null;
  try {
    const buf = Buffer.from(s, 'base64');
    if (looksLikeFabricMessageBuffer(buf)) return buf;
  } catch (_) { /* not base64 AMP */ }
  return null;
}

/**
 * Mesh shoutbox / alias bodies are raw UTF-8. Legacy Hub/Bridge envelopes
 * stuffed JSON `{ type, object.content }` into `original` — extract text so
 * Peer does not drop the frame as a JSON chat envelope.
 * @param {string|Buffer} original
 * @returns {string}
 */
function utf8ChatBodyFromOriginal (original) {
  const body = Buffer.isBuffer(original)
    ? original.toString('utf8')
    : String(original || '');
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const text = chatTextOf(parsed);
      if (text && String(text).trim()) return String(text);
      if (parsed && typeof parsed === 'object') {
        const name = parsed.alias || parsed.name
          || (parsed.object && (parsed.object.alias || parsed.object.name));
        if (name != null && String(name).trim()) return String(name).trim();
      }
    } catch (_) { /* keep raw */ }
  }
  return body;
}

/**
 * @param {string|Buffer} original
 * @param {string} originalType
 * @param {object} signingKey Key with signWithKey support (hub agent / root key)
 * @returns {Buffer} Signed (or preserved) inner Message wire bytes
 */
function buildInnerWireBuffer (original, originalType, signingKey) {
  const type = String(originalType || 'P2P_CHAT_MESSAGE');

  if (PRESERVE_WIRE_TYPES.has(type)) {
    const preserved = tryDecodeWireBuffer(original);
    if (preserved) return preserved;
    if (type === 'fabric-message') {
      throw new Error('fabric-message original is not a Fabric Message buffer');
    }
    // CONTRACT_MESSAGE without author-signed AMP bytes must not be Hub-re-signed
    // (would let any WebRTC client inject Hub-attested contract gossip).
    throw new Error('CONTRACT_MESSAGE original must be author-signed Message wire (base64)');
  }

  // BitcoinBlock tips are Hub/L1-attested; never mint Hub signatures from client JSON.
  if (type === 'BitcoinBlock' || type === 'P2P_BITCOIN_BLOCK') {
    const preserved = tryDecodeWireBuffer(original);
    if (preserved) return preserved;
    throw new Error('BitcoinBlock original must be author-signed Message wire (base64)');
  }

  const body = Buffer.isBuffer(original)
    ? original.toString('utf8')
    : String(original || '');

  let outerType = type;
  let outerBody = body;
  if (type === 'P2P_CHAT_MESSAGE' || type === 'P2P_PEER_ALIAS') {
    outerBody = utf8ChatBodyFromOriginal(original);
  } else if (GENERIC_CARRIER_TYPES.has(type)) {
    outerType = 'GenericMessage';
    // If caller already sent a bare object, wrap with the domain type.
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.type) {
        outerBody = body;
      } else {
        outerBody = JSON.stringify({ type, object: parsed });
      }
    } catch (_) {
      outerBody = JSON.stringify({ type, object: { raw: body } });
    }
  } else if (type === 'P2P_CONTRACT_MESSAGE') {
    // Prefer preserve-wire path above; JSON aliases are not Hub-signed.
    throw new Error('P2P_CONTRACT_MESSAGE original must be author-signed Message wire (base64)');
  }

  const inner = Message.fromVector([outerType, outerBody]);
  if (signingKey) inner.signWithKey(signingKey);
  return inner.toBuffer();
}

/**
 * @param {Buffer} innerBuffer
 * @param {object} signingKey
 * @returns {import('@fabric/core/types/message')}
 */
function wrapPeerP2pRelay (innerBuffer, signingKey) {
  if (!Buffer.isBuffer(innerBuffer) || !innerBuffer.length) {
    throw new Error('innerBuffer required');
  }
  const relay = Message.fromVector(['P2P_RELAY', innerBuffer]);
  if (signingKey) relay.signWithKey(signingKey);
  return relay;
}

module.exports = {
  GENERIC_CARRIER_TYPES,
  PRESERVE_WIRE_TYPES,
  looksLikeFabricMessageBuffer,
  tryDecodeWireBuffer,
  buildInnerWireBuffer,
  wrapPeerP2pRelay
};
