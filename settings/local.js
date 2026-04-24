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
    /** Optional origin for @fabric/core HTTP fallback (`/services/bitcoin/...`). Unset = RPC only. */
    explorerBaseUrl: process.env.FABRIC_EXPLORER_URL || null,
    /**
     * Playnet / LAN: extra Bitcoin **Core P2P** peers for `addnode` after RPC is up (regtest default port 18444 if omitted).
     * Not Fabric `peers` (7777). Also: `FABRIC_BITCOIN_P2P_ADDNODES=host:port,...`.
     * For **regtest**, the Hub always merges `hub.fabric.pub:18444` unless `FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1` (override host with `FABRIC_BITCOIN_PLAYNET_PEER`).
     * Mainnet: public `addnode` list is skipped unless `p2pAddNodesAllowMainnet: true` (see @fabric/core Bitcoin).
     */
    p2pAddNodes: [
      // '192.168.50.5:18444'
    ],
    /**
     * Scan each new block (ZMQ tip) for sidechain-related signals — off by default; enable for playnet federation wiring.
     */
    sidechainScan: {
      enable: process.env.FABRIC_SIDECHAIN_SCAN === '1' || process.env.FABRIC_SIDECHAIN_SCAN === 'true',
      opReturnMagicHex: process.env.FABRIC_SIDECHAIN_OP_RETURN_MAGIC || 'fab100',
      watchAddresses: [],
      recordTimelocks: true
    },
    /** `fabfed` OP_RETURN scan → `federations/REGISTRY` (regtest on unless FABRIC_FEDERATION_CHAIN_SCAN=0). */
    federationRegistryScan: {
      enable: process.env.FABRIC_FEDERATION_CHAIN_SCAN === '0' || process.env.FABRIC_FEDERATION_CHAIN_SCAN === 'false'
        ? false
        : process.env.FABRIC_FEDERATION_CHAIN_SCAN === '1' || process.env.FABRIC_FEDERATION_CHAIN_SCAN === 'true'
          ? true
          : undefined
    },
    /**
     * Each new L1 tip (ZMQ): persist a compact block summary as a Document and publish to the hub catalog.
     * Disable with FABRIC_BITCOIN_DOCUMENT_BLOCKS=0 or `documentBlocks: false`.
     */
    documentBlocks: process.env.FABRIC_BITCOIN_DOCUMENT_BLOCKS === '0' || process.env.FABRIC_BITCOIN_DOCUMENT_BLOCKS === 'false'
      ? false
      : true,
    /**
     * Also publish one Fabric Document per transaction in each indexed block (`getblock` verbosity 2).
     * Off by default (large mainnet blocks); enable with FABRIC_BITCOIN_DOCUMENT_TX=1.
     */
    documentTransactions: process.env.FABRIC_BITCOIN_DOCUMENT_TX === '1' || process.env.FABRIC_BITCOIN_DOCUMENT_TX === 'true',
    /**
     * Listed L1 prices for inventory / Document Market (HTLC purchase flow). Set to 0 to omit `purchasePriceSats`.
     */
    documentInventoryBlockPriceSats: Number(process.env.FABRIC_BITCOIN_DOC_BLOCK_PRICE_SATS || 1000),
    documentInventoryTransactionPriceSats: Number(process.env.FABRIC_BITCOIN_DOC_TX_PRICE_SATS || 100)
  },
  payjoin: {
    enable: process.env.FABRIC_PAYJOIN_ENABLE ? process.env.FABRIC_PAYJOIN_ENABLE !== 'false' : true,
    endpointBasePath: process.env.FABRIC_PAYJOIN_BASE_PATH || '/services/payjoin',
    defaultSessionTTLSeconds: Number(process.env.FABRIC_PAYJOIN_SESSION_TTL_SECONDS || 1800),
    maxOpenSessions: Number(process.env.FABRIC_PAYJOIN_MAX_OPEN_SESSIONS || 256)
  },
  lightning: {
    stub: process.env.FABRIC_LIGHTNING_STUB === 'true' || process.env.FABRIC_LIGHTNING_STUB === '1',
    /**
     * Playnet/regtest default CLN port stays off mainnet's 9735 to avoid collisions.
     * Override with FABRIC_LIGHTNING_PORT when needed.
     */
    port: Number(process.env.FABRIC_LIGHTNING_PORT || 19735)
  },
  http: {
    hostname: process.env.FABRIC_HUB_HOSTNAME || process.env.HOSTNAME || 'localhost',
    interface: process.env.FABRIC_HUB_INTERFACE || process.env.INTERFACE || '0.0.0.0',
    port: process.env.FABRIC_HUB_PORT || process.env.PORT || 8080
  },
  /** Passed to @fabric/http HTTPServer: optional WebSocket client token (see MESSAGE_TRANSPORT.md). */
  websocket: {
    requireClientToken: process.env.FABRIC_WS_REQUIRE_TOKEN === '1' || process.env.FABRIC_WS_REQUIRE_TOKEN === 'true',
    clientToken: process.env.FABRIC_WS_CLIENT_TOKEN || null
  },
  // Optional HTML injection for browser dev: FABRIC_DEV_PUSH_BROWSER_IDENTITY=1|true|force (see services/hub.js).
  key: {
    mnemonic: process.env.FABRIC_MNEMONIC || process.env.FABRIC_SEED || null,
    seed: process.env.FABRIC_SEED || null,
    xprv: process.env.FABRIC_XPRV || null,
    xpub: process.env.FABRIC_XPUB || null,
    passphrase: process.env.FABRIC_PASSPHRASE || null
  },
  listen: true,
  path: './stores/hub',
  peering: true,
  title: 'hub.fabric.pub',
  peers: [
    'hub.fabric.pub:7777',
    'sensemaker.io:7777'
  ],
  port: (() => {
    const n = Number(process.env.FABRIC_PORT);
    return Number.isFinite(n) && n > 0 ? n : 7777;
  })(),
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
