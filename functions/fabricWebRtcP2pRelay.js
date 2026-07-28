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

/** Inner types that are not first-class outer opcodes — carry as GENERIC_MESSAGE JSON. */
const GENERIC_CARRIER_TYPES = new Set([
  'P2P_PEER_GOSSIP',
  'P2P_PEERING_OFFER'
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
 * @param {string|Buffer} original
 * @param {string} originalType
 * @param {object} signingKey Key with signWithKey support (hub agent / root key)
 * @returns {Buffer} Signed (or preserved) inner Message wire bytes
 */
function buildInnerWireBuffer (original, originalType, signingKey) {
  const type = String(originalType || 'P2P_CHAT_MESSAGE');

  if (type === 'fabric-message') {
    const buf = Buffer.isBuffer(original)
      ? original
      : Buffer.from(String(original || ''), 'base64');
    if (!looksLikeFabricMessageBuffer(buf)) {
      throw new Error('fabric-message original is not a Fabric Message buffer');
    }
    return buf;
  }

  const body = Buffer.isBuffer(original)
    ? original.toString('utf8')
    : String(original || '');

  let outerType = type;
  let outerBody = body;
  if (GENERIC_CARRIER_TYPES.has(type)) {
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
  } else if (type === 'BitcoinBlock') {
    outerType = 'BitcoinBlock';
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
  looksLikeFabricMessageBuffer,
  buildInnerWireBuffer,
  wrapPeerP2pRelay
};
