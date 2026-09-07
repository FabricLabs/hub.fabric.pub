'use strict';

/**
 * Copy electron-builder artifacts into `assets/downloads/` and write `index.json`.
 *
 *   node scripts/sync-downloads-assets.js            # copy dist/ + index
 *   node scripts/sync-downloads-assets.js --index-only
 */

const { syncDownloadsAssets } = require('../functions/hubDownloadsIndex');

function main () {
  const copyDist = process.argv.indexOf('--index-only') < 0;
  const result = syncDownloadsAssets({ copyDist });
  console.log('[HUB:DOWNLOADS]', JSON.stringify(result));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[HUB:DOWNLOADS]', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = { syncDownloadsAssets };
