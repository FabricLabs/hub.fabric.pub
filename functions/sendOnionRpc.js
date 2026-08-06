'use strict';

/**
 * Hub JSON-RPC body for directed onion send (P2P_FORWARD).
 * @param {object} agent Fabric Peer (`sendOnion`, optional `key`)
 * @param {Array} params RPC params
 * @returns {{ status: string, sent?: boolean, pathLength?: number, message?: string }}
 */
function invokeSendOnion (agent, params = []) {
  if (!agent || typeof agent.sendOnion !== 'function') {
    return { status: 'error', message: 'Peer sendOnion unavailable (upgrade @fabric/core)' };
  }

  let path = null;
  let text = '';
  let messageBase64 = null;
  const first = params[0];
  if (Array.isArray(first)) {
    path = first;
    const second = params[1];
    if (typeof second === 'string') text = second;
    else if (second && typeof second === 'object') {
      text = second.text || second.content || '';
      messageBase64 = second.messageBase64 || second.payloadBase64 || null;
    }
  } else if (first && typeof first === 'object') {
    path = first.path || first.hops || null;
    text = first.text || first.content || '';
    messageBase64 = first.messageBase64 || first.payloadBase64 || null;
  }

  if (!Array.isArray(path) || !path.length) {
    return { status: 'error', message: 'path (array of peer pubkeys) required' };
  }

  const Message = require('@fabric/core/types/message');
  let payload = null;
  if (messageBase64) {
    payload = Message.fromBuffer(Buffer.from(String(messageBase64), 'base64'));
  } else if (text) {
    payload = Message.fromVector(['P2P_CHAT_MESSAGE', String(text)]);
    if (agent.key) payload.signWithKey(agent.key);
  } else {
    return { status: 'error', message: 'text or messageBase64 required' };
  }

  const sent = agent.sendOnion(path, payload);
  return sent
    ? { status: 'success', sent: true, pathLength: path.length }
    : { status: 'error', message: 'sendOnion failed (first hop missing or wrap error)', sent: false };
}

module.exports = {
  invokeSendOnion
};
