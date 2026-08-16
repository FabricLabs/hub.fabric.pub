'use strict';

/**
 * @fileoverview Managed Core Lightning is opt-in. `scripts/hub.js` always sets
 * `lightning.datadir`, which used to make `managed !== false` spawn lightningd
 * every Hub life (10 RPC-sock retries when CLN is not installed).
 */

const fs = require('fs');
const path = require('path');

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
 * @returns {boolean}
 */
function lightningdOnPath () {
  const pathEnv = process.env.PATH || '';
  const name = process.platform === 'win32' ? 'lightningd.exe' : 'lightningd';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    try {
      if (fs.existsSync(path.join(dir, name))) return true;
    } catch (_) { /* skip unreadable PATH entry */ }
  }
  return false;
}

module.exports = {
  shouldStartManagedLightning,
  lightningdOnPath
};
