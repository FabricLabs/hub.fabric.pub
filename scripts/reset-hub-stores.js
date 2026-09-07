'use strict';

/**
 * Wipe Hub first-time-setup stores (CLI + desktop + legacy Electron).
 *
 * Usage:
 *   npm run reset:stores
 *   npm run reset:stores -- --dry-run
 *   npm run reset:stores -- --setup-only
 *
 * Default also removes Bitcoin/Lightning datadirs and logs next to those stores
 * (same as Admin → Self-destruct for the live process). `--setup-only` leaves chain data.
 */

const path = require('path');

const { resetHubStores } = require('../functions/hubStoreReset');

function printHelp () {
  console.log(`Usage:
  node scripts/reset-hub-stores.js [--dry-run] [--setup-only]

  Removes Hub STATE so first-time setup runs again:
    <repo>/stores/hub
    <userData>/stores/hub   (Fabric Hub desktop)
    <Electron>/stores/hub   (legacy unpackaged profile)

  Default also removes Bitcoin/Lightning datadirs and logs under those roots.
  Does not remove binaries/ or stores/hub-test*.

  --dry-run      Print targets; do not delete
  --setup-only   Only stores/hub (leave bitcoin-* / lightning / logs)
  --help         This text

Quit Fabric Hub (and any bitcoind using these datadirs) before a live wipe.
Env: FABRIC_HUB_USER_DATA overrides the desktop writable root.
`);
}

function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }
  const dryRun = argv.includes('--dry-run');
  const setupOnly = argv.includes('--setup-only');
  const unknown = argv.filter((a) => a.startsWith('-') && a !== '--dry-run' && a !== '--setup-only' && a !== '-h' && a !== '--help');
  if (unknown.length) {
    console.error('Unknown flag:', unknown.join(' '));
    printHelp();
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const { results, errors } = resetHubStores({
    repoRoot,
    dryRun,
    setupOnly,
    env: process.env
  });

  const label = dryRun ? '[HUB:RESET] dry-run' : '[HUB:RESET]';
  results.forEach((row) => {
    const extra = row.error ? ` (${row.error})` : '';
    console.log(`${label} ${row.status}\t${row.kind}\t${row.path}${extra}`);
  });
  const removed = results.filter((r) => r.status === 'removed' || r.status === 'would-remove').length;
  const absent = results.filter((r) => r.status === 'absent').length;
  console.log(`${label} ${removed} path(s) ${dryRun ? 'would be removed' : 'removed'}, ${absent} absent, ${errors} error(s).`);
  if (!dryRun && errors === 0) {
    console.log(`${label} Relaunch Hub (\`npm start\` or \`npm run desktop\`) for first-time setup.`);
  }
  process.exit(errors ? 1 : 0);
}

main();
