'use strict';

/**
 * Normalize Fabric shoutbox chat for Hub UI / cache.
 *
 * Mesh wire (first-class P2P_CHAT_MESSAGE): body = raw UTF-8 text only.
 * Peer emits: `{ text, type: 'P2P_CHAT_MESSAGE' }` (+ meta.signer).
 *
 * Hub SPA / WebSocket may still use a JSON ChatMessage carrier with
 * `{ type, actor, object: { content, … } }` — that is the HTTP edge, not the P2P body.
 *
 * Nicknames/handles are not part of the chat wire; use P2P_PEER_ALIAS.
 *
 * @see @fabric/core docs/APPLICATION_NAMESPACES.md
 */

/**
 * Extract displayable text from a chat payload or Peer chat event.
 * @param {object|string|null|undefined} chat
 * @returns {string}
 */
function chatTextOf (chat) {
  if (chat == null) return '';
  if (typeof chat === 'string') return chat;
  if (typeof chat !== 'object') return '';
  // Peer first-class emit: { text }
  if (chat.text != null && String(chat.text).trim()) return String(chat.text);
  const obj = chat.object && typeof chat.object === 'object' ? chat.object : {};
  if (obj.content != null && String(obj.content).trim()) return String(obj.content);
  if (obj.body != null && String(obj.body).trim()) return String(obj.body);
  if (chat.content != null && String(chat.content).trim()) return String(chat.content);
  if (chat.body != null && String(chat.body).trim()) return String(chat.body);
  return '';
}

/**
 * Actor / author id (pubkey) from Hub UI shape or Peer meta/signer.
 * @param {object|null|undefined} chat
 * @param {{ defaultActorId?: string|null, signer?: string|null }} [opts]
 * @returns {string|null}
 */
function chatActorIdOf (chat, opts = {}) {
  if (opts.signer) return String(opts.signer);
  if (!chat || typeof chat !== 'object') return opts.defaultActorId ? String(opts.defaultActorId) : null;
  const actor = chat.actor && typeof chat.actor === 'object' ? chat.actor : {};
  const fromActor = actor.id || actor.publicKey || actor.pubkey || null;
  if (fromActor) return String(fromActor);
  const obj = chat.object && typeof chat.object === 'object' ? chat.object : {};
  if (obj.author) return String(obj.author);
  return opts.defaultActorId ? String(opts.defaultActorId) : null;
}

/**
 * Normalize inbound chat into a Hub-cacheable shape for WS UI.
 * Does not put handle/nickname on the wire representation used for P2P.
 * @param {object|string} chat
 * @param {{ defaultActorId?: string|null, signer?: string|null }} [opts]
 * @returns {object|null}
 */
function normalizeP2pChatMessage (chat, opts = {}) {
  const text = chatTextOf(chat);
  if (!text.trim()) return null;

  const objIn = (chat && typeof chat === 'object' && chat.object && typeof chat.object === 'object')
    ? chat.object
    : {};
  const actorId = chatActorIdOf(chat, opts) || 'unknown';
  let created = Number(objIn.created);
  if (!Number.isFinite(created) && objIn.ts) {
    const parsed = Date.parse(objIn.ts);
    created = Number.isFinite(parsed) ? parsed : Date.now();
  }
  if (!Number.isFinite(created) && chat && typeof chat === 'object' && chat.created != null) {
    created = Number(chat.created);
  }
  if (!Number.isFinite(created)) created = Date.now();

  const object = {
    content: text,
    created
  };
  if (objIn.clientId != null) object.clientId = String(objIn.clientId);
  if (objIn.id != null) object.id = String(objIn.id);

  const out = {
    type: 'P2P_CHAT_MESSAGE',
    actor: {
      id: actorId,
      ...(chat && chat.actor && chat.actor.publicKey ? { publicKey: String(chat.actor.publicKey) } : {}),
      ...(chat && chat.actor && chat.actor.pubkey ? { pubkey: String(chat.actor.pubkey) } : {})
    },
    object
  };
  if (chat && typeof chat === 'object' && chat.target != null) out.target = chat.target;
  return out;
}

module.exports = {
  chatTextOf,
  chatActorIdOf,
  normalizeP2pChatMessage
};
