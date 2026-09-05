'use strict';

/**
 * Download pinned bitcoind / lightningd into binaries/<platform>/.
 *
 *   node scripts/download-managed-binaries.js
 *   node scripts/download-managed-binaries.js --all
 *   node scripts/download-managed-binaries.js --platform linux-x64
 *   node scripts/download-managed-binaries.js --bitcoin-only
 */

const {
  INSTALLER_PLATFORM_IDS,
  managedBinaryPlatformId,
  installManagedBinaries
} = require('../functions/hubManagedBinaries');

function parseArgs (argv) {
  const out = {
    all: false,
    bitcoin: true,
    lightning: true,
    platformId: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--bitcoin-only') out.lightning = false;
    else if (a === '--lightning-only') out.bitcoin = false;
    else if (a === '--platform' && argv[i + 1]) {
      out.platformId = String(argv[++i]);
    } else if (a.startsWith('--platform=')) {
      out.platformId = a.slice('--platform='.length);
    }
  }
  return out;
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  const platforms = opts.all
    ? INSTALLER_PLATFORM_IDS.slice()
    : [opts.platformId || managedBinaryPlatformId()];

  for (const platformId of platforms) {
    console.log(`[HUB:BINARIES] Installing for ${platformId}…`);
    const result = await installManagedBinaries({
      platformId,
      bitcoin: opts.bitcoin,
      lightning: opts.lightning,
      allowHomebrew: !opts.all,
      onProgress: (ev) => {
        if (ev && ev.phase === 'download' && ev.file && ev.total) {
          const pct = ev.total ? Math.floor((ev.received / ev.total) * 100) : 0;
          process.stdout.write(`\r[HUB:BINARIES] ${ev.file} ${pct}%   `);
        } else if (ev && ev.phase) {
          console.log(`[HUB:BINARIES] ${ev.phase}${ev.component ? ` ${ev.component}` : ''}${ev.message ? `: ${ev.message}` : ''}`);
        }
      }
    });
    process.stdout.write('\n');
    console.log(`[HUB:BINARIES] ${platformId}`, JSON.stringify({
      bitcoin: result.bitcoin,
      lightning: result.lightning
    }));
  }
}

main().catch((err) => {
  console.error('[HUB:BINARIES]', err && err.stack ? err.stack : err);
  process.exit(1);
});
