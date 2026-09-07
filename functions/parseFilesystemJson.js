'use strict';

/**
 * Parse JSON from {@link Filesystem#readFile}.
 * Disk reads return a Buffer; tests often store a string or already-decoded object.
 *
 * @param {*} raw
 * @returns {*}
 */
function parseFilesystemJson (raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return JSON.parse(raw);
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  }
  if (typeof raw === 'object') return raw;
  return JSON.parse(String(raw));
}

module.exports = parseFilesystemJson;
