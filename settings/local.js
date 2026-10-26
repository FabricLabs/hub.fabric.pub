'use strict';

const defaults = require('./default');
const beaconFederationRef = require('../contracts/beaconFederation');
const liquidFederation = require('../contracts/liquid');
const contractResources = require('../contracts/resources');

module.exports = Object.assign({}, defaults, {
  alias: '@fabric/hub',
  created: '2017-11-11:00:00.000Z',
  debug: process.env.FABRIC_HUB_DEBUG === 'true' || process.env.FABRIC_HUB_DEBUG === '1',
  mode: process.env.NODE_ENV || 'production',
  beacon: {

  },
  /** Reference / operator federation entries (not the live validator list). See `contracts/`. */
  federations: [beaconFederationRef, liquidFederation],
  bitcoin: {
    /**
     * Set `FABRIC_BITCOIN_ENABLE=false` to skip the Bitcoin service entirely (Hub starts without bitcoind).
     * Used by headless E2E when no Core is available; Payjoin sessions can still be exercised without RPC.
     */
    ...(process.env.FABRIC_BITCOIN_ENABLE === '0' || process.env.FABRIC_BITCOIN_ENABLE === 'false' ? { enable: false } : {}),
    network: process.env.FABRIC_BITCOIN_NETWORK || 'regtest',
    managed: process.env.FABRIC_BITCOIN_MANAGED ? process.env.FABRIC_BITCOIN_MANAGED !== 'false' : true,
    rpcport: Number(process.env.FABRIC_BITCOIN_RPC_PORT || 18443),
    startTimeoutMs: Number(process.env.FABRIC_BITCOIN_START_TIMEOUT_MS || 60000),
    /**
     * Bitcoin service heartbeat (ms). Core default is 60s; with a large Hub wallet
     * overlapping ticks + commit starve the Node event loop so nginx→8080 times out.
     * Override with FABRIC_BITCOIN_INTERVAL_MS.
     */
    interval: Number(process.env.FABRIC_BITCOIN_INTERVAL_MS || 300000),
    /** Optional origin for @fabric/core HTTP fallback (`/services/bitcoin/...`). Unset = RPC only. */
    explorerBaseUrl: process.env.FABRIC_EXPLORER_URL || null,
    /**
     * Playnet / LAN: extra Bitcoin **Core P2P** peers for `addnode` after RPC is up (regtest default port 18444 if omitted).
     * Not Fabric `peers` (7777). Also: `FABRIC_BITCOIN_P2P_ADDNODES=host:port,...`.
     * For **regtest**, the Hub merges `hub.fabric.pub:18444` unless skipPlaynetPeer / FABRIC_BITCOIN_SKIP_PLAYNET_PEER
     * (override host with `FABRIC_BITCOIN_PLAYNET_PEER`). Do not list the playnet seed here on this host —
     * `p2pAddNodes` bypasses skipPlaynetPeer.
     * Mainnet: public `addnode` list is skipped unless `p2pAddNodesAllowMainnet: true` (see @fabric/core Bitcoin).
     */
    p2pAddNodes: [
      // '192.168.50.5:18444'
    ],
    /**
     * This host *is* the playnet seed (`hub.fabric.pub:18444`). Outbound
     * `addnode` to that name connects to self every minute and pairs with
     * Bitcoin RPC hangups that starve Hub HTTP. Opt back in with
     * FABRIC_BITCOIN_SKIP_PLAYNET_PEER=0.
     */
    skipPlaynetPeer: process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER === '0'
      || process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER === 'false'
      ? false
      : true,
    /**
     * Accept inbound Core P2P on the network default port (regtest :18444) so
     * playnet / LAN peers can dial this Hub as a seed. Managed bitcoind maps
     * this to `-listen=1` unless set `false`. Outbound addnode remains separate
     * (`p2pAddNodes` / FABRIC_BITCOIN_SKIP_PLAYNET_PEER).
     */
    listen: true,
    /**
     * Scan each new block (ZMQ tip) for sidechain-related signals — off by default; enable for playnet federation wiring.
     */
    sidechainScan: {
      enable: process.env.FABRIC_SIDECHAIN_SCAN === '1' || process.env.FABRIC_SIDECHAIN_SCAN === 'true',
      opReturnMagicHex: process.env.FABRIC_SIDECHAIN_OP_RETURN_MAGIC || 'fab100',
      watchAddresses: [],
      recordTimelocks: true
    },
    /** `fabfed` OP_RETURN scan → `federations/REGISTRY`. Off here to cut tip RPC load. */
    federationRegistryScan: {
      enable: process.env.FABRIC_FEDERATION_CHAIN_SCAN === '1' || process.env.FABRIC_FEDERATION_CHAIN_SCAN === 'true'
    },
    /**
     * Each new L1 tip (ZMQ): persist a compact block summary as a Document and publish to the hub catalog.
     * Default off on this playnet host until Bitcoin tick/RPC stops wedging HTTP (FABRIC_BITCOIN_DOCUMENT_BLOCKS=1).
     */
    documentBlocks: process.env.FABRIC_BITCOIN_DOCUMENT_BLOCKS === '1' || process.env.FABRIC_BITCOIN_DOCUMENT_BLOCKS === 'true',
    /**
     * Also publish one Fabric Document per transaction in each indexed block (`getblock` verbosity 2).
     * Off by default (large mainnet blocks); enable with FABRIC_BITCOIN_DOCUMENT_TX=1.
     */
    documentTransactions: process.env.FABRIC_BITCOIN_DOCUMENT_TX === '1' || process.env.FABRIC_BITCOIN_DOCUMENT_TX === 'true',
    /**
     * Listed L1 prices for inventory / Document Market (HTLC purchase flow). Set to 0 to omit `purchasePriceSats`.
     */
    documentInventoryBlockPriceSats: Number(process.env.FABRIC_BITCOIN_DOC_BLOCK_PRICE_SATS || 1000),
    documentInventoryTransactionPriceSats: Number(process.env.FABRIC_BITCOIN_DOC_TX_PRICE_SATS || 100),
    /**
     * When non-empty, HTTP watch-only xpub routes that call `scantxoutset` require this shared secret:
     * **`GET /services/bitcoin/xpub`**, **`GET /services/bitcoin/xpub/utxos`**, **`GET /services/bitcoin/xpub/transactions`**
     * (canonical; query **`?xpub=`**), and legacy **`GET /services/bitcoin/wallets/:walletId`** with **`?xpub=`** when `:walletId` ≠ Hub wallet name.
     * Clients: `Authorization: Bearer`, `?apiToken=` / `?xpubQueryToken=`, or `X-Fabric-Xpub-Query-Token`.
     * Empty/unset keeps anonymous xpub queries (local dev / legacy). Non-empty `FABRIC_BITCOIN_XPUB_QUERY_TOKEN` overrides at runtime in `Hub` constructor.
     */
    xpubQueryToken: (process.env.FABRIC_BITCOIN_XPUB_QUERY_TOKEN && String(process.env.FABRIC_BITCOIN_XPUB_QUERY_TOKEN).trim()) || ''
  },
  payjoin: {
    enable: process.env.FABRIC_PAYJOIN_ENABLE ? process.env.FABRIC_PAYJOIN_ENABLE !== 'false' : true,
    endpointBasePath: process.env.FABRIC_PAYJOIN_BASE_PATH || '/services/payjoin',
    defaultSessionTTLSeconds: Number(process.env.FABRIC_PAYJOIN_SESSION_TTL_SECONDS || 1800),
    maxOpenSessions: Number(process.env.FABRIC_PAYJOIN_MAX_OPEN_SESSIONS || 256)
  },
  lightning: {
    /**
     * Production Hub has no `lightningd`. STATE still has LIGHTNING_MANAGED=true
     * (overlays `managed` at boot); stub skips the 10 RPC-sock retries that
     * block the event loop after HTTP `ready`. Set FABRIC_LIGHTNING_STUB=0 to
     * spawn CLN when the binary is actually present.
     */
    stub: process.env.FABRIC_LIGHTNING_STUB === '0' || process.env.FABRIC_LIGHTNING_STUB === 'false'
      ? false
      : true,
    managed: process.env.FABRIC_LIGHTNING_MANAGED === '1' || process.env.FABRIC_LIGHTNING_MANAGED === 'true',
    /**
     * Playnet/regtest default CLN port stays off mainnet's 9735 to avoid collisions.
     * Override with FABRIC_LIGHTNING_PORT when needed.
     */
    port: Number(process.env.FABRIC_LIGHTNING_PORT || 19735)
  },
  http: {
    /**
     * Public hostname for links / Origin (not the Peer dial address).
     * relay.goon.vc production: FABRIC_HUB_HOSTNAME=relay.goon.vc
     */
    hostname: process.env.FABRIC_HUB_HOSTNAME || process.env.HOSTNAME || 'localhost',
    /**
     * HTTP/WebSocket bind. Nginx on this host proxies 127.0.0.1:8080.
     * Override with FABRIC_HUB_INTERFACE (0.0.0.0 for LAN without a reverse proxy).
     */
    interface: process.env.FABRIC_HUB_INTERFACE || process.env.INTERFACE || process.env.FABRIC_HTTP_INTERFACE || '127.0.0.1',
    port: process.env.FABRIC_HUB_PORT || process.env.PORT || 8080
  },
  /** Passed to @fabric/http HTTPServer: optional WebSocket client token (see MESSAGE_TRANSPORT.md). */
  websocket: {
    requireClientToken: process.env.FABRIC_WS_REQUIRE_TOKEN === '1' || process.env.FABRIC_WS_REQUIRE_TOKEN === 'true',
    clientToken: process.env.FABRIC_WS_CLIENT_TOKEN || null
  },
  // Exclusive identity (xprv > seed > mnemonic). Do not copy FABRIC_SEED into mnemonic —
  // Key prefers mnemonic and that diverges from FABRIC_XPRV / fabric setup.
  key: (() => {
    const passphrase = process.env.FABRIC_PASSPHRASE || null;
    try {
      const { keySettingsFromEnv } = require('@fabric/core/functions/fabricKeyMaterial');
      const fromEnv = keySettingsFromEnv(process.env);
      if (fromEnv) return Object.assign({ passphrase }, fromEnv);
    } catch (_) {}
    return {
      mnemonic: process.env.FABRIC_MNEMONIC || null,
      seed: process.env.FABRIC_SEED || null,
      xprv: process.env.FABRIC_XPRV || null,
      xpub: process.env.FABRIC_XPUB || null,
      passphrase
    };
  })(),
  listen: true,
  path: './stores/hub',
  peering: true,
  title: 'hub.fabric.pub',
  /**
   * Fabric Peer (TCP/NOISE) bind address — independent of HTTP `http.interface`.
   * Pin the public NIC for relay.goon.vc:
   *   FABRIC_INTERFACE=65.21.231.149
   * Alias: FABRIC_PEER_INTERFACE. Also resolved at boot via
   * `@fabric/core/functions/fabricListenInterface` in `scripts/hub.js`.
   * Default remains all interfaces (`0.0.0.0`).
   */
  interface: process.env.FABRIC_INTERFACE || process.env.FABRIC_PEER_INTERFACE || '0.0.0.0',
  peers: [
    // Self (`hub.fabric.pub:7777`) omitted — dial filter + peer list must not loop.
    // Port plan: :7777 = hub.fabric.pub + relay.goon.vc; :7778+ = apps (Sensemaker, …).
    // Do not seed `sensemaker.io:7778` (public DNS ≠ this host). Use loopback for local Sensemaker.
    // Note: 136MiB `contract-message-queue/*.json` files were quarantined 2026-09-03 — they were
    // rewritten in a loop (~40GiB I/O) and starved HTTP. Re-adding seeds is safe with empty queues;
    // do not restore the quarantine dir without a drain cap.
    'relay.goon.vc:7777',
    '127.0.0.1:7778'
  ],
  // Public Fabric P2P (hub.fabric.pub DNS → FABRIC_INTERFACE). Primary host port is 7777.
  port: Number(process.env.FABRIC_PORT || 7777),
  resources: contractResources,
  state: {
    contracts: [],
    documents: []
  },
  /**
   * Browser SPA: short dismissible alerts under the top bar (`GET /services/ui-config`).
   * Each item: `{ id, elementName?, message, severity? }` — dismiss sets cookie `elementName=1`
   * and optionally persists id in `HUB_UI_ALERT_DISMISSALS` when an admin token is available.
   */
  ui: {
    alerts: process.env.FABRIC_HUB_ALERTS_TEST === '1' || process.env.FABRIC_HUB_ALERTS_TEST === 'true'
      ? [{
        id: 'browser-test-alert',
        elementName: 'fabric-hub-alert-browser-test',
        message: 'Test alert — dismiss sets a cookie and hides this message.',
        severity: 'warning'
      }]
      : []
  },
  transparent: false
});
