'use strict';

/**
 * Run the expected bitcoind command and time until RPC is ready.
 * Uses same args as Hub managed regtest; prints elapsed ms then kills bitcoind.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const datadir = path.join(root, 'stores', 'bitcoin-regtest');
const rpcport = 18443;

const BITCOIND_ARGS = [
  '-regtest',
  `-datadir=${datadir}`,
  '-listen=0',
  '-rpcbind=127.0.0.1',
  '-rpcallowip=127.0.0.1',
  `-rpcport=${rpcport}`,
  '-server',
  '-txindex',
  '-fallbackfee=1.0',
  '-maxtxfee=1.1',
  '-dnsseed=0'
];

function runBitcoinCli (args) {
  return new Promise((resolve, reject) => {
    const child = spawn('bitcoin-cli', ['-regtest', `-datadir=${datadir}`, `-rpcport=${rpcport}`, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || out || `exit ${code}`));
    });
    child.on('error', reject);
  });
}

function sleep (ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main () {
  const bitcoind = spawn('bitcoind', BITCOIND_ARGS, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const start = Date.now();
  const timeoutMs = 60000;
  const pollMs = 400;

  bitcoind.stderr.on('data', (d) => process.stderr.write(d));
  bitcoind.on('error', (e) => {
    console.error('bitcoind spawn error:', e.message);
    process.exit(1);
  });

  let ready = false;
  while (Date.now() - start < timeoutMs) {
    try {
      await runBitcoinCli(['getblockchaininfo']);
      ready = true;
      break;
    } catch (_) {
      await sleep(pollMs);
    }
  }

  bitcoind.kill('SIGTERM');

  if (ready) {
    const elapsed = Date.now() - start;
    console.log(`bitcoind RPC ready in ${elapsed}ms`);
  } else {
    console.error('bitcoind did not become ready within', timeoutMs, 'ms');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
