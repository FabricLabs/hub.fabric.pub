'use strict';

/**
 * @fileoverview Small encrypted key/value file for the Electron desktop shell. The main process
 * passes Electron `safeStorage` (OS keychain / DPAPI / libsecret) as `encrypt` / `decrypt`; the
 * renderer reaches it only through the preload `fabricDesktop.secureStore` bridge.
 */

const fs = require('fs');
const path = require('path');
const DESKTOP_SECURE_KEYS = require('./desktopSecureKeys');
/** @private */
const MAX_VALUE_BYTES = 16 * 1024;

/**
 * @param {Object} opts
 * @param {string} opts.filePath
 * @param {function(string): Buffer} opts.encrypt
 * @param {function(Buffer): string} opts.decrypt
 * @param {string[]} [opts.keys] allowed keys (default {@link DESKTOP_SECURE_KEYS})
 */
function createDesktopSecureStore (opts = {}) {
  const filePath = opts.filePath;
  const allowed = new Set(opts.keys || DESKTOP_SECURE_KEYS);

  function assertKey (key) {
    if (!allowed.has(String(key || ''))) throw new Error(`Not a desktop secure key: ${key}`);
  }

  function readAll () {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeAll (data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  return {
    /**
     * @param {string} key
     * @returns {string} '' when absent or unreadable (e.g. keychain reset)
     */
    get (key) {
      assertKey(key);
      const sealed = readAll()[key];
      if (typeof sealed !== 'string' || !sealed) return '';
      try {
        return String(opts.decrypt(Buffer.from(sealed, 'base64')));
      } catch (_) {
        return '';
      }
    },

    /**
     * @param {string} key
     * @param {string} value
     */
    set (key, value) {
      assertKey(key);
      const v = String(value == null ? '' : value);
      if (Buffer.byteLength(v, 'utf8') > MAX_VALUE_BYTES) throw new Error('Secure value is too large');
      const data = readAll();
      data[key] = Buffer.from(opts.encrypt(v)).toString('base64');
      writeAll(data);
    },

    /**
     * @param {string} key
     */
    remove (key) {
      assertKey(key);
      const data = readAll();
      if (!Object.prototype.hasOwnProperty.call(data, key)) return;
      delete data[key];
      writeAll(data);
    }
  };
}

module.exports = {
  DESKTOP_SECURE_KEYS,
  createDesktopSecureStore
};
