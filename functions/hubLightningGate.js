'use strict';

/**
 * @fileoverview Managed Core Lightning is opt-in. `scripts/hub.js` always sets
 * `lightning.datadir`, which used to make `managed !== false` spawn lightningd
 * every Hub life (10 RPC-sock retries when CLN is not installed).
 */

const { execFileSync } = require('child_process');

/**
 * @param {object} [settings]
 * @returns {boolean}
 */
function shouldStartManagedLightning (settings) {
  const ln = settings && settings.lightning;
  if (!ln || typeof ln !== 'object') return false;
  if (ln.stub === true) return false;
  if (ln.enable === false) return false;
  return ln.managed === true || ln.enable === true;
}

/**
 * True when `lightningd` is on PATH (`which` / `where`). Avoids joining PATH
 * entries into `fs.existsSync` (Codacy Semgrep dynamic-path gate).
 * @returns {boolean}
 */
function lightningdOnPath () {
  const bin = process.platform === 'win32' ? 'lightningd.exe' : 'lightningd';
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, [bin], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  shouldStartManagedLightning,
  lightningdOnPath
};
