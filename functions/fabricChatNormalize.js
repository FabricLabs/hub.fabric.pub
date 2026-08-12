'use strict';

/**
 * Re-export chat normalize from `@fabric/http`, with a Hub-side guard for
 * `Number(null)` / empty-string coerced timestamps (epoch 0).
 */
let base;
try {
  base = require('@fabric/http/functions/fabricChatNormalize');
} catch (_) {
  base = require('./fabricChatNormalize.local');
}

function sanitizeCreated (value) {
  const n = Number(value);
  // Reject non-finite and epoch-0 (Number(null) / Number('')) so sorts stay sane.
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n;
}

function normalizeP2pChatMessage (chat, opts = {}) {
  const out = base.normalizeP2pChatMessage(chat, opts);
  if (!out || !out.object || typeof out.object !== 'object') return out;
  out.object.created = sanitizeCreated(out.object.created);
  return out;
}

module.exports = Object.assign({}, base, {
  normalizeP2pChatMessage
});
