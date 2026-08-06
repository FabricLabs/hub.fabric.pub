'use strict';

/**
 * Run `bitcoin-cli addnode` (or related) against the Hub managed regtest datadir.
 * Matches `scripts/time-bitcoind-startup.js` / Hub defaults: regtest, stores/bitcoin-regtest, rpcport 18443.
 *
 * Usage:
 *   npm run bitcoin:addnode -- <host:port> [add|remove|onetry]
 *   npm run bitcoin:addnode -- list          # getaddednodeinfo
 *   npm run bitcoin:addnode -- peers        # getpeerinfo
 *
 * Env: FABRIC_BITCOIN_DATADIR, FABRIC_BITCOIN_RPC_PORT (default 18443),
 *      FABRIC_BITCOIN_RPC_USER / FABRIC_BITCOIN_RPC_PASSWORD if not using cookie auth.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const datadir = process.env.FABRIC_BITCOIN_DATADIR
  ? path.resolve(process.cwd(), process.env.FABRIC_BITCOIN_DATADIR)
  : path.join(root, 'stores', 'bitcoin-regtest');
const rpcport = String(process.env.FABRIC_BITCOIN_RPC_PORT || 18443);

function buildCliPrefix () {
  const args = ['-regtest', `-datadir=${datadir}`, `-rpcport=${rpcport}`];
  if (process.env.FABRIC_BITCOIN_RPC_USER) {
    args.push(`-rpcuser=${process.env.FABRIC_BITCOIN_RPC_USER}`);
  }
  if (process.env.FABRIC_BITCOIN_RPC_PASSWORD) {
    args.push(`-rpcpassword=${process.env.FABRIC_BITCOIN_RPC_PASSWORD}`);
  }
  return args;
}

function runBitcoinCli (extraArgs) {
  return new Promise((resolve, reject) => {
    const args = [...buildCliPrefix(), ...extraArgs];
    const child = spawn('bitcoin-cli', args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      if (code === 0) {
        process.stdout.write(out);
        resolve();
      } else {
        reject(new Error(err || out || `bitcoin-cli exited ${code}`));
      }
    });
    child.on('error', reject);
  });
}

function printHelp () {
  console.log(`Usage:
  npm run bitcoin:addnode -- <host:port> [add|remove|onetry]   default mode: add
  npm run bitcoin:addnode -- list     getaddednodeinfo
  npm run bitcoin:addnode -- peers     getpeerinfo

Environment (optional):
  FABRIC_BITCOIN_DATADIR   default: <repo>/stores/bitcoin-regtest
  FABRIC_BITCOIN_RPC_PORT  default: 18443
  FABRIC_BITCOIN_RPC_USER / FABRIC_BITCOIN_RPC_PASSWORD

Example (connect two regtest nodes on LAN; P2P is usually port 18444):
  npm run bitcoin:addnode -- 192.168.50.5:18444 add
`);
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const first = argv[0];
  if (first === 'list' || first === 'ls') {
    await runBitcoinCli(['getaddednodeinfo']);
    return;
  }
  if (first === 'peers') {
    await runBitcoinCli(['getpeerinfo']);
    return;
  }

  const looksLikeHost = first.includes(':') || /^\[.+\]/.test(first);
  let peer;
  let mode = 'add';
  if (looksLikeHost) {
    peer = first;
    mode = argv[1] || 'add';
  } else if ((first === 'add' || first === 'remove' || first === 'onetry' || first === 'try') && argv[1]) {
    mode = first === 'try' ? 'onetry' : first;
    peer = argv[1];
  } else {
    console.error('Expected <host:port> or list/peers. Run with --help.\n');
    process.exit(1);
  }

  const m = mode === 'try' ? 'onetry' : mode;
  if (!['add', 'remove', 'onetry'].includes(m)) {
    console.error('Mode must be add, remove, or onetry\n');
    process.exit(1);
  }
  await runBitcoinCli(['addnode', peer, m]);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
