'use strict';

/**
 * Append hub-process console.error / console.warn lines for operators (outside Fabric store tree).
 *
 * Default path: `<FABRIC_HUB_USER_DATA|cwd>/logs/hub/debug.log` — not under `stores/hub/`, so the
 * hub Filesystem / Fabric index does not treat the file as published hub data.
 *
 * - Default: only lines that look like Fabric hub logs (prefix [HUB], [HUB:…], [FABRIC:HUB]).
 * - FABRIC_HUB_DEBUG_LOG=0 — disable file mirror.
 * - FABRIC_HUB_DEBUG_LOG=all — mirror every console.error / console.warn (noisy).
 * - FABRIC_HUB_DEBUG_LOG_FILE — absolute or relative path override (optional).
 * - FABRIC_HUB_DEBUG_LOG_MAX_BYTES — rotate when current file exceeds this size (bytes).
 *   Default 3145728 (3 MiB). Set to 0 to disable rotation (not recommended).
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const HUB_LINE_RE = /\[(?:FABRIC:HUB|HUB)]|\[HUB:/;

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const ABS_MAX_BYTES_CAP = 1024 * 1024 * 1024;
const ROTATE_CHECK_EVERY_N_APPENDS = 16;

let _appendSeq = 0;

function resolveDebugLogMaxBytes () {
  const raw = process.env.FABRIC_HUB_DEBUG_LOG_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_MAX_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_BYTES;
  if (n === 0) return 0;
  return Math.min(Math.floor(n), ABS_MAX_BYTES_CAP);
}

function hubDebugLogPath (userDataRoot) {
  const root = userDataRoot || process.env.FABRIC_HUB_USER_DATA || process.cwd();
  const def = path.join(root, 'logs', 'hub', 'debug.log');
  const override = process.env.FABRIC_HUB_DEBUG_LOG_FILE;
  if (override && String(override).trim()) {
    const o = String(override).trim();
    if (o.includes('..')) return def;
    const rootAbs = path.resolve(String(root));
    if (path.isAbsolute(o)) {
      const abs = path.resolve(o);
      if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return def;
      return abs;
    }
    const joined = path.resolve(rootAbs, o);
    const rel = path.relative(rootAbs, joined);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return def;
    return joined;
  }
  return def;
}

function shouldAppendLine (formatted) {
  if (process.env.FABRIC_HUB_DEBUG_LOG === 'all') return true;
  return HUB_LINE_RE.test(formatted);
}

/**
 * When the log exceeds the configured max size, rename it to `debug.log.1` (replacing any prior backup).
 * @param {string} filePath
 */
function maybeRotateHubDebugLogFile (filePath) {
  const maxBytes = resolveDebugLogMaxBytes();
  if (maxBytes <= 0 || !filePath) return;
  try {
    let st;
    try {
      st = fs.statSync(filePath);
    } catch (e) {
      if (e && e.code === 'ENOENT') return;
      return;
    }
    if (!st.isFile() || st.size < maxBytes) return;
    const backup = `${filePath}.1`;
    try {
      fs.unlinkSync(backup);
    } catch (e) {
      if (e && e.code !== 'ENOENT') return;
    }
    fs.renameSync(filePath, backup);
  } catch (_e) {
    // Never throw from logging side-channel
  }
}

function appendDebugLine (filePath, level, formatted) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    if ((++_appendSeq % ROTATE_CHECK_EVERY_N_APPENDS) === 0) {
      maybeRotateHubDebugLogFile(filePath);
    }
    const ts = new Date().toISOString();
    fs.appendFileSync(filePath, `${ts} [${level}] ${formatted}\n`, 'utf8');
  } catch (_e) {
    // Never throw from logging side-channel
  }
}

/**
 * @param {{ userDataRoot?: string }} [opts]
 */
function installHubDebugFileLog (opts = {}) {
  if (process.env.FABRIC_HUB_DEBUG_LOG === '0') {
    return { filePath: null, active: false };
  }

  const filePath = hubDebugLogPath(opts.userDataRoot);
  maybeRotateHubDebugLogFile(filePath);

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.error = (...args) => {
    const formatted = util.format(...args);
    if (shouldAppendLine(formatted)) {
      appendDebugLine(filePath, 'ERROR', formatted);
    }
    origError(...args);
  };

  console.warn = (...args) => {
    const formatted = util.format(...args);
    if (shouldAppendLine(formatted)) {
      appendDebugLine(filePath, 'WARN', formatted);
    }
    origWarn(...args);
  };

  return { filePath, active: true };
}

module.exports = {
  installHubDebugFileLog,
  hubDebugLogPath,
  shouldAppendHubDebugLine: shouldAppendLine,
  maybeRotateHubDebugLogFile,
  resolveDebugLogMaxBytes
};
