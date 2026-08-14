'use strict';

const { spawnSync } = require('child_process');

const BASE_SUITE = [
  { name: 'storage-contract-l1', command: 'npm', args: ['run', 'test:e2e-storage-contract'] },
  { name: 'execution-contract-l1', command: 'npm', args: ['run', 'test:e2e-execution-contract'] },
  { name: 'document-purchase-l1', command: 'npm', args: ['run', 'test:e2e-document-purchase'] },
  { name: 'crowdfund-l1', command: 'npm', args: ['run', 'test:e2e-crowdfund-l1'] }
];

const INCLUDE_EXEC_ANCHOR = process.env.FABRIC_L1_INCLUDE_EXEC_ANCHOR === '1' || process.env.FABRIC_L1_INCLUDE_EXEC_ANCHOR === 'true';

const ADMIN_TOKEN_MISSING_RE = /Set FABRIC_HUB_ADMIN_TOKEN \(or FABRIC_ADMIN_TOKEN\)/i;
const EXPECT_NO_ADMIN = process.env.FABRIC_E2E_EXPECT_NO_ADMIN === '1' || process.env.FABRIC_E2E_EXPECT_NO_ADMIN === 'true';

function runOne (step) {
  const started = Date.now();
  const res = spawnSync(step.command, step.args, {
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env
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

  const suite = BASE_SUITE.map((step) => {
    if (step.name === 'execution-contract-l1' && INCLUDE_EXEC_ANCHOR && !EXPECT_NO_ADMIN) {
      return { name: 'execution-contract-l1-opreturn', command: 'npm', args: ['run', 'test:e2e-execution-anchor'] };
    }
    return step;
  });

  printSectionHeader('L1 Contracts E2E Suite');
  process.stdout.write(`Node: ${process.version}\n`);
  process.stdout.write(`Started: ${new Date().toISOString()}\n`);
  process.stdout.write(`Expect no admin token: ${EXPECT_NO_ADMIN ? 'yes' : 'no'}\n`);
  process.stdout.write(`Execution registry uses OP_RETURN anchor step: ${INCLUDE_EXEC_ANCHOR && !EXPECT_NO_ADMIN ? 'yes' : 'no'}\n`);

  for (const step of suite) {
    process.stdout.write(`\n[run] ${step.name}: ${step.command} ${step.args.join(' ')}\n`);
    const result = runOne(step);
    results.push(result);
    process.stdout.write(`[${result.status}] ${step.name} (${result.elapsedMs} ms)\n`);
    if (result.output.trim()) process.stdout.write(`${result.output}\n`);
  }

  const passCount = results.filter((r) => r.status === 'pass').length;
  const blockedCount = results.filter((r) => r.status === 'blocked-by-token').length;
  const failCount = results.filter((r) => r.status === 'fail').length;

  printSectionHeader('Suite Summary');
  for (const r of results) {
    process.stdout.write(`- ${r.name}: ${r.status} (exit=${r.exitCode}, ${r.elapsedMs} ms)\n`);
  }
  process.stdout.write(`\nTotals: pass=${passCount}, blocked-by-token=${blockedCount}, fail=${failCount}\n`);

  if (EXPECT_NO_ADMIN) {
    const expectedBlocked = suite.length;
    if (blockedCount !== expectedBlocked || passCount !== 0 || failCount !== 0) {
      process.stdout.write(`\nExpected all ${expectedBlocked} checks to be blocked-by-token for non-admin mode.\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (failCount > 0) process.exit(1);
  process.exit(0);
}

main();
