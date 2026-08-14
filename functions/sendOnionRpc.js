'use strict';

/**
 * Hub JSON-RPC body for directed onion send (P2P_FORWARD).
 * Text chat is sealed to the path tip by default so relays cannot read cleartext
 * even if they recurse nested onion inners (`encrypt: false` keeps legacy plaintext).
 * @param {object} agent Fabric Peer (`sendOnion`, optional `key`)
 * @param {Array} params RPC params
 * @returns {{ status: string, sent?: boolean, pathLength?: number, sealed?: boolean, message?: string }}
 */
function invokeSendOnion (agent, params = []) {
  if (!agent || typeof agent.sendOnion !== 'function') {
    return { status: 'error', message: 'Peer sendOnion unavailable (upgrade @fabric/core)' };
  }

  let path = null;
  let text = '';
  let messageBase64 = null;
  let encrypt = true;
  const first = params[0];
  if (Array.isArray(first)) {
    path = first;
    const second = params[1];
    if (typeof second === 'string') text = second;
    else if (second && typeof second === 'object') {
      text = second.text || second.content || '';
      messageBase64 = second.messageBase64 || second.payloadBase64 || null;
      if (second.encrypt === false) encrypt = false;
    }
  } else if (first && typeof first === 'object') {
    path = first.path || first.hops || null;
    text = first.text || first.content || '';
    messageBase64 = first.messageBase64 || first.payloadBase64 || null;
    if (first.encrypt === false) encrypt = false;
  }

  if (!Array.isArray(path) || !path.length) {
    return { status: 'error', message: 'path (array of peer pubkeys) required' };
  }

  const Message = require('@fabric/core/types/message');
  let payload = null;
  let sealed = false;
  if (messageBase64) {
    payload = Message.fromBuffer(Buffer.from(String(messageBase64), 'base64'));
  } else if (text) {
    let body = String(text);
    if (encrypt) {
      try {
        const onionChatSeal = require('./onionChatSeal');
        const recipient = onionChatSeal.onionPathRecipientXOnly(path);
        if (!recipient) {
          return { status: 'error', message: 'path tip pubkey required to seal onion chat' };
        }
        body = onionChatSeal.sealOnionChatText(body, recipient);
        sealed = true;
      } catch (err) {
        return {
          status: 'error',
          message: err && err.message ? err.message : 'onion chat seal failed'
        };
      }
    }
    payload = Message.fromVector(['P2P_CHAT_MESSAGE', body]);
    if (agent.key) payload.signWithKey(agent.key);
  } else {
    return { status: 'error', message: 'text or messageBase64 required' };
  }

  const sent = agent.sendOnion(path, payload);
  return sent
    ? { status: 'success', sent: true, pathLength: path.length, sealed }
    : { status: 'error', message: 'sendOnion failed (first hop missing or wrap error)', sent: false };
}

module.exports = {
  invokeSendOnion
};
