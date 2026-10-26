'use strict';

/**
 * @fileoverview Rotating, secret-scrubbed log file for the Electron desktop shell
 * (`userData/logs/fabric-hub.log`): Hub child stdout/stderr plus the main process console.
 */

const fs = require('fs');
const path = require('path');

/** @private */
const REDACTIONS = [
  [/\b([xtyzuv]prv)[1-9A-HJ-NP-Za-km-z]{20,}/g, '$1…[redacted]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  [/("(?:adminToken|token|password|passphrase|mnemonic|seed|xprv|secret|appSecret)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2'],
  [/([?&](?:token|adminToken|secret|password)=)[^&\s"']+/gi, '$1[redacted]'],
  [/\b((?:FABRIC_(?:XPRV|SEED|MNEMONIC|PASSWORD|PASSPHRASE|HUB_ADMIN_TOKEN)|BITCOIN_RPC_PASSWORD)=)\S+/g, '$1[redacted]']
];

/**
 * @param {string} text
 * @returns {string}
 */
function redactLogText (text) {
  let out = String(text == null ? '' : text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Append-only log that rolls `name.log` → `name.log.1` … `name.log.<keep>` past `maxBytes`.
 */
class RotatingLogFile {
  /**
   * @param {Object} opts
   * @param {string} opts.filePath
   * @param {number} [opts.maxBytes] default 5 MiB
   * @param {number} [opts.keep] rotated files kept, default 3
   */
  constructor (opts = {}) {
    this.filePath = opts.filePath;
    this.maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : 5 * 1024 * 1024;
    this.keep = Number(opts.keep) > 0 ? Number(opts.keep) : 3;
    this.size = 0;
    this.fd = null;
    this._open();
  }

  _open () {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.fd = fs.openSync(this.filePath, 'a');
      this.size = fs.fstatSync(this.fd).size;
    } catch (_) {
      this.fd = null;
    }
  }

  _rotate () {
    this.close();
    try {
      for (let i = this.keep - 1; i >= 1; i--) {
        const from = `${this.filePath}.${i}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${this.filePath}.${i + 1}`);
      }
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch (_) {
      // Another process (or antivirus on Windows) may hold the file; keep appending to it.
    }
    this._open();
  }

  /**
   * @param {string|Buffer} chunk
   */
  write (chunk) {
    if (this.fd == null) return;
    const buf = Buffer.from(redactLogText(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk), 'utf8');
    if (this.size > 0 && this.size + buf.length > this.maxBytes) this._rotate();
    if (this.fd == null) return;
    try {
      fs.writeSync(this.fd, buf);
      this.size += buf.length;
    } catch (_) { /* logging must never take the shell down */ }
  }

  close () {
    if (this.fd == null) return;
    try {
      fs.closeSync(this.fd);
    } catch (_) {}
    this.fd = null;
  }
}

module.exports = {
  RotatingLogFile,
  redactLogText
};
