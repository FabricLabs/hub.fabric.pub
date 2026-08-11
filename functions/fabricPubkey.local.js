'use strict';

/**
 * Secp256k1 pubkey normalize helpers for Fabric chat / membership.
 * Compressed (02/03||x) and x-only (64-hex) forms compare equal via {@link pubkeysMatch}.
 */

/**
 * @param {*} hex
 * @returns {string|null} lowercase 64-hex x-only, or null
 */
function pubkeyXOnly (hex) {
  const s = String(hex || '').toLowerCase().replace(/^0x/, '');
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  if (/^[0-9a-f]{64}$/.test(s)) return s;
  return null;
}

/**
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function pubkeysMatch (a, b) {
  const xa = pubkeyXOnly(a);
  const xb = pubkeyXOnly(b);
  return !!(xa && xb && xa === xb);
}

/**
 * Canonical chat actor id = x-only pubkey hex.
 * AMP P2P_CHAT_MESSAGE authors are x-only; many app identities use compressed Key.pubkey.
 * @param {*} hex
 * @returns {string}
 */
function canonicalChatAuthor (hex) {
  const x = pubkeyXOnly(hex);
  if (!x) throw new Error('invalid author pubkey');
  return x;
}

/**
 * Prefer a compressed actor pubkey when it matches the wire signer (x-only).
 * @param {string|null} signerHex
 * @param {object|null} actor
 * @returns {string|null}
 */
function resolveSignerPubkey (signerHex, actor) {
  const candidate = actor && (actor.publicKey || actor.pubkey || actor.id);
  if (candidate && (!signerHex || pubkeysMatch(candidate, signerHex))) return String(candidate);
  return signerHex ? String(signerHex) : (candidate ? String(candidate) : null);
}

module.exports = {
  pubkeyXOnly,
  pubkeysMatch,
  canonicalChatAuthor,
  resolveSignerPubkey
};
