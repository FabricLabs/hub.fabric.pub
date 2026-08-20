'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STAGING = path.join(ROOT, 'build', '.installer-binaries');

function archName (arch) {
  if (arch === 'arm64' || arch === 3) return 'arm64';
  if (arch === 'x64' || arch === 1) return 'x64';
  if (arch === 'ia32' || arch === 0) return 'ia32';
  return String(arch);
}

/**
 * Copy only the target platform's `binaries/<platform>-<arch>` into extraResources staging.
 * @param {object} context electron-builder BeforePackContext
 * @returns {Promise<void>}
 */
async function beforePack (context) {
  const plat = String(context.electronPlatformName || '');
  const cpu = archName(context.arch);
  const id = `${plat}-${cpu}`;
  const src = path.join(ROOT, 'binaries', id);
  fs.rmSync(STAGING, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });
  fs.writeFileSync(path.join(STAGING, '.keep'), '');
  if (!fs.existsSync(src)) {
    console.warn(`[HUB:INSTALLERS] No binaries/${id} (run npm run binaries:fetch:all); installer will rely on first-time setup downloads.`);
    return;
  }
  const dest = path.join(STAGING, id);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[HUB:INSTALLERS] Bundled binaries/${id} into extraResources.`);
}

module.exports = beforePack;
module.exports.default = beforePack;
