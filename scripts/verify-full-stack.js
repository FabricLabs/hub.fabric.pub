'use strict';

/**
 * Full-stack verification gate (local / RC):
 *   1. `npm run ci` — browser build + unit tests (excludes Puppeteer browser file)
 *   2. Lightning HTTP + bitcoinClient helpers (`test:lightning`)
 *   3. WebRTC bridge + hub RPC (`test:webrtc`)
 *   4. Browser + Payjoin + WebRTC chat + optional L1 contracts (`verify-browser-e2e-suite.js`)
 *
 * L1 JSON-RPC scripts need a running Hub with Bitcoin (regtest) and `FABRIC_HUB_ADMIN_TOKEN`
 * unless steps are skipped. To run everything except on-chain L1 contract scripts:
 *   FABRIC_STACK_SKIP_L1_CONTRACTS=1 node scripts/verify-full-stack.js
 *
 * Chrome: `npx puppeteer browsers install chrome` (see `.github/workflows/e2e-rc.yml`).
 */

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: node scripts/verify-full-stack.js [--skip-l1-contracts]\n`);
  process.exit(0);
}
if (args.includes('--skip-l1-contracts')) {
  process.env.FABRIC_STACK_SKIP_L1_CONTRACTS = '1';
}

const PHASES = [
  { name: 'ci-build-and-unit', command: 'npm', args: ['run', 'ci'] },
  { name: 'lightning-stub-and-client', command: 'npm', args: ['run', 'test:lightning'] },
  { name: 'webrtc-bridge-and-hub', command: 'npm', args: ['run', 'test:webrtc'] },
  { name: 'browser-payjoin-webrtc-l1-suite', command: 'node', args: ['scripts/verify-browser-e2e-suite.js'] }
];

function runPhase (phase) {
  const started = Date.now();
  const res = spawnSync(phase.command, phase.args, {
    stdio: 'inherit',
    encoding: 'utf8',
    env: process.env,
    cwd: require('path').join(__dirname, '..')
  });
  const elapsedMs = Date.now() - started;
  const code = Number.isInteger(res.status) ? res.status : 1;
  return { name: phase.name, exitCode: code, elapsedMs };
}

function main () {
  process.stdout.write('\n=== Fabric Hub — full stack verification ===\n');
  process.stdout.write(`Node: ${process.version}\n`);
  process.stdout.write(`Started: ${new Date().toISOString()}\n`);
  if (process.env.FABRIC_STACK_SKIP_L1_CONTRACTS === '1') {
    process.stdout.write('Note: FABRIC_STACK_SKIP_L1_CONTRACTS=1 — L1 contract JSON-RPC suite omitted.\n');
  }

  const results = [];
  for (const phase of PHASES) {
    process.stdout.write(`\n--- ${phase.name}: ${phase.command} ${phase.args.join(' ')} ---\n`);
    const r = runPhase(phase);
    results.push(r);
    process.stdout.write(`[exit ${r.exitCode}] ${phase.name} (${r.elapsedMs} ms)\n`);
    if (r.exitCode !== 0) {
      process.stdout.write(`\nFull stack stopped: phase "${phase.name}" failed.\n`);
      process.exit(r.exitCode);
    }
  }

  process.stdout.write('\n=== Full stack summary ===\n');
  for (const r of results) {
    process.stdout.write(`- ${r.name}: ok (${r.elapsedMs} ms)\n`);
  }
  process.stdout.write('\nAll phases passed.\n');
  process.exit(0);
}

main();
