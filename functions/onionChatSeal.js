'use strict';

/**
 * Hub fallback for onion chat seals when `@fabric/core/functions/onionChatSeal`
 * is not yet on the installed core pin. Prefer the core module when present.
 */

let core;
try {
  core = require('@fabric/core/functions/onionChatSeal');
} catch (_) {
  core = null;
}

if (core) {
  module.exports = core;
} else {
  const {
    SEAL_SCHEME_PARTICIPANT,
    pubkeyXOnly,
    sealParticipantGroupChatBody,
    openParticipantGroupChatBody
  } = require('@fabric/core/functions/groupChatSeal');

  const ONION_CHAT_SEAL_TYPE = 'FabricOnionChatSeal';
  const ONION_CHAT_SEAL_VERSION = 1;

  function parseOnionChatSeal (text) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('{')) return null;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed['@type'] !== ONION_CHAT_SEAL_TYPE) return null;
    if (Number(parsed.v) !== ONION_CHAT_SEAL_VERSION) return null;
    if (parsed.scheme !== SEAL_SCHEME_PARTICIPANT) return null;
    if (!parsed.ephemeralPub || !parsed.nonce || !parsed.ciphertext) return null;
    if (!Array.isArray(parsed.wraps) || !parsed.wraps.length) return null;
    return parsed;
  }

  function isOnionChatSeal (text) {
    return !!parseOnionChatSeal(text);
  }

  function sealOnionChatText (plaintext, recipientPubkeys) {
    const body = plaintext != null ? String(plaintext) : '';
    if (!body.trim()) throw new Error('sealOnionChatText: plaintext required');
    const members = Array.isArray(recipientPubkeys) ? recipientPubkeys : [recipientPubkeys];
    const seal = sealParticipantGroupChatBody({
      body,
      memberPubkeys: members
    });
    return JSON.stringify({
      '@type': ONION_CHAT_SEAL_TYPE,
      v: ONION_CHAT_SEAL_VERSION,
      scheme: seal.scheme,
      ephemeralPub: seal.ephemeralPub,
      wraps: seal.wraps,
      nonce: seal.nonce,
      ciphertext: seal.ciphertext
    });
  }

  function tryOpenOnionChatText (text, opts = {}) {
    const seal = parseOnionChatSeal(text);
    if (!seal) {
      return { sealed: false, opened: false, text: text != null ? String(text) : null };
    }
    try {
      const opened = openParticipantGroupChatBody(seal, {
        keyOrPrivate: opts.keyOrPrivate != null ? opts.keyOrPrivate : opts.key,
        pubkey: opts.pubkey
      });
      return { sealed: true, opened: true, text: opened };
    } catch (_) {
      return { sealed: true, opened: false, text: null };
    }
  }

  function onionPathRecipientXOnly (path) {
    if (!Array.isArray(path) || !path.length) return null;
    const tip = path[path.length - 1];
    if (Buffer.isBuffer(tip)) return tip.toString('hex').toLowerCase();
    return pubkeyXOnly(tip);
  }

  module.exports = {
    ONION_CHAT_SEAL_TYPE,
    ONION_CHAT_SEAL_VERSION,
    isOnionChatSeal,
    parseOnionChatSeal,
    sealOnionChatText,
    tryOpenOnionChatText,
    onionPathRecipientXOnly
  };
}
