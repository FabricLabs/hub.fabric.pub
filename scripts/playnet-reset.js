'use strict';

/**
 * Reset / realign playnet (regtest) tip across local Core + Fabric flush peers.
 *
 * Usage:
 *   npm run playnet:reset -- [--snapshot <64hex>] [--local] [--no-flush] [peer…]
 *
 * Defaults:
 *   snapshot = local getbestblockhash (use an older common ancestor to rewind remotes)
 *   peers    = FABRIC_PLAYNET_PEERS / relay.goon.vc:7777,hub.fabric.pub:7777
 *
 * Env:
 *   FABRIC_XPRV (preferred), FABRIC_SEED / FABRIC_MNEMONIC
 *   FABRIC_FLUSH_NETWORK, FABRIC_FLUSH_LABEL
 *   FABRIC_BITCOIN_DATADIR, FABRIC_BITCOIN_RPC_PORT
 *   FABRIC_PLAYNET_ADDNODE=host:port  (optional bitcoin-cli addnode before flush)
 */

const path = require('path');
const {
  loadPeerKeySettings,
  playnetPeers,
  runBitcoinCli,
  localFlushToSnapshot
} = require('./lib/playnetOps');

function printHelp () {
  console.log(`Usage:
  npm run playnet:reset -- [--snapshot <64hex>] [--local] [--no-flush] [peer…]

  --snapshot <hash>  Block hash remotes (and optional local) rewind to
  --local            Also invalidate local tip back to snapshot via bitcoin-cli
  --no-flush         Skip P2P_FLUSH_CHAIN broadcast (local-only rewind)
  --addnode <host:port>  bitcoin-cli addnode before flush (repeatable)

Env: FABRIC_MNEMONIC, FABRIC_PLAYNET_PEERS, FABRIC_FLUSH_NETWORK, FABRIC_FLUSH_LABEL
`);
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let snapshot = '';
  let doLocal = false;
  let doFlush = true;
  const addNodes = [];
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snapshot' || a === '-s') {
      snapshot = String(argv[++i] || '').trim().toLowerCase();
    } else if (a === '--local') {
      doLocal = true;
    } else if (a === '--no-flush') {
      doFlush = false;
    } else if (a === '--addnode') {
      addNodes.push(String(argv[++i] || '').trim());
    } else if (a.startsWith('--')) {
      console.error('Unknown flag:', a);
      printHelp();
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  if (process.env.FABRIC_PLAYNET_ADDNODE) {
    addNodes.push(...String(process.env.FABRIC_PLAYNET_ADDNODE).split(',').map((s) => s.trim()).filter(Boolean));
  }

  if (!snapshot) {
    snapshot = String(await runBitcoinCli(['getbestblockhash'])).trim().toLowerCase();
  }
  if (!/^[0-9a-f]{64}$/.test(snapshot)) {
    throw new Error(`invalid snapshotBlockHash: ${snapshot}`);
  }

  const tipBefore = String(await runBitcoinCli(['getbestblockhash'])).trim().toLowerCase();
  const info = await runBitcoinCli(['getblockchaininfo'], { json: true });
  console.log('[playnet:reset] local tip', {
    height: info && info.blocks,
    tip: tipBefore,
    snapshot,
    ibd: info && info.initialblockdownload
  });

  for (const peer of addNodes) {
    console.log('[playnet:reset] addnode', peer);
    try {
      await runBitcoinCli(['addnode', peer, 'add']);
    } catch (e) {
      console.warn('[playnet:reset] addnode failed:', e.message || e);
    }
  }

  if (doFlush) {
    const peerKey = loadPeerKeySettings();
    if (!peerKey) {
      throw new Error('FABRIC_XPRV (preferred) or FABRIC_SEED / FABRIC_MNEMONIC required for Fabric flush');
    }
    const peers = playnetPeers(positional);
    const flushScript = path.join(__dirname, 'playnet-flush-chain.js');
    if (peerKey.xprv) process.env.FABRIC_XPRV = peerKey.xprv;
    if (peerKey.mnemonic) {
      process.env.FABRIC_SEED = process.env.FABRIC_SEED || peerKey.mnemonic;
      process.env.FABRIC_MNEMONIC = process.env.FABRIC_MNEMONIC || peerKey.mnemonic;
    }
    process.env.FABRIC_FLUSH_NETWORK = process.env.FABRIC_FLUSH_NETWORK || 'regtest';
    process.env.FABRIC_FLUSH_LABEL = process.env.FABRIC_FLUSH_LABEL || 'playnet-reset';
    console.log('[playnet:reset] broadcasting P2P_FLUSH_CHAIN →', peers.join(', '));
    // Re-use the dedicated flush script as a child so behavior stays single-sourced.
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const child = spawn(process.execPath, [flushScript, snapshot, ...peers], {
        cwd: path.join(__dirname, '..'),
        env: process.env,
        stdio: 'inherit'
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`playnet-flush-chain exited ${code}`));
      });
      child.on('error', reject);
    });
  }

  if (doLocal) {
    console.log('[playnet:reset] local invalidate →', snapshot);
    const out = await localFlushToSnapshot(snapshot);
    console.log('[playnet:reset] local flush', out);
  }

  const tipAfter = String(await runBitcoinCli(['getbestblockhash'])).trim().toLowerCase();
  const infoAfter = await runBitcoinCli(['getblockchaininfo'], { json: true });
  console.log('[playnet:reset] done', {
    height: infoAfter && infoAfter.blocks,
    tip: tipAfter,
    matchedSnapshot: tipAfter === snapshot
  });
}

main().catch((err) => {
  console.error('[playnet:reset]', err && err.message ? err.message : err);
  process.exit(1);
});
