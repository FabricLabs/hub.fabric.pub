'use strict';

const defaults = require('./default');

module.exports = Object.assign({}, defaults, {
  alias: '@fabric/hub',
  created: '2017-11-11:00:00.000Z',
  debug: process.env.FABRIC_HUB_DEBUG === 'true' || process.env.FABRIC_HUB_DEBUG === '1',
  mode: process.env.NODE_ENV || 'production',
  bitcoin: {
    network: process.env.FABRIC_BITCOIN_NETWORK || 'regtest',
    managed: process.env.FABRIC_BITCOIN_MANAGED ? process.env.FABRIC_BITCOIN_MANAGED !== 'false' : true,
    rpcport: Number(process.env.FABRIC_BITCOIN_RPC_PORT || 20444),
    startTimeoutMs: Number(process.env.FABRIC_BITCOIN_START_TIMEOUT_MS || 60000),
    /** Optional origin for @fabric/core HTTP fallback (`/services/bitcoin/...`). Unset = RPC only. */
    explorerBaseUrl: process.env.FABRIC_EXPLORER_URL || null,
    p2pAddNodes: [
      // 'hub.fabric.pub:18444'
    ],
    sidechainScan: {
      enable: process.env.FABRIC_SIDECHAIN_SCAN === '1' || process.env.FABRIC_SIDECHAIN_SCAN === 'true',
      opReturnMagicHex: process.env.FABRIC_SIDECHAIN_OP_RETURN_MAGIC || 'fab100',
      watchAddresses: [],
      recordTimelocks: true
    }
  },
  payjoin: {
    enable: process.env.FABRIC_PAYJOIN_ENABLE ? process.env.FABRIC_PAYJOIN_ENABLE !== 'false' : true,
    endpointBasePath: process.env.FABRIC_PAYJOIN_BASE_PATH || '/services/payjoin',
    defaultSessionTTLSeconds: Number(process.env.FABRIC_PAYJOIN_SESSION_TTL_SECONDS || 1800),
    maxOpenSessions: Number(process.env.FABRIC_PAYJOIN_MAX_OPEN_SESSIONS || 256)
  },
  lightning: {
    stub: process.env.FABRIC_LIGHTNING_STUB === 'true' || process.env.FABRIC_LIGHTNING_STUB === '1'
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
  port: process.env.FABRIC_PORT || 7777,
  resources: {
    'Contract': {
      fields: [
        { name: 'id', type: 'String', required: true },
        { name: 'created', type: 'String', required: true },
        { name: 'definition', type: 'String', required: true },
        { name: 'author', type: 'String', required: true }
      ]
    },
    'Document': {
      fields: [
        { name: 'id', type: 'String', required: true },
        { name: 'content', type: 'String', required: true },
        { name: 'created', type: 'String', required: true },
        { name: 'author', type: 'String' }
      ]
    }
  },
  state: {
    contracts: [],
    documents: []
  },
  transparent: false
});
