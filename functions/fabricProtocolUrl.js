'use strict';

/**
 * `fabric:` protocol — opaque **fabric:&lt;hex&gt;** carries only a serialized {@link Message} (no `//` host).
 * Legacy: `fabric://login?…`, `fabric://message?hex=…` (see `electron/main.js`).
 * @see `functions/fabricMessageEnvelope.js` for JSON body envelope v1.
 */

const Message = require('@fabric/core/types/message');

function normalizeHex (s) {
  if (typeof s !== 'string') return '';
  let t = s.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) t = t.slice(2);
  return t;
}

/**
 * Decode hex → Buffer and parse with `Message.fromBuffer`.
 * @param {string} hex
 * @returns {{ ok: true, buffer: Buffer, message: import('@fabric/core/types/message') } | { ok: false, error: string }}
 */
function parseHexFabricMessage (hex) {
  const norm = normalizeHex(hex);
  if (!norm) return { ok: false, error: 'empty hex' };
  if (norm.length % 2 !== 0) return { ok: false, error: 'odd hex length' };
  if (!/^[0-9a-fA-F]+$/.test(norm)) return { ok: false, error: 'invalid hex' };
  let buffer;
  try {
    buffer = Buffer.from(norm, 'hex');
  } catch (e) {
    return { ok: false, error: 'hex decode failed' };
  }
  if (buffer.length < 32) return { ok: false, error: 'buffer too short for Fabric message header' };
  try {
    const message = Message.fromBuffer(buffer);
    return { ok: true, buffer, message };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? String(e.message) : 'Message.fromBuffer failed' };
  }
}

/**
 * @param {import('@fabric/core/types/message')} m
 */
function envelopeMetaFromUtf8Body (bodyUtf8) {
  if (typeof bodyUtf8 !== 'string' || !bodyUtf8.trim().startsWith('{')) return null;
  try {
    const j = JSON.parse(bodyUtf8);
    if (!j || (j['@fabric/MessageEnvelope'] !== '1' && j['@fabric/MessageEnvelope'] !== 1)) return null;
    return {
      prompt: j.display && typeof j.display.prompt === 'string' ? j.display.prompt : null,
      intent: j.intent != null ? String(j.intent) : null,
      encryption: j.encryption != null ? String(j.encryption) : null,
      authorKind: j.author && j.author.kind != null ? String(j.author.kind) : null,
      authorContractHash: j.author && j.author.hex ? String(j.author.hex) : null,
      signersCount: Array.isArray(j.signers) ? j.signers.length : 0
    };
  } catch (e) {
    return null;
  }
}

function summarizeFabricMessage (m) {
  if (!m || !m.raw || !m.raw.type) {
    return { typeName: 'unknown', typeCode: null, authorHex: '', bodyPreview: '', byteLength: 0, envelopeMeta: null };
  }
  const code = m.raw.type.readUInt32BE(0);
  const typeName = m.codes && m.codes[code] ? m.codes[code] : `type_${code}`;
  const authorHex = m.raw.author && typeof m.raw.author.toString === 'function'
    ? m.raw.author.toString('hex')
    : '';
  let bodyPreview = '';
  let envelopeMeta = null;
  try {
    const data = m.raw.data;
    if (data && data.length) {
      const u8 = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bodyPreview = u8.toString('utf8').slice(0, 600);
      if (!bodyPreview || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bodyPreview)) {
        bodyPreview = u8.toString('hex').slice(0, 200) + (u8.length > 100 ? '…' : '');
      } else {
        envelopeMeta = envelopeMetaFromUtf8Body(u8.toString('utf8'));
      }
    }
  } catch (e) {
    bodyPreview = '';
  }
  let byteLength = 0;
  try {
    if (typeof m.asRaw === 'function') byteLength = m.asRaw().length;
    else byteLength = (m.raw.data ? m.raw.data.length : 0) + 208;
  } catch (e) {
    byteLength = bufferLengthSafe(m);
  }
  return { typeName, typeCode: code, authorHex, bodyPreview, byteLength, envelopeMeta };
}

function bufferLengthSafe (m) {
  try {
    const d = m.raw && m.raw.data;
    return (d && d.length ? d.length : 0) + 208;
  } catch (e) {
    return 0;
  }
}

/**
 * Structured summary for IPC / UI (no Message class on renderer unless bundled).
 * @param {string} hex
 */
function fabricMessageSummaryFromHex (hex) {
  const parsed = parseHexFabricMessage(hex);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const summary = summarizeFabricMessage(parsed.message);
  return {
    ok: true,
    hex: normalizeHex(hex),
    summary
  };
}

/**
 * Opaque form: `fabric:deadbeef…` (see WHATWG URL: empty hostname, hex in pathname).
 * @param {string} urlStr
 * @returns {string|null} normalized hex or null
 */
function parseOpaqueFabricMessageHex (urlStr) {
  if (typeof urlStr !== 'string') return null;
  let url;
  try {
    url = new URL(urlStr.trim());
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'fabric:') return null;
  if (url.hostname) return null;
  const raw = url.pathname ? String(url.pathname).replace(/^\//, '') : '';
  if (!raw) return null;
  const hex = normalizeHex(raw);
  if (!hex || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  return hex;
}

module.exports = {
  normalizeHex,
  parseHexFabricMessage,
  summarizeFabricMessage,
  fabricMessageSummaryFromHex,
  parseOpaqueFabricMessageHex,
  envelopeMetaFromUtf8Body
};
