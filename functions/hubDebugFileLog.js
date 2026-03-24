'use strict';

/**
 * Append hub-process console.error / console.warn lines to stores/hub/debug.log for operators.
 *
 * - Default: only lines that look like Fabric hub logs (prefix [HUB], [HUB:…], [FABRIC:HUB]).
 * - FABRIC_HUB_DEBUG_LOG=0 — disable file mirror.
 * - FABRIC_HUB_DEBUG_LOG=all — mirror every console.error / console.warn (noisy).
 * - FABRIC_HUB_DEBUG_LOG_FILE — absolute or relative path override (optional).
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const HUB_LINE_RE = /\[(?:FABRIC:HUB|HUB)]|\[HUB:/;

function hubDebugLogPath (userDataRoot) {
  const root = userDataRoot || process.env.FABRIC_HUB_USER_DATA || process.cwd();
  const override = process.env.FABRIC_HUB_DEBUG_LOG_FILE;
  if (override && String(override).trim()) {
    return path.isAbsolute(override)
      ? override
      : path.join(root, override);
  }
  return path.join(root, 'stores', 'hub', 'debug.log');
}

function shouldAppendLine (formatted) {
  if (process.env.FABRIC_HUB_DEBUG_LOG === 'all') return true;
  return HUB_LINE_RE.test(formatted);
}

function appendDebugLine (filePath, level, formatted) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
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
  shouldAppendHubDebugLine: shouldAppendLine
};
