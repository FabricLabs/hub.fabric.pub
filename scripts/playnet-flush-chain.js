'use strict';

/**
 * One-shot playnet helper: connect to Fabric peers and send P2P_FLUSH_CHAIN.
 * Uses flushChainMinTrustedScore=-1 (NOT 0: Peer coerces 0→800 via `|| 800`)
 * so a fresh session can notify connected peers immediately.
 *
 * Usage:
 *   FABRIC_XPRV='…' node scripts/playnet-flush-chain.js <snapshotBlockHash> [peer…]
 *   # or FABRIC_SEED / FABRIC_MNEMONIC
 * Env:
 *   FABRIC_XPRV (preferred), FABRIC_SEED / FABRIC_MNEMONIC
 *   FABRIC_FLUSH_PEERS=host:port,host:port (default relay.goon.vc:7777,hub.fabric.pub:7777)
 *   FABRIC_FLUSH_NETWORK=regtest|playnet
 *   FABRIC_FLUSH_LABEL=optional label
 */

const Peer = require('@fabric/core/types/peer');
const { loadPeerKeySettings } = require('./lib/playnetOps');

async function main () {
  const snapshotBlockHash = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(snapshotBlockHash)) {
    console.error('Usage: node scripts/playnet-flush-chain.js <snapshotBlockHash-64hex> [peer…]');
    process.exit(1);
  }

  const peerKey = loadPeerKeySettings();
  if (!peerKey) {
    console.error('FABRIC_XPRV (preferred) or FABRIC_SEED / FABRIC_MNEMONIC required');
    process.exit(1);
  }

  const peers = (process.argv.slice(3).length
    ? process.argv.slice(3)
    : String(process.env.FABRIC_FLUSH_PEERS || 'relay.goon.vc:7777,hub.fabric.pub:7777')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean));

  const network = String(process.env.FABRIC_FLUSH_NETWORK || 'regtest').trim();
  const label = String(process.env.FABRIC_FLUSH_LABEL || 'local-dev-beacon-emitter').trim();

  const peer = new Peer({
    listen: false,
    networking: true,
    peers,
    key: peerKey,
    // NOTE: Peer uses `Number(threshold) || 800`, so 0 is treated as 800. Use -1 for playnet ops.
    flushChainMinTrustedScore: -1,
    flushChainAuthorizedPubkeys: []
  });

  peer.on('error', (err) => console.error('[flush] peer error', err && err.message ? err.message : err));
  peer.on('warning', (w) => console.warn('[flush] warning', w));
  peer.on('debug', (m) => {
    if (process.env.FABRIC_FLUSH_DEBUG === '1') console.debug('[flush]', m);
  });

  await peer.start();
  console.log('[flush] local pubkey', peer.key && peer.key.pubkey);
  console.log('[flush] peers', peers);
  console.log('[flush] snapshot', snapshotBlockHash);

  // Wait for at least one NOISE connection
  const deadline = Date.now() + Number(process.env.FABRIC_FLUSH_WAIT_MS || 20000);
  while (Date.now() < deadline) {
    const n = Object.keys(peer.connections || {}).length;
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const connIds = Object.keys(peer.connections || {});
  console.log('[flush] connections', connIds);

  const body = { snapshotBlockHash, network, label };
  const notified = peer.sendFlushChainToTrustedPeers(body);
  console.log('[flush] peersNotified', notified, body);
  for (const id of connIds) {
    console.log('[flush] score', id, peer._registryScoreForConnectionAddress(id));
  }

  // Brief observe window for warnings / disconnects
  await new Promise((r) => setTimeout(r, Number(process.env.FABRIC_FLUSH_HOLD_MS || 5000)));

  await peer.stop();
  console.log('[flush] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
