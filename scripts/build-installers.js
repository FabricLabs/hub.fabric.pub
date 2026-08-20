'use strict';

/**
 * Produce desktop installers for macOS, Windows, and Linux.
 * Prefetch managed node binaries first: `npm run binaries:fetch:all`.
 *
 * Cross-builds from one OS are best-effort (macOS cannot fully codesign Windows;
 * Linux AppImage from mac often works). CI should still run native builders.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const electronBuilder = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

function main () {
  const extra = process.argv.slice(2);
  const args = extra.length
    ? extra.concat(['--publish', 'never'])
    : ['--mac', '--win', '--linux', '--publish', 'never'];
  console.log('[HUB:INSTALLERS] electron-builder', args.join(' '));
  const result = spawnSync(electronBuilder, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true
  });
  if (result.error) {
    console.error('[HUB:INSTALLERS]', result.error.message || result.error);
    process.exit(1);
  }
  const status = result.status == null ? 1 : result.status;
  if (status === 0) {
    try {
      const { syncDownloadsAssets } = require('../functions/hubDownloadsIndex');
      const dl = syncDownloadsAssets({ copyDist: true });
      console.log('[HUB:INSTALLERS] synced assets/downloads', JSON.stringify(dl));
    } catch (syncErr) {
      console.error(
        '[HUB:INSTALLERS] downloads sync failed',
        syncErr && syncErr.message ? syncErr.message : syncErr
      );
      process.exit(1);
    }
  }
  process.exit(status);
}

main();
