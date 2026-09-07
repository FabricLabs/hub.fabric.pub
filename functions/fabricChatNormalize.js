'use strict';

/**
 * Re-export chat normalize from `@fabric/http`.
 *
 * The epoch-0 guard (`Number(null)` / `Number('')` coerce to a *finite* 0) is
 * upstream now, so this file collapses to the bare module on current pins and
 * keeps the wrapper only for pins predating that fix.
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

function pinSanitizesCreated () {
  try {
    const probe = base.normalizeP2pChatMessage({ object: { content: 'x', created: null } });
    return !!(probe && probe.object && probe.object.created > 0);
  } catch (_) {
    return false;
  }
}

module.exports = pinSanitizesCreated()
  ? base
  : Object.assign({}, base, { normalizeP2pChatMessage });
