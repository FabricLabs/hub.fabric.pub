'use strict';

/**
 * v1 envelope for JSON inside {@link Message} bodies (GenericMessage data).
 * Privacy / Taproot: logical author is `author.hex` (32-byte pubkey hash) when
 * `author.kind` is `taproot_contract_pubkey_hash`; wire `Message.raw.author`
 * remains the signer identity when the Hub builds the message.
 *
 * Encryption: `none` for sign-in and open delegation; `chacha20-poly1305-v1` reserves
 * ciphertext + nonce for privacy-sensitive paths (decrypt outside this module).
 *
 * Multisig: `signers[]` lists parties to notify / threshold (Schnorr MuSig future).
 */

const Message = require('@fabric/core/types/message');

const ENVELOPE_KEY = '@fabric/MessageEnvelope';

const ENCRYPTION = {
  NONE: 'none',
  CHACHA20_POLY1305_V1: 'chacha20-poly1305-v1'
};

const AUTHOR_KIND = {
  TAPROOT_CONTRACT_PUBKEY_HASH: 'taproot_contract_pubkey_hash',
  IDENTITY_XONLY_PUBKEY: 'identity_xonly_pubkey',
  UNKNOWN: 'unknown'
};

const DEFAULT_SIGN_PROMPT = 'The following would like you to sign the following message:';

function validateEnvelopeV1 (e) {
  if (!e || typeof e !== 'object') return { ok: false, error: 'envelope must be an object' };
  const ver = e[ENVELOPE_KEY];
  if (ver !== '1' && ver !== 1) return { ok: false, error: `${ENVELOPE_KEY} must be "1"` };

  const enc = e.encryption;
  if (enc !== ENCRYPTION.NONE && enc !== ENCRYPTION.CHACHA20_POLY1305_V1) {
    return { ok: false, error: `unsupported encryption: ${enc}` };
  }
  if (enc === ENCRYPTION.CHACHA20_POLY1305_V1) {
    if (typeof e.ciphertextHex !== 'string' || typeof e.nonceHex !== 'string') {
      return { ok: false, error: 'encrypted envelope requires ciphertextHex and nonceHex' };
    }
  }

  const author = e.author;
  if (!author || typeof author !== 'object') return { ok: false, error: 'author object required' };
  if (typeof author.kind !== 'string' || !author.kind) return { ok: false, error: 'author.kind required' };
  if (typeof author.hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(author.hex)) {
    return { ok: false, error: 'author.hex must be 64 hex chars (32 bytes)' };
  }

  if (e.signers != null && !Array.isArray(e.signers)) return { ok: false, error: 'signers must be an array' };
  if (Array.isArray(e.signers)) {
    for (let i = 0; i < e.signers.length; i++) {
      const s = e.signers[i];
      if (!s || typeof s !== 'object') return { ok: false, error: `signers[${i}] invalid` };
      if (s.pubkeyHashHex != null && typeof s.pubkeyHashHex === 'string' && !/^[0-9a-fA-F]{0,64}$/.test(s.pubkeyHashHex)) {
        return { ok: false, error: `signers[${i}].pubkeyHashHex invalid` };
      }
    }
  }

  if (e.display != null && typeof e.display !== 'object') return { ok: false, error: 'display must be an object' };

  return { ok: true };
}

/**
 * Build an unsigned {@link Message} whose body is the envelope JSON (encryption `none` only).
 * @param {object} envelope - validated v1 envelope
 */
function buildGenericMessageFromEnvelope (envelope) {
  const v = validateEnvelopeV1(envelope);
  if (!v.ok) throw new Error(v.error);
  if (envelope.encryption !== ENCRYPTION.NONE) {
    throw new Error('buildGenericMessageFromEnvelope requires encryption "none" (decrypt first for sealed bodies)');
  }
  return new Message({
    type: 'GenericMessage',
    data: envelope
  });
}

module.exports = {
  ENVELOPE_KEY,
  ENCRYPTION,
  AUTHOR_KIND,
  DEFAULT_SIGN_PROMPT,
  validateEnvelopeV1,
  buildGenericMessageFromEnvelope
};
