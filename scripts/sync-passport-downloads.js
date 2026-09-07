#!/usr/bin/env node
'use strict';

/**
 * Copy sibling Passport store zips into `assets/downloads/extension/`.
 *
 *   node scripts/sync-passport-downloads.js
 *   node scripts/sync-passport-downloads.js --zip-dir /path/to/zip
 *   npm run sync:passport-downloads
 */

const path = require('path');
const {
  syncPassportExtensionDownloads,
  defaultPassportZipDir
} = require('../functions/hubDownloadsIndex');

function main () {
  let zipDir = defaultPassportZipDir();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--zip-dir') zipDir = path.resolve(argv[++i]);
    else if (a.startsWith('--zip-dir=')) zipDir = path.resolve(a.slice('--zip-dir='.length));
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/sync-passport-downloads.js [--zip-dir <path>]');
      return;
    } else {
      throw new Error('unknown flag: ' + a);
    }
  }
  const result = syncPassportExtensionDownloads({ passportZipDir: zipDir });
  console.log('[HUB:DOWNLOADS:PASSPORT]', JSON.stringify({ ...result, zipDir }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[HUB:DOWNLOADS:PASSPORT]', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { syncPassportExtensionDownloads, defaultPassportZipDir };
