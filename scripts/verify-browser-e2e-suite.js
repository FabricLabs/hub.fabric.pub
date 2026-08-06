'use strict';

const { spawnSync } = require('child_process');

/**
 * Integrated browser + service E2E (see AGENTS.md, CONTRACTS.md).
 *
 * - `browser-hub-e2e` uses HUB_E2E=1 (spawns Hub + Puppeteer) — not static assets only.
 * - `contracts-l1-suite` runs storage, execution, document purchase, crowdfund L1 scripts
 *   (needs Hub with Bitcoin + admin token unless steps report blocked-by-token).
 *
 * Skip L1 on-chain suite (e.g. CI without bitcoind):
 *   FABRIC_STACK_SKIP_L1_CONTRACTS=1 node scripts/verify-browser-e2e-suite.js
 */

const SKIP_L1 = process.env.FABRIC_STACK_SKIP_L1_CONTRACTS === '1' || process.env.FABRIC_STACK_SKIP_L1_CONTRACTS === 'true';

const SUITE = [
  { name: 'browser-hub-e2e', command: 'npm', args: ['run', 'test:e2e-browser'], env: { HUB_E2E: '1' } },
  { name: 'payjoin', command: 'npm', args: ['run', 'test:e2e-payjoin'] },
  { name: 'webrtc-chat', command: 'npm', args: ['run', 'test:e2e-webrtc'] },
  ...(SKIP_L1
    ? []
    : [{ name: 'contracts-l1-suite', command: 'npm', args: ['run', 'test:e2e-contracts-l1'] }])
];

const ADMIN_TOKEN_MISSING_RE = /Set FABRIC_HUB_ADMIN_TOKEN \(or FABRIC_ADMIN_TOKEN\)/i;

function runOne (step) {
  const started = Date.now();
  const env = { ...process.env, ...(step.env || {}) };
  const res = spawnSync(step.command, step.args, {
    stdio: 'pipe',
    encoding: 'utf8',
    env
  });

  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  const combined = `${stdout}\n${stderr}`;
  const elapsedMs = Date.now() - started;

  const blockedByToken = ADMIN_TOKEN_MISSING_RE.test(combined);
  const passed = res.status === 0;
  const failed = !passed && !blockedByToken;

  const status = passed ? 'pass' : blockedByToken ? 'blocked-by-token' : 'fail';

  return {
    name: step.name,
    status,
    exitCode: Number.isInteger(res.status) ? res.status : null,
    elapsedMs,
    output: combined
  };
}

function printSectionHeader (title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function main () {
  const results = [];

  printSectionHeader('Browser E2E Suite');
  process.stdout.write(`Node: ${process.version}\n`);
  process.stdout.write(`Started: ${new Date().toISOString()}\n`);
  if (SKIP_L1) {
    process.stdout.write('Skipping contracts-l1-suite (FABRIC_STACK_SKIP_L1_CONTRACTS).\n');
  }

  for (const step of SUITE) {
    process.stdout.write(`\n[run] ${step.name}: ${step.command} ${step.args.join(' ')}\n`);
    if (step.env && Object.keys(step.env).length) {
      process.stdout.write(`[env] ${JSON.stringify(step.env)}\n`);
    }
    const result = runOne(step);
    results.push(result);

    process.stdout.write(`[${result.status}] ${step.name} (${result.elapsedMs} ms)\n`);

    if (result.output.trim()) {
      process.stdout.write(`${result.output}\n`);
    }
  }

  const passCount = results.filter((r) => r.status === 'pass').length;
  const blockedCount = results.filter((r) => r.status === 'blocked-by-token').length;
  const failCount = results.filter((r) => r.status === 'fail').length;

  printSectionHeader('Suite Summary');
  for (const r of results) {
    process.stdout.write(`- ${r.name}: ${r.status} (exit=${r.exitCode}, ${r.elapsedMs} ms)\n`);
  }
  process.stdout.write(`\nTotals: pass=${passCount}, blocked-by-token=${blockedCount}, fail=${failCount}\n`);

  if (failCount > 0) process.exit(1);
  process.exit(0);
}

main();
