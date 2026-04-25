'use strict';

// Dependencies
const merge = require('lodash.merge');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const dns = require('dns').promises;

const { resolveAppAssetsDir } = require('@fabric/http');

/** Read-only static root (see `resolveAppAssetsDir` on `@fabric/http`). */
function hubAssetsDir () {
  return resolveAppAssetsDir(__dirname, { envVar: 'FABRIC_HUB_APP_ROOT' });
}

/** Writable store root (Electron: FABRIC_HUB_USER_DATA). */
function hubStoreRoot () {
  return process.env.FABRIC_HUB_USER_DATA || process.cwd();
}

/**
 * Resolve an absolute path under the writable store root.
 * @param {string} p
 * @returns {string}
 */
function resolveStorePath (p) {
  if (!p) return hubStoreRoot();
  return path.isAbsolute(p) ? p : path.resolve(hubStoreRoot(), p);
}
const bs58check = require('bs58check');
const bitcoinCoreMessage = require('../functions/bitcoinCoreMessage');
const { SATS_PER_BTC } = require('../constants');

// Fabric Types
const Chain = require('@fabric/core/types/chain'); // fabric chains
const Collection = require('@fabric/core/types/collection');
const Contract = require('@fabric/core/types/contract');
const Filesystem = require('@fabric/core/types/filesystem');
const Key = require('@fabric/core/types/key'); // fabric keys
const Logger = require('@fabric/core/types/logger');
const Message = require('@fabric/core/types/message');
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');
const Token = require('@fabric/core/types/token'); // fabric tokens
const Worker = require('@fabric/core/types/worker');
const Actor = require('@fabric/core/types/actor');
const Entity = require('@fabric/core/types/entity');
const Tree = require('@fabric/core/types/tree');
const Bitcoin = require('@fabric/core/services/bitcoin');
const Lightning = require('@fabric/core/services/lightning');
const Beacon = require('../contracts/beacon');
const PayjoinService = require('../services/payjoin');
const EmailService = require('../services/email');
const PeeringService = require('../services/peering');
const ChallengeService = require('../services/challenge');
const { isHttpSharedModeEnabled } = require('../functions/httpSharedMode');
const { mergeFabricPeersWithWebRtcRegistry } = require('../functions/mergeFabricPeersWithWebRtcRegistry');
const hubCollaboration = require('../functions/hubCollaboration');

// Fabric HTTP
const HTTPServer = require('@fabric/http/types/server');
const FabricDistributedExecutionHTTP = require('../functions/fabricDistributedExecutionHttp');
const DistributedExecution = require('../functions/fabricDistributedExecution');
const {
  P2P_PEERING_OFFER,
  P2P_PEER_GOSSIP,
  MAX_PEERS,
  HEADER_SIZE,
  P2P_CHAIN_SYNC_REQUEST
} = require('@fabric/core/constants');

// Hard limits and validation patterns
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8 MiB per document/file payload
const FABRIC_BITCOIN_BLOCK_DOC_MIME = 'application/x-fabric-bitcoin-block+json';
const FABRIC_BITCOIN_TX_DOC_MIME = 'application/x-fabric-bitcoin-transaction+json';
/** Skip per-tx Fabric documents when a block has more than this many txs (mainnet safety). */
const BITCOIN_TX_DOC_INDEX_MAX_TXS = 2000;
const DEFAULT_DISTRIBUTE_FEE_SATS = Number(process.env.FABRIC_DISTRIBUTE_FEE_SATS || 1000);
const MAX_ADDRESS_LENGTH = 256;
const PEER_ADDRESS_RE = /^[^:]+:\d+$/;
const P2P_FILE_CHUNK_BYTES = 1024 * 1024; // exact 1 MiB binary chunks
const P2P_FILE_CHUNK_TTL_MS = 10 * 60 * 1000; // expire incomplete inbound transfers after 10 minutes
const FABRIC_PEERING_OFFER_INTERVAL_MS = Number(process.env.FABRIC_PEERING_OFFER_INTERVAL_MS || 30000);
const INVENTORY_HTLC_MAX_SETTLEMENTS = 2000;
const INVENTORY_HTLC_TTL_MS = 48 * 3600 * 1000;
/** Max Fabric hops for relayed P2P_FILE_SEND chunks (per chunk, decremented each forward). */
const INVENTORY_FILE_RELAY_TTL = 8;
/** Max WebRTC→Fabric relay hops (envelope.hops length) before refusing to fan out. */
const WEBRTC_RELAY_MAX_HOPS = Number(process.env.FABRIC_WEBRTC_RELAY_MAX_HOPS || 32);
/** Per WebRTC peer id: max RelayFromWebRTC fan-outs per second (DoS guard). */
const WEBRTC_RELAY_MAX_PER_SEC = Number(process.env.FABRIC_WEBRTC_RELAY_MAX_PER_SEC || 48);
const WORK_QUEUE_STRATEGIES = new Set(['highest_value_first', 'fifo', 'oldest_high_value_first']);
const inventoryHtlc = require('../functions/inventoryHtlc');
const txContractLabels = require('../functions/txContractLabels');
const psbtFabric = require('../functions/psbtFabric');
const contractProposalExchange = require('../functions/contractProposalExchange');
const { runExecutionProgram } = require('../functions/fabricExecutionMachine');
const { computeExecutionRunCommitmentHex } = require('../functions/executionRunCommitment');
const { anchorExecutionCommitmentRegtest } = require('../functions/bitcoinExecutionAnchor');
const { validateEnvelopeV1, buildGenericMessageFromEnvelope } = require('../functions/fabricMessageEnvelope');
const inventoryRelay = require('../functions/inventoryRelay');
const publishedDocumentEnvelope = require('../functions/publishedDocumentEnvelope');
const sidechainState = require('../functions/sidechainState');
const documentOfferEscrow = require('../functions/documentOfferEscrow');
const federationContractInvite = require('../functions/federationContractInvite');
const federationVault = require('../functions/federationVault');
const federationRegistry = require('../functions/federationRegistry');
const crowdfundingTaproot = require('../functions/crowdfundingTaproot');
const { DOCUMENT_OFFER } = require('../functions/messageTypes');

// Hub Services
const Fabric = require('../services/fabric');
const SetupService = require('../services/setup');
const { mountFabricDesktopAuthHttp } = require('../functions/fabricDesktopAuth');
const {
  mountFabricDelegationHttp,
  postDelegationSignatureMessage,
  getDelegationSignatureMessage,
  resolveDelegationSignatureMessage
} = require('../functions/fabricDelegation');
// const Queue = require('../types/queue');

// Routes (Request Handlers)
const ROUTES = require('../routes');

/**
   * Defines the Hub service, known as `@fabric/hub` within the network.
   *
   * NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket JSONCall
   * and HTTP `POST /services/rpc`) without authentication. It is intended to run in
   * trusted or development environments. Do not expose a Hub instance
   * directly to untrusted networks without an appropriate proxy, firewall,
   * or additional auth layer in front of it.
 */
class Hub extends Service {
  /**
   * Create an instance of the {@link Hub} service.
   * @param {Object} [settings] Settings for the Hub instance.
   * @returns {Hub} Instance of the {@link Hub}.
   */
  constructor (settings = {}) {
    super(settings);

    // Settings
    // TODO: extract defaults to `settings/default.json`
    this.settings = merge({
      alias: '@fabric/hub',
      crawl: false,
      clock: 0,
      debug: false,
      seed: null,
      port: 7777,
      // Persistent peer registry (LevelDB) enabled by default.
      // Override with FABRIC_HUB_PEERS_DB if a custom path is needed.
      peersDb: process.env.FABRIC_HUB_PEERS_DB || ((process.env.NODE_ENV === 'test') ? null : 'stores/hub/peers'),
      precision: 8, // precision in bits for floating point compression
      persistent: true,
      path: './logs/hub.fabric.pub',
      frequency: 0.01, // Hz (once every ~100 seconds)
      fs: {
        path: `stores/hub`
      },
      http: {
        hostname: 'localhost',
        listen: true,
        port: 8080
      },
      routes: [
        // TODO: define all resource routes at the Resource level
        { method: 'POST', route: '/contracts', handler: ROUTES.contracts.create.bind(this) },
        { method: 'GET', route: '/contracts', handler: ROUTES.contracts.list.bind(this) },
        { method: 'GET', route: '/contracts/:id', handler: ROUTES.contracts.view.bind(this) },
        { method: 'POST', route: '/documents', handler: ROUTES.documents.create.bind(this) },
        { method: 'GET', route: '/documents', handler: ROUTES.documents.list.bind(this) },
        { method: 'GET', route: '/documents/:id', handler: ROUTES.documents.view.bind(this) },
        { method: 'POST', route: '/peers', handler: ROUTES.peers.create.bind(this) },
        { method: 'GET', route: '/peers', handler: ROUTES.peers.list.bind(this) },
        { method: 'GET', route: '/peers/:id', handler: ROUTES.peers.view.bind(this) }
      ],
      commitments: [],
      constraints: {
        tolerance: 100, // 100ms
        memory: {
          max: Math.pow(2, 26) // ~64MB RAM
        },
        relay: {
          relayTtlDefault: Number(process.env.FABRIC_RELAY_TTL_DEFAULT || 8),
          maxPerSecPerPeer: Number(process.env.FABRIC_RELAY_MAX_PER_SEC || 24),
          maxDedupEntries: Number(process.env.FABRIC_RELAY_MAX_DEDUP || 50000)
        }
      },
      agents: null,
      services: [
        'bitcoin'
      ],
      bitcoin: {
        enable: true,
        mode: 'rpc',
        managed: false,
        network: process.env.FABRIC_BITCOIN_NETWORK || (process.env.NODE_ENV === 'test' ? 'regtest' : 'mainnet'),
        host: process.env.FABRIC_BITCOIN_HOST || '127.0.0.1',
        rpcport: Number(process.env.FABRIC_BITCOIN_RPC_PORT || 8332),
        /** Managed bitcoind: accept inbound P2P on the network’s default port unless set to `false` (tests use custom ports + `listen: false`). */
        listen: true,
        username: process.env.FABRIC_BITCOIN_USERNAME || process.env.BITCOIN_RPC_USER || '',
        password: process.env.FABRIC_BITCOIN_PASSWORD || process.env.BITCOIN_RPC_PASS || '',
        debug: false,
        startTimeoutMs: Number(process.env.FABRIC_BITCOIN_START_TIMEOUT_MS || 10000)
      },
      payjoin: {
        enable: process.env.FABRIC_PAYJOIN_ENABLE ? process.env.FABRIC_PAYJOIN_ENABLE !== 'false' : true,
        endpointBasePath: process.env.FABRIC_PAYJOIN_BASE_PATH || '/services/payjoin',
        defaultSessionTTLSeconds: Number(process.env.FABRIC_PAYJOIN_SESSION_TTL_SECONDS || 1800),
        maxOpenSessions: Number(process.env.FABRIC_PAYJOIN_MAX_OPEN_SESSIONS || 256),
        beaconFederationXOnlyHex: String(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX || '')
      },
      email: {
        enable: process.env.FABRIC_EMAIL_ENABLE === 'true' || process.env.FABRIC_EMAIL_ENABLE === '1',
        transport: process.env.FABRIC_EMAIL_TRANSPORT || null,
        host: process.env.FABRIC_EMAIL_SMTP_HOST || null,
        port: Number(process.env.FABRIC_EMAIL_SMTP_PORT || 587),
        secure: process.env.FABRIC_EMAIL_SMTP_SECURE === '1' || process.env.FABRIC_EMAIL_SMTP_SECURE === 'true',
        requireTLS: process.env.FABRIC_EMAIL_SMTP_REQUIRE_TLS === '1' || process.env.FABRIC_EMAIL_SMTP_REQUIRE_TLS === 'true',
        ignoreTLS: process.env.FABRIC_EMAIL_SMTP_IGNORE_TLS === '1' || process.env.FABRIC_EMAIL_SMTP_IGNORE_TLS === 'true',
        auth: (process.env.FABRIC_EMAIL_SMTP_USER || '')
          ? { user: process.env.FABRIC_EMAIL_SMTP_USER, pass: process.env.FABRIC_EMAIL_SMTP_PASS || '' }
          : null,
        key: process.env.FABRIC_EMAIL_POSTMARK_KEY || null,
        defaultFrom: process.env.FABRIC_EMAIL_FROM || null
      },
      peering: {
        enable: process.env.FABRIC_PEERING_ENABLE ? process.env.FABRIC_PEERING_ENABLE !== 'false' : true,
        endpointBasePath: process.env.FABRIC_PEERING_BASE_PATH || '/services/peering'
      },
      challenge: {
        enable: process.env.FABRIC_CHALLENGE_ENABLE ? process.env.FABRIC_CHALLENGE_ENABLE !== 'false' : true,
        persistPath: process.env.FABRIC_CHALLENGE_PERSIST_PATH || 'fabric/storage-challenges.json'
      },
      distributed: {
        enable: process.env.FABRIC_DISTRIBUTED_HTTP_ENABLE ? process.env.FABRIC_DISTRIBUTED_HTTP_ENABLE !== 'false' : true,
        programId: process.env.FABRIC_DISTRIBUTED_PROGRAM_ID || '@fabric/hub',
        programHash: process.env.FABRIC_DISTRIBUTED_PROGRAM_HASH || null,
        federation: {
          threshold: Math.max(1, Number(process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD || 1)),
          validators: []
        }
      },
      beacon: {
        enable: true,
        // Regtest: 1 block per 10 min. Non-regtest: 1 event per block (block-listener mode).
        interval: Number(process.env.FABRIC_BEACON_INTERVAL_MS || 600000),
        regtestOnly: false
      },
      lightning: {
        // Stub mode: return available + fake create/decode/pay for UI testing.
        stub: process.env.FABRIC_LIGHTNING_STUB === 'true' || process.env.FABRIC_LIGHTNING_STUB === '1'
      },
      state: {
        status: 'INITIALIZED',
        agents: {},
        collections: {
          documents: {},
          contracts: {},
          messages: {},
          chain: {}
        },
        counts: {
          documents: 0,
          messages: 0
        },
        services: {
          bitcoin: {},
          payjoin: {
            available: false,
            sessions: 0
          },
          email: {
            enabled: false,
            configured: false,
            transport: null
          },
          peering: {
            available: false
          },
          challenge: {
            available: false,
            count: 0
          }
        }
      },
      crawlDelay: 2500,
      interval: 86400 * 1000,
      shutdownTimeoutMs: Number(process.env.FABRIC_HUB_SHUTDOWN_TIMEOUT_MS || 10000),
      verbosity: 2,
      verify: true,
      workers: 1,
      distributeFeeSats: DEFAULT_DISTRIBUTE_FEE_SATS,
    }, settings);

    // Test stability: avoid default outbound Fabric dials unless a test explicitly
    // opts in by passing `settings.peers` or setting FABRIC_TEST_ALLOW_DEFAULT_PEERS=1.
    const runningUnderMocha = Array.isArray(process.argv) && process.argv.some((arg) => /mocha/i.test(String(arg)));
    if ((process.env.NODE_ENV === 'test' || runningUnderMocha) && process.env.FABRIC_TEST_ALLOW_DEFAULT_PEERS !== '1') {
      const hasExplicitPeers = !!(settings && Object.prototype.hasOwnProperty.call(settings, 'peers'));
      if (!hasExplicitPeers) this.settings.peers = [];
    }

    // Regtest runs in one autonomous mode: managed local bitcoind, unless setup chose external.
    const inputBitcoin = settings && settings.bitcoin ? settings.bitcoin : {};
    const rpcportProvided = Object.prototype.hasOwnProperty.call(inputBitcoin, 'rpcport');
    if (this.settings.bitcoin && this.settings.bitcoin.network === 'regtest' && this.settings.bitcoin.managed !== false) {
      this.settings.bitcoin.managed = true;
      if (!rpcportProvided) this.settings.bitcoin.rpcport = 18443;
    }

    // Vector Clock
    this.clock = this.settings.clock;

    // Root Key
    this._rootKey = new Key(this.settings.key);

    // Internals
    this.agent = new Peer(this.settings);
    this._installFabricChainSyncRequestBridge();
    /** fromPeerId → { count, windowStart } for RelayFromWebRTC rate limiting */
    this._webrtcRelayRate = new Map();
    this.chain = new Chain(this.settings);
    this.audits = new Logger(this.settings);

    // Collections
    this.actors = new Collection({ name: 'Actors' });
    this.feeds = new Collection({ name: 'Feeds '});
    this.messages = new Collection({ name: 'Messages' });
    this.objects = new Collection({ name: 'Objects' });
    this.sources = new Collection({ name: 'Sources' });

    // Fabric Setup
    this._fabric = {
      ephemera: this._rootKey,
      token: new Token({ issuer: this._rootKey })
    };

    // Fabric
    this.fabric = new Fabric(this.settings.fabric);
    this.bitcoin = null;
    this.lightning = null;
    this.payjoin = null;
    this.challenge = null;
    this._lightningRpcQueue = Promise.resolve();
    this._bitcoinStatusCache = { value: null, updatedAt: 0 };
    this._bitcoinCacheTTL = 15000;
    /** Dedupe concurrent scantxoutset scans by descriptor set. */
    this._bitcoinScanInflight = new Map();
    /** Dedupe Activity stream + P2P BitcoinBlock gossip when the same tip is signaled more than once. */
    this._lastBitcoinBlockActivityTip = null;
    /** Per-peer cooldown for requesting mainchain inventory over Fabric. */
    this._mainchainInventoryRequestCooldown = new Map();
    /** Dedupe in-flight block-sync requests by `peer|hash`. */
    this._pendingMainchainBlockSyncRequests = new Set();
    // Pending pay-to-distribute requests: documentId -> { address, amountSats, config, createdAt }
    this._distributeRequests = {};
    // Pending execution registry invoices: programDigest (64 hex) -> { address, amountSats, program, name?, createdAt }
    this._executionRegistryRequests = {};
    // Pending HTLC purchase requests: documentId -> { address, amountSats, contentHash, createdAt }
    this._purchaseRequests = {};

    // Best-effort Bitcoin service initialization. The Hub keeps running even
    // when bitcoind is offline, but exposes status/errors via the upstream API.
    if (this.settings.bitcoin && this.settings.bitcoin.enable !== false) {
      try {
        const zmqPort = Number(this.settings.bitcoin.zmqPort || 29500);
        this.bitcoin = new Bitcoin({
          ...this.settings.bitcoin,
          p2pAddNodes: this._bitcoinP2pAddNodesList(),
          p2pAddNodesAllowMainnet: !!(this.settings.bitcoin && this.settings.bitcoin.p2pAddNodesAllowMainnet),
          debug: this.settings.bitcoin.debug !== undefined ? this.settings.bitcoin.debug : !!this.settings.debug,
          key: { xprv: this._rootKey.xprv },
          // Managed: P2P listen on default network port unless `bitcoin.listen: false` (integration tests use ephemeral ports).
          // Regtest: disable DNS seeds unless extras override.
          ...(this.settings.bitcoin.managed
            ? {
              listen: this.settings.bitcoin.listen !== false,
              ...(this.settings.bitcoin.network === 'regtest'
                ? {
                    bitcoinExtraParams: ['-dnsseed=0'].concat(
                      Array.isArray(this.settings.bitcoin.bitcoinExtraParams)
                        ? this.settings.bitcoin.bitcoinExtraParams
                        : []
                    )
                  }
                : {})
            }
            : {}),
          // ZMQ for real-time block/tx notifications (bitcoind started with -zmqpubhashblock etc. on this port)
          ...(this.settings.bitcoin.managed ? { zmq: { host: '127.0.0.1', port: zmqPort } } : {})
        });
        // Managed regtest: single RPC probe candidate and shorter wait-for-RPC polling so we fit within startTimeoutMs
        if (this.settings.bitcoin.managed && this.settings.bitcoin.network === 'regtest') {
          const rpcport = Number(this.settings.bitcoin.rpcport || 18443);
          this.bitcoin._buildRPCProbeCandidates = function () {
            return [{ host: '127.0.0.1', rpcport, source: 'hub', network: 'regtest' }];
          };
          const timeoutMs = Math.max(5000, Number(this.settings.bitcoin.startTimeoutMs || 15000) - 2000);
          const intervalMs = 400;
          const maxDelayMs = 2000;
          const maxAttempts = Math.max(10, Math.floor(timeoutMs / intervalMs));
          const bitcoin = this.bitcoin;
          bitcoin._waitForBitcoind = async function (attempts = maxAttempts, initialDelay = intervalMs) {
            let delay = initialDelay;
            const backoff = (d) => Math.min(d * 1.5, maxDelayMs);
            const errText = (e) => {
              if (!e) return String(e);
              if (typeof e === 'object' && e.message) return e.code != null ? `[${e.code}] ${e.message}` : e.message;
              if (typeof e === 'object') return JSON.stringify(e);
              return String(e);
            };
            for (let i = 0; i < attempts; i++) {
              try {
                await this._makeRPCRequest('getblockchaininfo', []);
                return true;
              } catch (e) {
                const msg = errText(e);
                this.emit('debug', `[FABRIC:BITCOIN] RPC attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms: ${msg}`);
                if (i === attempts - 1) {
                  this.emit('warning', `[FABRIC:BITCOIN] bitcoind not ready after ${attempts} attempts: ${msg}`);
                  return false;
                }
                await new Promise(r => setTimeout(r, delay));
                delay = backoff(delay);
              }
            }
            return false;
          };
        }
      } catch (err) {
        console.warn('[HUB] Bitcoin service init failed:', err && err.message ? err.message : err);
        this.bitcoin = null;
      }
    }

    this.payjoin = new PayjoinService({
      ...this.settings.payjoin,
      network: (this.settings.bitcoin && this.settings.bitcoin.network) || 'mainnet'
    });

    this.email = null;
    if (this.settings.email && this.settings.email.enable) {
      this.email = new EmailService({
        name: 'EmailService',
        transport: this.settings.email.transport,
        host: this.settings.email.host,
        port: this.settings.email.port,
        secure: this.settings.email.secure,
        requireTLS: this.settings.email.requireTLS,
        ignoreTLS: this.settings.email.ignoreTLS,
        auth: this.settings.email.auth,
        key: this.settings.email.key
      });
    }

    this.peering = new PeeringService({
      ...this.settings.peering
    });

    this.challenge = new ChallengeService({
      ...this.settings.challenge
    });

    this.distributedHttp = new FabricDistributedExecutionHTTP({
      basePath: '/services/distributed',
      getManifest: () => this._getDistributedManifestJson(),
      getEpochStatus: () => this._getDistributedEpochJson()
    });

    this.beacon = new Beacon({
      name: 'HUB:BEACON',
      debug: !!this.settings.debug,
      interval: Number(this.settings.beacon && this.settings.beacon.interval ? this.settings.beacon.interval : 600000),
      regtest: true,
      key: {
        xprv: this._rootKey.xprv,
        xpub: this._rootKey.xpub
      }
    });

    // File Uploads
    // TODO: check for vulnerabilities, easy setup
    // this.uploader = new multer({ dest: this.settings.files.path });

    // Internals
    this.agents = {};
    this.healths = {};
    this._operatorHealthSamples = [];
    this._operatorCpuSample = null;
    this._workQueueStrategy = 'highest_value_first';
    this.services = {};
    this.sources = {};
    this.workers = [];
    this.worker = null;
    this._workQueue = [];
    this._workQueueById = new Set();
    this._workQueueBusy = false;
    this._workQueueTimer = null;
    this._stopPromise = null;
    /** Inventory L1 HTLC settlement state (seller-side). */
    /** @type {Map<string, Object>} */
    this._inventoryHtlcById = new Map();
    /** Taproot crowdfunding campaigns (persisted under bitcoin/crowdfunding.json). */
    /** @type {Map<string, Object>} */
    this._crowdfundingCampaigns = new Map();
    this._crowdfundingLoaded = false;
    /** Pending browser ↔ Fabric Hub desktop login sessions (see functions/fabricDesktopAuth.js). */
    /** @type {Map<string, Object>} */
    this._desktopAuthSessions = new Map();
    /** @type {Map<string, Object>} */
    this._delegationRegistry = new Map();
    /** @type {Map<string, Object>} */
    this._delegationSignatureMessages = new Map();
    /** Set during `POST /services/rpc` dispatch from `req.socket.remoteAddress` (loopback vs LAN). Reserved for policy; not currently read. */
    this._rpcHttpIsLocal = false;
    this.changes = new Logger({
      name: 'hub.fabric.pub',
      path: path.join(hubStoreRoot(), 'stores')
    });

    // Pipeline Datasources
    this.datasources = {
      bitcoin: { name: 'Bitcoin' }
    };

    // Fabric
    this.contract = new Contract({
      state: this.settings.state,
      key: {
        xprv: this._rootKey.xprv
      }
    });

    // Storage and Network
    this.fs = new Filesystem({ ...this.settings.fs, key: { xprv: this._rootKey.xprv } });
    this.setup = new SetupService({ fs: this.fs, key: this._rootKey, state: this._state.content });
    /** Sidechain global document + logical clock ({ version, clock, content }); see functions/sidechainState.js */
    this._sidechainState = sidechainState.loadState(this.fs);
    /** Serialize beacon reorg handling so sidechain rewind completes before downstream refresh. */
    this._beaconReorgChain = Promise.resolve();

    // HTTP Server
    this.http = new HTTPServer({
      name: 'hub.fabric.pub',
      path: hubAssetsDir(),
      // Fomantic **Fabric** theme: built in `@fabric/http` and served from its `assets/` (second static root).
      // Use `npm run link:fabric` so `node_modules/@fabric/http` is your local clone; `npm run build:semantic` there
      // when you change the theme. Keep Hub `assets/` free of duplicate `semantic*.css`
      // / `themes/` or they would shadow the package.
      hostname: this.settings.http.hostname,
      interface: this.settings.http.interface,
      port: this.settings.http.port,
      // Serve assets/index.html for client-side routes (React Router) on refresh; see @fabric/http _maybeServeSpaShell.
      spaFallback: this.settings.http && this.settings.http.spaFallback !== false,
      websocket: this.settings.websocket || {},
      middlewares: {
        securityHeaders: (req, res, next) => {
          res.setHeader('X-Frame-Options', 'SAMEORIGIN');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          next();
        }
      },
      // TODO: use Fabric Resources; routes and components will be defined there
      resources: {
        Contract: {
          route: '/contracts',
          type: Entity,
          components: {
            list: 'ContractHome',
            view: 'ContractView'
          }
        },
        Document: {
          route: '/documents',
          type: Entity,
          components: {
            list: 'DocumentHome',
            view: 'DocumentView'
          }
        },
        Index: {
          route: '/',
          type: Entity,
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        },
        Session: {
          route: '/sessions',
          type: Entity,
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        },
        Settings: {
          route: '/settings',
          type: Entity,
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        },
        Service: {
          route: '/services',
          type: Entity,
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        }
      },
      routes: this.settings.routes,
      sessions: false
    });

    // State
    this._state = {
      clock: this.settings.clock,
      actors: {},
      agents: {},
      audits: {},
      epochs: [],
      messages: {},
      objects: {},
      content: this.settings.state,
      contracts: [],
      documents: {},
      status: 'PAUSED'
    };

    this.buffers = {};

    return this;
  }

  /**
   * Validate document/file buffer size. Returns error object or null if valid.
   * @param {Buffer|Uint8Array} buf
   * @returns {{ status: 'error', message: string }|null}
   */
  _validateDocumentSize (buf) {
    if (!buf || buf.length > MAX_DOCUMENT_BYTES) {
      return { status: 'error', message: `document too large (max ${MAX_DOCUMENT_BYTES} bytes)` };
    }
    return null;
  }

  /**
   * Normalize and validate an incoming peer address or id-style input.
   * Returns `{ idOrAddress, address }` where `address` may be `null` if
   * resolution is deferred to the Peer implementation.
   */
  _normalizePeerInput (input) {
    if (!input) return { idOrAddress: null, address: null };
    const idOrAddress = (typeof input === 'object')
      ? (input.address || input.id || null)
      : String(input);

    if (!idOrAddress || typeof idOrAddress !== 'string') {
      return { idOrAddress: null, address: null };
    }

    if (idOrAddress.length > MAX_ADDRESS_LENGTH) {
      return { idOrAddress: null, address: null };
    }

    return { idOrAddress, address: null };
  }

  /**
   * Best-effort conversion to a concrete `host:port` address, falling back
   * to the original value when the agent does not expose a resolver.
   */
  _resolvePeerAddress (idOrAddress) {
    if (!idOrAddress) return null;
    const value = (typeof idOrAddress === 'object')
      ? (idOrAddress.address || idOrAddress.id || null)
      : String(idOrAddress);

    if (!value || value.length > MAX_ADDRESS_LENGTH) return null;

    if (typeof this.agent._resolveToAddress === 'function') {
      return this.agent._resolveToAddress(value);
    }

    return value;
  }

  /**
   * True when the Fabric session at `connectionAddress` belongs to `fabricPeerId`
   * (so P2P_FILE_SEND can use that connection for inventory HTLC phase 2).
   * Relay hops do not satisfy this — use `requesterFabricId` + direct peering instead.
   */
  _originConnectionIsFabricPeer (connectionAddress, fabricPeerId) {
    if (!connectionAddress || !fabricPeerId) return false;
    const want = String(fabricPeerId);
    if (this.agent._addressToId && String(this.agent._addressToId[connectionAddress]) === want) return true;
    const p = this.agent.peers && this.agent.peers[connectionAddress];
    if (p && String(p.id) === want) return true;
    return false;
  }

  /**
   * Connect to a peer via the underlying Peer implementation, enforcing
   * basic input validation and normalization.
   */
  _connectPeer (input) {
    const { idOrAddress } = this._normalizePeerInput(input);
    if (!idOrAddress) {
      throw new Error('invalid peer address');
    }

    const base = idOrAddress.includes(':') ? idOrAddress : `${idOrAddress}:7777`;
    if (!PEER_ADDRESS_RE.test(base)) {
      throw new Error('invalid peer address format');
    }

    if (typeof this.agent._connect === 'function') {
      this.agent._connect(base);
      return base;
    }

    if (typeof this.agent.connectTo === 'function') {
      this.agent.connectTo(base);
      return base;
    }

    throw new Error('peer connect method unavailable');
  }

  /**
   * Disconnect from a peer by id or address.
   */
  _disconnectPeer (input) {
    const address = this._resolvePeerAddress(input);
    if (!address) return false;

    if (typeof this.agent._disconnect === 'function') {
      return !!this.agent._disconnect(address);
    }

    if (typeof this.agent.disconnectFrom === 'function') {
      this.agent.disconnectFrom(address);
      return true;
    }

    return false;
  }

  /**
   * Low-level send of a Message vector to a specific peer connection.
   * Vector is `[type, JSON.stringify(payload)]`.
   */
  _sendVectorToPeer (addressInput, vector) {
    const address = this._resolvePeerAddress(addressInput);
    if (!address) throw new Error('peer not connected');
    const sock = this.agent && this.agent.connections && this.agent.connections[address];
    if (!sock || typeof sock._writeFabric !== 'function') {
      throw new Error('peer not connected');
    }

    const msg = Message.fromVector(vector).signWithKey(this.agent.key);
    sock._writeFabric(msg.toBuffer());
  }

  /**
   * Send a JSON envelope that {@link Peer} delivers as {@link GenericMessage} so `_handleGenericMessage`
   * runs (required for `INVENTORY_REQUEST` / `INVENTORY_RESPONSE`; bare vector labels are not switched).
   * @param {string} addressInput
   * @param {object|string} envelope Parsed object or JSON string (must include `type` when object).
   */
  _sendGenericFabricEnvelopeToPeer (addressInput, envelope) {
    const address = this._resolvePeerAddress(addressInput);
    if (!address) throw new Error('peer not connected');
    const sock = this.agent && this.agent.connections && this.agent.connections[address];
    if (!sock || typeof sock._writeFabric !== 'function') {
      throw new Error('peer not connected');
    }
    const body = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
    const msg = Message.fromVector(['GenericMessage', body]).signWithKey(this.agent.key);
    sock._writeFabric(msg.toBuffer());
  }

  /**
   * When a Fabric TCP session opens to an address listed in {@link settings.peers} (or
   * `FABRIC_FABRIC_RESYNC_PEERS`), send {@link ChainSyncRequest} so the peer can push catalog
   * inventory and replay `BitcoinBlock` Fabric log rows. Bitcoin Core chain length still follows
   * bitcoind P2P (`addnode`), not this path.
   * Disable: `FABRIC_DISABLE_FABRIC_SEED_RESYNC=1`.
   */
  _maybeRequestFabricSeedResync (ev) {
    if (process.env.FABRIC_DISABLE_FABRIC_SEED_RESYNC === '1' ||
        process.env.FABRIC_DISABLE_FABRIC_SEED_RESYNC === 'true') {
      return;
    }
    if (!this.agent || !ev) return;
    const addr = ev.address || ev.id;
    if (!addr || typeof addr !== 'string' || !this.agent.connections[addr]) return;

    const seeds = new Set();
    const peers = Array.isArray(this.settings.peers) ? this.settings.peers : [];
    for (const p of peers) {
      if (typeof p === 'string' && p.trim()) seeds.add(p.trim().toLowerCase());
    }
    const extra = String(process.env.FABRIC_FABRIC_RESYNC_PEERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of extra) seeds.add(p.toLowerCase());
    if (!seeds.size) return;

    const key = addr.trim().toLowerCase();
    if (!seeds.has(key)) return;

    if (!this._fabricSeedResyncCooldown) this._fabricSeedResyncCooldown = new Map();
    const now = Date.now();
    const last = this._fabricSeedResyncCooldown.get(key) || 0;
    if (now - last < 30000) return;
    this._fabricSeedResyncCooldown.set(key, now);

    const myId = this.agent.identity && this.agent.identity.id ? String(this.agent.identity.id) : '';
    const body = JSON.stringify({
      v: 1,
      reason: 'hub-auto-seed-fabric-resync',
      requester: myId,
      at: new Date().toISOString()
    });
    try {
      this._sendVectorToPeer(addr, ['ChainSyncRequest', body]);
      if (this.settings.debug) {
        console.debug('[HUB] ChainSyncRequest → seed peer', addr);
      }
    } catch (err) {
      console.error('[HUB] auto Fabric seed resync failed:', err && err.message ? err.message : err);
    }
  }

  /**
   * `@fabric/core` Peer treats wire `ChainSyncRequest` as unhandled (default switch branch), so
   * `chainSyncRequest` never fires. Peek the type opcode and emit so {@link _fabricPeerResyncRespondToRequest} runs.
   */
  _installFabricChainSyncRequestBridge () {
    const agent = this.agent;
    if (!agent || typeof agent._handleFabricMessage !== 'function') return;
    const orig = agent._handleFabricMessage.bind(agent);
    agent._handleFabricMessage = (buffer, origin, socket) => {
      try {
        if (Buffer.isBuffer(buffer) && buffer.length >= HEADER_SIZE) {
          const typeCode = buffer.readUInt32BE(72);
          if (typeCode === P2P_CHAIN_SYNC_REQUEST) {
            const raw = buffer.slice(HEADER_SIZE);
            let object = {};
            try {
              object = raw.length ? JSON.parse(String(raw)) : {};
            } catch (_) {
              object = {};
            }
            agent.emit('chainSyncRequest', {
              origin: origin || {},
              object,
              socket: socket || null
            });
          }
        }
      } catch (_) { /* non-fatal */ }
      return orig(buffer, origin, socket);
    };
  }

  _getCollectionMap (name) {
    this._state.content = this._state.content || {};
    this._state.content.collections = this._state.content.collections || {};
    if (name === 'messages') {
      this._ensureResourceCollections();
      return this._state.content.collections.messages;
    }
    const current = this._state.content.collections[name];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      this._state.content.collections[name] = {};
    }
    return this._state.content.collections[name];
  }

  _getCollection (collectionName, entityName) {
    return new Collection({
      name: entityName,
      data: this._getCollectionMap(collectionName)
    });
  }

  _ensureResourceCollections () {
    this._state.content = this._state.content || {};
    this._state.content.collections = this._state.content.collections || {};
    const required = new Set(['documents', 'contracts']);

    try {
      const resources = this.http && this.http.settings && this.http.settings.resources
        ? Object.values(this.http.settings.resources)
        : [];
      for (const resource of resources) {
        if (!resource || !resource.route) continue;
        const key = String(resource.route).replace(/^\/+/, '').split('/')[0];
        if (key) required.add(key);
      }
    } catch (err) {}

    for (const name of required) {
      this._getCollectionMap(name);
    }

    // Chain holds tree, genesis, roots (per Fabric). Messages stored at top level in collections.
    this._state.content.chain = this._state.content.chain || {};
    if (!this._state.content.collections.messages || typeof this._state.content.collections.messages !== 'object') {
      this._state.content.collections.messages = this._state.content.collections.messages || {};
    }

    // Backward-compatible alias while moving to collections-first storage.
    this._state.content.contracts = this._state.content.collections.contracts;

    // Remove people (not needed per Fabric).
    if (this._state.content.collections.people !== undefined) delete this._state.content.collections.people;
    if (this._state.content.counts && this._state.content.counts.people !== undefined) delete this._state.content.counts.people;
  }

  _normalizeDocumentId (idRef) {
    const token = idRef != null ? String(idRef) : '';
    if (!token) return token;
    return token.replace(/^documents\//, '');
  }

  _getFabricMessages () {
    return Object.values(this._getCollectionMap('messages'))
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  }

  /**
   * Local document rows for {@link INVENTORY_RESPONSE} / Fabric resync (no HTLC enrichment).
   * @returns {object[]}
   */
  _collectLocalDocumentInventoryItems () {
    const docs = this._state.documents || {};
    const collections = (this._state.content && this._state.content.collections && this._state.content.collections.documents) || {};
    return Object.values(docs).map((meta) => {
      if (!meta || !meta.id) return null;
      const id = meta.id;
      const c = collections[id];
      const published = !!(c && c.published);
      const purchasePriceSats = c && Number(c.purchasePriceSats) > 0
        ? Math.round(Number(c.purchasePriceSats))
        : undefined;
      const bitcoinHeightRaw = (c && c.bitcoinHeight != null) ? c.bitcoinHeight : meta.bitcoinHeight;
      const bitcoinHeight = bitcoinHeightRaw != null && Number.isFinite(Number(bitcoinHeightRaw))
        ? Math.round(Number(bitcoinHeightRaw))
        : undefined;
      const bitcoinBlockHash = (c && c.bitcoinBlockHash) || meta.bitcoinBlockHash;
      const bitcoinTxid = (c && c.bitcoinTxid) || meta.bitcoinTxid;
      return {
        id,
        sha256: meta.sha256 || id,
        name: meta.name,
        mime: meta.mime || 'application/octet-stream',
        size: meta.size,
        created: meta.created,
        published,
        ...(purchasePriceSats ? { purchasePriceSats } : {}),
        ...(bitcoinHeight != null ? { bitcoinHeight } : {}),
        ...(bitcoinBlockHash ? { bitcoinBlockHash: String(bitcoinBlockHash) } : {}),
        ...(bitcoinTxid ? { bitcoinTxid: String(bitcoinTxid) } : {})
      };
    }).filter(Boolean);
  }

  /**
   * Apply published rows from a peer {@link INVENTORY_RESPONSE} after {@link ChainSyncRequest}
   * (`object.fabricResync`) so {@link ListDocuments} / catalog match the anchor hub without local `CreateDocument`.
   * Does not write `documents/<id>.json`; {@link GetDocument} still needs replication or fetch.
   * @param {object[]} items
   */
  _mergeFabricResyncInventoryItems (items) {
    if (!Array.isArray(items) || items.length === 0) return;
    this._ensureResourceCollections();
    this._state.documents = this._state.documents || {};
    this._state.content.collections.documents = this._state.content.collections.documents || {};
    const coll = this._state.content.collections.documents;
    const now = new Date().toISOString();
    for (const it of items) {
      if (!it || !it.published) continue;
      const id = this._normalizeDocumentId(it.id);
      if (!id) continue;
      const existed = !!coll[id];
      const pubVal = typeof it.published === 'string' ? it.published : now;
      if (!this._state.documents[id]) {
        this._state.documents[id] = {
          id,
          sha256: it.sha256 || id,
          name: it.name || 'document',
          mime: it.mime || 'application/octet-stream',
          size: it.size != null ? Number(it.size) : 0,
          created: it.created || now,
          lineage: it.lineage || id,
          parent: it.parent != null ? it.parent : null,
          revision: it.revision != null ? Number(it.revision) : 1,
          edited: it.edited || it.created || now,
          ...(it.bitcoinHeight != null && Number.isFinite(Number(it.bitcoinHeight))
            ? { bitcoinHeight: Math.round(Number(it.bitcoinHeight)) }
            : {}),
          ...(it.bitcoinBlockHash ? { bitcoinBlockHash: String(it.bitcoinBlockHash) } : {}),
          ...(it.bitcoinTxid ? { bitcoinTxid: String(it.bitcoinTxid) } : {})
        };
      }
      const loc = this._state.documents[id];
      coll[id] = {
        id,
        document: id,
        name: it.name || loc.name,
        mime: it.mime || loc.mime,
        size: it.size != null ? Number(it.size) : loc.size,
        sha256: it.sha256 || id,
        created: it.created || loc.created,
        lineage: it.lineage || loc.lineage || id,
        parent: it.parent != null ? it.parent : loc.parent,
        revision: it.revision != null ? Number(it.revision) : loc.revision,
        edited: it.edited || it.created || loc.edited || now,
        published: pubVal,
        ...(Number.isFinite(Number(it.purchasePriceSats)) && Number(it.purchasePriceSats) > 0
          ? { purchasePriceSats: Math.round(Number(it.purchasePriceSats)) }
          : {}),
        ...(it.bitcoinHeight != null && Number.isFinite(Number(it.bitcoinHeight))
          ? { bitcoinHeight: Math.round(Number(it.bitcoinHeight)) }
          : {}),
        ...(it.bitcoinBlockHash ? { bitcoinBlockHash: String(it.bitcoinBlockHash) } : {}),
        ...(it.bitcoinTxid ? { bitcoinTxid: String(it.bitcoinTxid) } : {})
      };
      if (!existed) {
        this._state.content.counts = this._state.content.counts || {};
        this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
      }
    }
    this._refreshChainState('fabric-resync-inventory');
    this.commit();
  }

  /**
   * Respond to a Fabric {@link P2P_CHAIN_SYNC_REQUEST}: push document inventory, request peer inventory,
   * and replay recent `BitcoinBlock` Fabric log payloads over P2P (throttled).
   * @param {string} originConn host:port
   * @param {object} [object] parsed ChainSyncRequest JSON body
   */
  async _fabricPeerResyncRespondToRequest (originConn, object = {}) {
    const myId = this.agent && this.agent.identity && this.agent.identity.id;
    if (!myId || !originConn) return;
    const requesterFromBody = object && object.requester != null ? String(object.requester).trim() : '';
    const mapped = this.agent._addressToId && this.agent._addressToId[originConn]
      ? String(this.agent._addressToId[originConn]).trim()
      : '';
    const targetId = requesterFromBody || mapped;

    const items = this._collectLocalDocumentInventoryItems();
    const responsePayload = {
      type: 'INVENTORY_RESPONSE',
      actor: { id: myId },
      object: {
        kind: 'documents',
        items,
        created: Date.now(),
        fabricResync: true
      },
      ...(targetId ? { target: targetId } : {})
    };
    this._sendGenericFabricEnvelopeToPeer(originConn, responsePayload);
    try {
      const wsMsg = Message.fromVector(['GenericMessage', JSON.stringify(responsePayload)]);
      if (this._rootKey && this._rootKey.private) wsMsg.signWithKey(this._rootKey);
      if (typeof this.http.broadcast === 'function') this.http.broadcast(wsMsg);
    } catch (_) {}

    const invReq = {
      type: 'INVENTORY_REQUEST',
      actor: { id: myId },
      object: { kind: 'documents', fabricResync: true }
    };
    this._sendGenericFabricEnvelopeToPeer(originConn, invReq);

    const MAX_BLOCKS = 500;
    const delayMs = 25;
    const blocks = this._getFabricMessages()
      .filter((e) => e && e.type === 'BitcoinBlock' && e.payload && typeof e.payload === 'object')
      .slice(-MAX_BLOCKS);
    for (let i = 0; i < blocks.length; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        this._sendVectorToPeer(originConn, ['BitcoinBlock', JSON.stringify(blocks[i].payload)]);
      } catch (sendErr) {
        console.warn('[HUB] Fabric resync BitcoinBlock send failed:', sendErr && sendErr.message ? sendErr.message : sendErr);
        break;
      }
    }
    if (this.settings && this.settings.debug) {
      console.debug('[HUB] Fabric peer resync completed for', originConn, 'bitcoinBlocks:', blocks.length);
    }
  }

  async _ensureGenesisMessage () {
    this._state.content = this._state.content || {};
    this._state.content.counts = this._state.content.counts || {};
    const map = this._getCollectionMap('messages');
    const existing = Object.values(map).find((entry) => entry && entry.type === 'GENESIS_MESSAGE');
    if (existing) {
      this._state.content.chain = this._state.content.chain || {};
      this._state.content.chain.genesis = existing.id;
      this._buildMessageTreeFromLog();
      return existing;
    }

    // Fresh state: use regular append flow so all persistence hooks apply.
    if (Object.keys(map).length === 0) {
      const created = await this._appendFabricMessage('GENESIS_MESSAGE', {
        service: '@fabric/hub',
        created: new Date().toISOString()
      });
      this._state.content.chain = this._state.content.chain || {};
      this._state.content.chain.genesis = created.id;
      return created;
    }

    // Legacy state without genesis: inject a single synthetic genesis at seq 0.
    const now = new Date().toISOString();
    const base = {
      seq: 0,
      type: 'GENESIS_MESSAGE',
      payload: { service: '@fabric/hub', migrated: true, created: now },
      created: now
    };
    const id = new Actor({ content: base }).id;
    map[id] = Object.assign({ id }, base);
    this._state.content.chain = this._state.content.chain || {};
    this._state.content.chain.genesis = id;
    this._buildMessageTreeFromLog();
    return map[id];
  }

  _buildMessageTreeFromLog () {
    const entries = this._getFabricMessages();
    const leaves = entries.map((entry) => JSON.stringify({
      seq: entry.seq,
      type: entry.type,
      payload: entry.payload
    }));
    this._fabricMessageTree = new Tree({ leaves });
    if (this.fs) this.fs.tree = this._fabricMessageTree;
    const root = this._fabricMessageTree && this._fabricMessageTree.root
      ? this._fabricMessageTree.root
      : null;
    const rootHex = Buffer.isBuffer(root) ? root.toString('hex') : (root ? String(root) : null);
    this._state.content.chain = this._state.content.chain || {};
    this._state.content.chain.tree = {
      leaves: leaves.length,
      root: rootHex
    };
    this._state.content.chain.messages = entries.map((e) => e.id).filter(Boolean);
    return rootHex;
  }

  async _appendFabricMessage (type, payload = {}) {
    this._state.content = this._state.content || {};
    this._state.content.counts = this._state.content.counts || {};
    const map = this._getCollectionMap('messages');
    const nextSeq = Number(this._state.content.counts.messages || 0) + 1;
    const now = new Date().toISOString();
    const base = { seq: nextSeq, type: String(type), payload, created: now };
    const id = new Actor({ content: base }).id;

    map[id] = Object.assign({ id }, base);
    this._state.content.counts.messages = nextSeq;
    this._buildMessageTreeFromLog();
    const entry = map[id];

    // Capture major state transitions in the Fabric Chain for deterministic replay.
    try {
      if (this.chain && typeof this.chain.proposeTransaction === 'function' && typeof this.chain.generateBlock === 'function') {
        this.chain.proposeTransaction({
          type: entry.type,
          seq: entry.seq,
          payload: entry.payload,
          created: entry.created
        });
        const block = await this.chain.generateBlock();
        if (block && block.id) {
          entry.chainBlock = block.id;
          entry.chainTip = this.chain.consensus || block.id;
        }
      }
    } catch (err) {
      console.error('[HUB] Failed to append message to Chain:', err && err.message ? err.message : err);
    }

    // Persist Fabric message log through Filesystem like other resources.
    if (this.fs && typeof this.fs.publish === 'function') {
      const filename = `messages/${String(nextSeq).padStart(12, '0')}.json`;
      await this.fs.publish(filename, entry);
    }

    // Also update CHAIN tip through Filesystem's native chain hook.
    if (this.fs && typeof this.fs.addToChain === 'function') {
      const vector = ['FABRIC_MESSAGE', JSON.stringify(entry)];
      const message = Message.fromVector(vector);
      if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
      await this.fs.addToChain(message);
    }

    return entry;
  }

  _computeMerkleRootForMap (map = {}, entityName = 'Entry') {
    try {
      const collection = new Collection({
        name: entityName,
        data: map && typeof map === 'object' ? map : {}
      });
      const tree = collection.asMerkleTree();
      const root = tree && typeof tree.getRoot === 'function' ? tree.getRoot() : null;
      if (!root) return null;
      if (Buffer.isBuffer(root)) return root.toString('hex');
      if (typeof root === 'string') return root;
      return Buffer.from(root).toString('hex');
    } catch (err) {
      console.error('[HUB] Failed to compute Merkle root:', err && err.message ? err.message : err);
      return null;
    }
  }

  _computeMerkleRoots () {
    const collections = (this._state.content && this._state.content.collections) || {};
    const messageRoot = this._buildMessageTreeFromLog();
    const beaconRoot = (this.beacon && typeof this.beacon.merkleRoot === 'string') ? this.beacon.merkleRoot : null;
    return {
      documents: this._computeMerkleRootForMap(this._state.documents || {}, 'Document'),
      publishedDocuments: this._computeMerkleRootForMap(collections.documents || {}, 'PublishedDocument'),
      contracts: this._computeMerkleRootForMap(collections.contracts || {}, 'Contract'),
      fabricMessages: messageRoot,
      beacon: beaconRoot
    };
  }

  _refreshChainState (reason = 'update') {
    this._ensureResourceCollections();
    this._state.content.collections.chain = this._state.content.collections.chain || {};

    const roots = this._computeMerkleRoots();
    const rootsId = crypto.createHash('sha256').update(JSON.stringify(roots)).digest('hex');
    const now = new Date().toISOString();
    const tree = this._state.content.chain?.tree || this._state.content.fabricMessageTree || { leaves: 0, root: null };
    const genesis = this._state.content.chain?.genesis || this._state.content.genesisMessage || null;
    const messageIds = this._getFabricMessages().map((e) => e.id).filter(Boolean);

    this._state.content.chain = {
      id: rootsId,
      updatedAt: now,
      roots,
      tree,
      genesis,
      messages: messageIds
    };

    const history = this._state.content.collections.chain;
    if (!history[rootsId]) {
      history[rootsId] = {
        id: rootsId,
        created: now,
        reason,
        roots,
        tree
      };

      // Keep bounded history to avoid unbounded growth.
      const entries = Object.values(history).sort((a, b) => {
        const ta = new Date(a && a.created ? a.created : 0).getTime();
        const tb = new Date(b && b.created ? b.created : 0).getTime();
        return tb - ta;
      });
      const capped = entries.slice(0, 256);
      const compacted = {};
      for (const entry of capped) compacted[entry.id] = entry;
      this._state.content.collections.chain = compacted;
    }

    return this._state.content.chain;
  }

  /**
   * Finalizes the current state.
   */
  commit () {
    this.fs.publish('STATE', JSON.stringify(this.state, null, '  '));
  }

  /**
   * Record an ActivityStreams-style activity and broadcast it to UI clients.
   *
   * Activities are stored in-memory under `this._state.messages` and sent to
   * browsers via a `JSONPatch` message that updates `globalState.messages`
   * on the Bridge. This powers the Activity log / ActivityStream UI.
   *
   * @param {Object} activity Base activity object; minimally `{ type, object }`.
   * @returns {{ id: string, activity: Object }|null}
   */
  recordActivity (activity = {}) {
    try {
      if (!activity || typeof activity !== 'object') return null;

      const actorId = (activity.actor && activity.actor.id) ||
        (this.agent && this.agent.identity && this.agent.identity.id) ||
        null;

      const base = Object.assign(
        {},
        activity,
        actorId && !activity.actor ? { actor: { id: actorId } } : {}
      );

      const objectWithCreated = Object.assign(
        {},
        base.object || {},
        {
          created: (base.object && base.object.created) || new Date().toISOString()
        }
      );
      base.object = objectWithCreated;

      const actor = new Actor({ content: base });
      const id = actor.id;

      this._state.messages = this._state.messages || {};
      this._state.messages[id] = base;

      const patch = {
        op: 'add',
        path: `/messages/${id}`,
        value: base
      };

      const msg = Message.fromVector(['JSONPatch', JSON.stringify(patch)]);
      if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
      if (this.http && typeof this.http.broadcast === 'function') {
        this.http.broadcast(msg);
      }

      return { id, activity: base };
    } catch (err) {
      console.error('[HUB] recordActivity error:', err);
      return null;
    }
  }

  /**
   * Cache chat messages in Hub state so browser reloads can rehydrate from GetNetworkStatus.
   * This keeps global chat visible across refreshes without waiting for new live events.
   * @param {object} chat Chat payload ({ type, actor, object.content, object.created, object.clientId? }).
   * @returns {{ id: string, message: object }|null}
   */
  _cacheChatMessage (chat = {}) {
    try {
      if (!chat || typeof chat !== 'object') return null;
      const content = chat && chat.object && chat.object.content != null
        ? String(chat.object.content)
        : '';
      if (!content.trim()) return null;
      const actorId = chat && chat.actor && chat.actor.id
        ? String(chat.actor.id)
        : ((this.agent && this.agent.identity && this.agent.identity.id) ? String(this.agent.identity.id) : 'unknown');
      const created = Number((chat && chat.object && chat.object.created) || chat.created || Date.now());
      const entry = {
        type: 'P2P_CHAT_MESSAGE',
        actor: { id: actorId },
        object: {
          content,
          created: Number.isFinite(created) ? created : Date.now(),
          ...(chat && chat.object && chat.object.clientId ? { clientId: String(chat.object.clientId) } : {})
        }
      };
      const id = `chat:${entry.object.created}:${actorId}`;
      this._state.messages = this._state.messages || {};
      this._state.messages[id] = entry;
      return { id, message: entry };
    } catch (err) {
      console.warn('[HUB] _cacheChatMessage failed:', err && err.message ? err.message : err);
      return null;
    }
  }

  /**
   * Remove a document from the hub published collection (in-memory + persisted via {@link #commit}).
   * Does not delete the underlying `documents/<id>.json` file.
   * @param {string} documentId Normalized document id (sha256).
   * @returns {{ ok: boolean, message?: string }}
   */
  _unpublishDocument (documentId) {
    const id = this._normalizeDocumentId(documentId);
    if (!id) return { ok: false, message: 'document id required' };
    this._ensureResourceCollections();
    this._state.content.collections.documents = this._state.content.collections.documents || {};
    const entry = this._state.content.collections.documents[id];
    if (!entry) return { ok: false, message: 'document not in published collection' };
    if (!entry.published) return { ok: false, message: 'document is not published' };
    delete this._state.content.collections.documents[id];
    this._state.content.counts = this._state.content.counts || {};
    const prev = Number(this._state.content.counts.documents || 0);
    this._state.content.counts.documents = Math.max(0, prev - 1);
    if (this._state.documents && this._state.documents[id] && this._state.documents[id].published) {
      const d = Object.assign({}, this._state.documents[id]);
      delete d.published;
      this._state.documents[id] = d;
    }
    return { ok: true };
  }

  /**
   * Remove an activity row and/or unpublish a document; persist a Fabric chain message and state.
   *
   * - Appends `_appendFabricMessage('Tombstone', …)` (sequential `messages/*.json`, chain, `fs.addToChain`).
   * - Broadcasts JSON Patch `remove` for activity rows and a `GenericMessage` `{ type: 'Tombstone', object }`
   *   so Bridge dispatches `fabric:tombstone` with `messageId` / `documentId`.
   *
   * @param {Object} options
   * @param {string} [options.messageId] Key in `this._state.messages` (omit to unpublish-only).
   * @param {string} [options.documentId] Published document id to remove from `collections.documents`.
   * @returns {Promise<{ status: string, messageId?: string|null, documentId?: string|null, message?: string }>}
   */
  async recordTombstone (options = {}) {
    try {
      const messageId = typeof options.messageId === 'string' ? options.messageId.trim() : '';
      const documentId = options.documentId
        ? this._normalizeDocumentId(String(options.documentId).trim())
        : '';
      if (!messageId && !documentId) {
        return { status: 'error', message: 'messageId or documentId required' };
      }

      this._state.messages = this._state.messages || {};
      if (messageId && !this._state.messages[messageId]) {
        return { status: 'error', message: 'message not found' };
      }

      if (documentId) {
        const unp = this._unpublishDocument(documentId);
        if (!unp.ok) return { status: 'error', message: unp.message };
      }

      if (messageId) {
        delete this._state.messages[messageId];
        const patch = {
          op: 'remove',
          path: `/messages/${messageId}`
        };
        const msg = Message.fromVector(['JSONPatch', JSON.stringify(patch)]);
        if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
        if (this.http && typeof this.http.broadcast === 'function') {
          this.http.broadcast(msg);
        }
      }

      await this._appendFabricMessage('Tombstone', {
        activityMessageId: messageId || null,
        documentId: documentId || null
      });
      this._refreshChainState('tombstone');
      this.commit();

      if (typeof this._pushNetworkStatus === 'function') {
        try {
          this._pushNetworkStatus();
        } catch (pushErr) {
          console.error('[HUB] recordTombstone pushNetworkStatus:', pushErr && pushErr.message ? pushErr.message : pushErr);
        }
      }

      const tombBody = JSON.stringify({
        type: 'Tombstone',
        object: {
          activityMessageId: messageId || null,
          documentId: documentId || null
        }
      });
      const tombEvt = Message.fromVector(['GenericMessage', tombBody]);
      if (this._rootKey && this._rootKey.private) tombEvt.signWithKey(this._rootKey);
      if (this.http && typeof this.http.broadcast === 'function') {
        this.http.broadcast(tombEvt);
      }

      return {
        status: 'success',
        messageId: messageId || null,
        documentId: documentId || null
      };
    } catch (err) {
      console.error('[HUB] recordTombstone error:', err);
      return { status: 'error', message: err && err.message ? err.message : 'tombstone failed' };
    }
  }

  // TODO: upstream
  _addAllRoutes () {
    return this.http._addAllRoutes();
  }

  // TODO: upstream to @fabric/http (deprecate, should already exist there)
  _addRoute (options) {
    this.http._addRoute(options.method, options.route, options.handler);
    return this;
  }

  /**
   * Bitcoin Core P2P `addnode` targets for playnet/LAN regtest (not Fabric TCP peers).
   * Merges `settings.bitcoin.p2pAddNodes` with `FABRIC_BITCOIN_P2P_ADDNODES` (comma-separated).
   * @returns {string[]}
   */
  _bitcoinP2pAddNodesList () {
    const out = [];
    const fromSettings = this.settings.bitcoin && Array.isArray(this.settings.bitcoin.p2pAddNodes)
      ? this.settings.bitcoin.p2pAddNodes
      : [];
    for (const p of fromSettings) {
      const s = String(p || '').trim();
      if (s) out.push(s);
    }
    const env = process.env.FABRIC_BITCOIN_P2P_ADDNODES;
    if (env && String(env).trim()) {
      for (const part of String(env).split(',')) {
        const s = part.trim();
        if (s) out.push(s);
      }
    }
    const skipPlaynet = process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER === '1'
      || process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER === 'true';
    const network = this.settings.bitcoin && this.settings.bitcoin.network;
    if (!skipPlaynet && network === 'regtest') {
      const playnet = String(process.env.FABRIC_BITCOIN_PLAYNET_PEER || 'hub.fabric.pub:18444').trim();
      if (playnet) out.push(playnet);
    }
    return [...new Set(out)];
  }

  _getBitcoinService () {
    return this.bitcoin || null;
  }

  _ensureWorker () {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(() => {});
      this.workers.push(this.worker);
      this.worker.on('error', (err) => {
        console.error('[HUB:WORKER] error:', err && err.message ? err.message : err);
      });
    } catch (e) {
      console.warn('[HUB:WORKER] init failed:', e && e.message ? e.message : e);
      this.worker = null;
    }
    return this.worker;
  }

  _parseDocumentOfferEnvelopeFromContent (content) {
    const text = String(content || '').trim();
    if (!text) return null;
    const parseJson = (s) => {
      try { return JSON.parse(s); } catch (_) { return null; }
    };
    const direct = parseJson(text);
    if (direct && direct.type === DOCUMENT_OFFER) return direct;
    const prefixed = /^\[DOCUMENT_OFFER\]\s*/i.test(text)
      ? parseJson(text.replace(/^\[DOCUMENT_OFFER\]\s*/i, ''))
      : null;
    if (prefixed && prefixed.type === DOCUMENT_OFFER) return prefixed;
    return null;
  }

  _offerValueSats (offer) {
    if (!offer || typeof offer !== 'object') return 0;
    const object = offer.object && typeof offer.object === 'object' ? offer.object : {};
    const sats = Number(object.rewardSats || object.valueSats || object.amountSats || 0);
    return Number.isFinite(sats) && sats > 0 ? Math.round(sats) : 0;
  }

  _normalizeWorkQueueStrategy (strategy) {
    const key = String(strategy || '').trim().toLowerCase();
    if (!WORK_QUEUE_STRATEGIES.has(key)) return 'highest_value_first';
    return key;
  }

  _loadWorkQueueStrategyFromSettings () {
    if (!this.setup || typeof this.setup.getSetting !== 'function') return this._workQueueStrategy;
    const saved = this.setup.getSetting('WORK_QUEUE_STRATEGY');
    this._workQueueStrategy = this._normalizeWorkQueueStrategy(saved);
    return this._workQueueStrategy;
  }

  async _setWorkQueueStrategy (strategy) {
    const next = this._normalizeWorkQueueStrategy(strategy);
    this._workQueueStrategy = next;
    if (this.setup && typeof this.setup.setSetting === 'function') {
      await this.setup.setSetting('WORK_QUEUE_STRATEGY', next);
    }
    this._sortWorkQueue();
    return next;
  }

  _enqueueWorkItem (item = {}) {
    const id = String(item.id || '').trim();
    if (!id || this._workQueueById.has(id)) return false;
    this._workQueueById.add(id);
    const valueSats = Number(item.valueSats || 0);
    this._workQueue.push({
      id,
      type: String(item.type || 'unknown'),
      sourcePeer: item.sourcePeer || '',
      createdAt: Date.now(),
      attempts: 0,
      valueSats: Number.isFinite(valueSats) ? Math.max(0, Math.round(valueSats)) : 0,
      payload: item.payload || {}
    });
    this._sortWorkQueue();
    this._drainWorkQueue().catch(() => {});
    return true;
  }

  _sortWorkQueue () {
    const strategy = this._normalizeWorkQueueStrategy(this._workQueueStrategy);
    this._workQueue.sort((a, b) => {
      if (strategy === 'fifo') {
        return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      }
      if (strategy === 'oldest_high_value_first') {
        const createdDelta = Number(a.createdAt || 0) - Number(b.createdAt || 0);
        if (createdDelta !== 0) return createdDelta;
        return Number(b.valueSats || 0) - Number(a.valueSats || 0);
      }
      const valueDelta = Number(b.valueSats || 0) - Number(a.valueSats || 0);
      if (valueDelta !== 0) return valueDelta;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
  }

  async _executeWorkItem (item) {
    if (!item || typeof item !== 'object') return;
    if (item.type === 'document-offer-block-download') {
      const peer = String(item.sourcePeer || '').trim();
      const hashes = Array.isArray(item.payload.blockHashes) ? item.payload.blockHashes : [];
      if (!peer || !hashes.length) return;
      await this._requestMainchainBlocksFromPeer(peer, hashes);
      return;
    }
    if (item.type === 'contract-execution-offer') {
      const offer = item.payload.offer || {};
      const object = offer.object && typeof offer.object === 'object' ? offer.object : {};
      if (object.program && Array.isArray(object.program.steps)) {
        const run = runExecutionProgram(object.program, {});
        if (run && run.ok) {
          this.recordActivity({
            type: 'Run',
            object: {
              type: 'ExecutionOffer',
              id: String(item.id),
              stepsExecuted: Number(run.stepsExecuted || 0),
              valueSats: Number(item.valueSats || 0)
            }
          });
        }
      }
    }
  }

  async _drainWorkQueue () {
    if (this._workQueueBusy) return;
    this._workQueueBusy = true;
    try {
      while (this._workQueue.length) {
        this._sortWorkQueue();
        const next = this._workQueue.shift();
        if (!next) break;
        next.attempts = Number(next.attempts || 0) + 1;
        let requeued = false;
        try {
          await this._executeWorkItem(next);
        } catch (e) {
          if (next.attempts < 3) {
            this._workQueue.push(next);
            requeued = true;
          } else {
            console.warn('[HUB:WORKER] dropped work item after retries:', next.id, e && e.message ? e.message : e);
          }
        } finally {
          if (!requeued) this._workQueueById.delete(next.id);
        }
      }
    } finally {
      this._workQueueBusy = false;
    }
  }

  _ingestOfferFromChatMessage (chat = {}, originPeer = '') {
    const object = chat && chat.object && typeof chat.object === 'object' ? chat.object : {};
    const env = this._parseDocumentOfferEnvelopeFromContent(object.content || '');
    if (!env) return;
    const offerObject = env.object && typeof env.object === 'object' ? env.object : {};
    const valueSats = this._offerValueSats(env);
    const offerId = String(offerObject.offerId || offerObject.id || '').trim() || crypto.randomBytes(8).toString('hex');
    const explicitHashes = []
      .concat(offerObject.blockHash || [])
      .concat(Array.isArray(offerObject.blockHashes) ? offerObject.blockHashes : [])
      .map((h) => String(h || '').trim().toLowerCase())
      .filter((h) => this._isHex64(h));
    if (explicitHashes.length) {
      this._enqueueWorkItem({
        id: `offer:block:${offerId}`,
        type: 'document-offer-block-download',
        sourcePeer: originPeer || '',
        valueSats,
        payload: {
          offer: env,
          blockHashes: [...new Set(explicitHashes)]
        }
      });
    }
    if (offerObject.program && Array.isArray(offerObject.program.steps)) {
      this._enqueueWorkItem({
        id: `offer:contract:${offerId}`,
        type: 'contract-execution-offer',
        sourcePeer: originPeer || '',
        valueSats,
        payload: { offer: env }
      });
    }
  }

  _isHex64 (value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
  }

  async _collectLocalMainchainInventorySummary () {
    const bitcoin = this._getBitcoinService();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return null;
    try {
      const [bestHashRaw, heightRaw, chainRaw] = await Promise.all([
        bitcoin._makeRPCRequest('getbestblockhash', []),
        bitcoin._makeRPCRequest('getblockcount', []),
        bitcoin._makeRPCRequest('getblockchaininfo', [])
      ]);
      const bestHash = String(bestHashRaw || '').trim();
      const height = Number(heightRaw);
      if (!this._isHex64(bestHash) || !Number.isFinite(height) || height < 0) return null;
      const recentHashes = [];
      const window = 16;
      const start = Math.max(0, height - (window - 1));
      for (let h = start; h <= height; h++) {
        try {
          const hash = await bitcoin._makeRPCRequest('getblockhash', [h]);
          if (this._isHex64(hash)) recentHashes.push(String(hash).toLowerCase());
        } catch (_) {}
      }
      return {
        network: chainRaw && chainRaw.chain ? String(chainRaw.chain) : undefined,
        height: Math.round(height),
        bestHash: bestHash.toLowerCase(),
        recentHashes
      };
    } catch (_) {
      return null;
    }
  }

  async _requestMainchainInventoryFromPeer (addressInput, reason = 'peer-open') {
    const address = this._resolvePeerAddress(addressInput);
    if (!address || !this.agent || !this.agent.connections || !this.agent.connections[address]) return false;
    const now = Date.now();
    const last = this._mainchainInventoryRequestCooldown.get(address) || 0;
    if (now - last < 15000) return false;
    this._mainchainInventoryRequestCooldown.set(address, now);
    try {
      const payload = {
        type: 'INVENTORY_REQUEST',
        actor: { id: this.agent.identity.id },
        object: {
          kind: 'mainchain',
          created: now,
          reason
        },
        target: String(address)
      };
      this._sendGenericFabricEnvelopeToPeer(address, payload);
      return true;
    } catch (_) {
      return false;
    }
  }

  async _requestMainchainBlocksFromPeer (addressInput, hashes = []) {
    const address = this._resolvePeerAddress(addressInput);
    if (!address || !this.agent || !this.agent.connections || !this.agent.connections[address]) return false;
    const uniq = [...new Set((Array.isArray(hashes) ? hashes : [])
      .map((h) => String(h || '').trim().toLowerCase())
      .filter((h) => this._isHex64(h)))].slice(0, 32);
    if (!uniq.length) return false;
    const key = `${address}|${uniq.join(',')}`;
    if (this._pendingMainchainBlockSyncRequests.has(key)) return false;
    this._pendingMainchainBlockSyncRequests.add(key);
    try {
      const payload = {
        type: 'INVENTORY_REQUEST',
        actor: { id: this.agent.identity.id },
        object: {
          kind: 'mainchain-blocks',
          created: Date.now(),
          hashes: uniq
        },
        target: String(address)
      };
      this._sendGenericFabricEnvelopeToPeer(address, payload);
      return true;
    } catch (_) {
      return false;
    } finally {
      setTimeout(() => this._pendingMainchainBlockSyncRequests.delete(key), 5000);
    }
  }

  async _applyMainchainBlocksFromInventoryItems (items = []) {
    const bitcoin = this._getBitcoinService();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return { applied: 0, attempted: 0 };
    const rows = (Array.isArray(items) ? items : [])
      .filter((it) => it && this._isHex64(String(it.hash || '').trim()) && typeof it.hex === 'string' && it.hex.trim());
    rows.sort((a, b) => Number(a.height || 0) - Number(b.height || 0));
    let attempted = 0;
    let applied = 0;
    for (const row of rows) {
      attempted += 1;
      const hash = String(row.hash).toLowerCase();
      let alreadyHave = false;
      try {
        const header = await bitcoin._makeRPCRequest('getblockheader', [hash]);
        if (header && typeof header === 'object') alreadyHave = true;
      } catch (_) {}
      if (alreadyHave) continue;
      try {
        const result = await bitcoin._makeRPCRequest('submitblock', [String(row.hex).trim()]);
        if (result == null || result === 'duplicate' || result === 'duplicate-invalid' || result === 'duplicate-inconclusive') {
          applied += 1;
        }
      } catch (e) {
        if (this.settings && this.settings.debug) {
          console.warn('[HUB] submitblock failed for', hash, e && e.message ? e.message : e);
        }
      }
    }
    return { applied, attempted };
  }

  _getPayjoinService () {
    if (!this.payjoin) return null;
    if (this.settings && this.settings.payjoin && this.settings.payjoin.enable === false) return null;
    return this.payjoin;
  }

  _getPeeringService () {
    if (!this.peering) return null;
    if (this.settings && this.settings.peering && this.settings.peering.enable === false) return null;
    return this.peering;
  }

  _getChallengeService () {
    if (!this.challenge) return null;
    if (this.settings && this.settings.challenge && this.settings.challenge.enable === false) return null;
    return this.challenge;
  }

  /**
   * Persisted federation policy from `stores/hub/settings.json` key `DISTRIBUTED_FEDERATION`, when present.
   * @returns {{ validators: string[], threshold?: number }|undefined}
   */
  _distributedFederationPersisted () {
    if (!this.setup || typeof this.setup.getSetting !== 'function') return undefined;
    const p = this.setup.getSetting('DISTRIBUTED_FEDERATION');
    if (p == null || typeof p !== 'object') return undefined;
    return p;
  }

  _distributedFederationPolicySource () {
    const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    if (env && String(env).trim()) return 'env';
    if (this._distributedFederationPersisted() != null) return 'persisted';
    return 'default';
  }

  /**
   * Chain scan for `fabfed` OP_RETURN federation announcements (regtest default on).
   */
  _federationRegistryScanEnabled () {
    const env = process.env.FABRIC_FEDERATION_CHAIN_SCAN;
    if (env === '0' || env === 'false') return false;
    if (env === '1' || env === 'true') return true;
    const cfg = this.settings.bitcoin && this.settings.bitcoin.federationRegistryScan;
    if (cfg && cfg.enable === false) return false;
    if (cfg && cfg.enable === true) return true;
    const btc = this._getBitcoinService();
    return !!(btc && btc.network === 'regtest');
  }

  /**
   * When setup has no `DISTRIBUTED_FEDERATION` JSON, restore from Fabric `federations/POLICY_SNAPSHOT`.
   */
  async _hydrateDistributedFederationFromFsSnapshot () {
    const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    if (env && String(env).trim()) return;
    const persisted = this._distributedFederationPersisted();
    if (persisted && Array.isArray(persisted.validators) && persisted.validators.length) return;
    const snap = federationRegistry.loadPolicySnapshot(this.fs);
    if (!snap || !Array.isArray(snap.validators) || !snap.validators.length) return;
    const validators = snap.validators.map((v) => String(v || '').trim()).filter(Boolean);
    if (!validators.length) return;
    let threshold = snap.threshold != null ? Number(snap.threshold) : 1;
    if (!Number.isFinite(threshold) || threshold < 1) threshold = 1;
    if (validators.length && threshold > validators.length) threshold = validators.length;
    try {
      await this.setup.setSetting('DISTRIBUTED_FEDERATION', { validators: validators.slice(), threshold });
    } catch (e) {
      console.warn('[HUB:FEDERATION] hydrate from Fabric snapshot failed:', e && e.message ? e.message : e);
      return;
    }
    if (!this.settings.distributed) this.settings.distributed = {};
    if (!this.settings.distributed.federation) this.settings.distributed.federation = {};
    this.settings.distributed.federation.validators = validators.slice();
    this.settings.distributed.federation.threshold = threshold;
    console.log('[HUB:FEDERATION] Restored distributed federation policy from Fabric filesystem (federations/POLICY_SNAPSHOT).');
  }

  /**
   * Seed `federations/REGISTRY`, hydrate policy from snapshot, mirror current setup policy to disk.
   */
  async _bootstrapFederationFilesystem () {
    if (!this.fs) return;
    try {
      await this._hydrateDistributedFederationFromFsSnapshot();
      const fed = this.settings && Array.isArray(this.settings.federations) ? this.settings.federations : [];
      await federationRegistry.seedRegistryFromSettings(this.fs, fed);
      const snap = this._distributedFederationPersisted();
      if (snap && Array.isArray(snap.validators)) {
        await federationRegistry.persistPolicySnapshot(this.fs, {
          validators: snap.validators,
          threshold: snap.threshold != null ? Number(snap.threshold) : this._distributedFederationThresholdEffective(),
          source: this._distributedFederationPolicySource()
        });
      }
    } catch (e) {
      console.warn('[HUB:FEDERATION] bootstrap filesystem:', e && e.message ? e.message : e);
    }
  }

  async _maybeScanFederationRegistryBlock (blockHash, height) {
    if (!this._federationRegistryScanEnabled() || !blockHash) return;
    const bitcoin = this._getBitcoinService();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return;
    try {
      const block = await bitcoin._makeRPCRequest('getblock', [blockHash, 2]);
      if (!block) return;
      const anns = federationRegistry.extractFederationAnnouncementsFromBlock(
        block,
        Number.isFinite(Number(height)) ? Number(height) : -1
      );
      await federationRegistry.mergeAnnouncementsIntoRegistry(
        this.fs,
        anns,
        Number.isFinite(Number(height)) ? Number(height) : null
      );
      if (anns.length && this.settings.debug) {
        console.log('[HUB:FEDERATION:SCAN]', `height ${height}`, anns.length, 'fabfed announcement(s)');
      }
    } catch (e) {
      console.warn('[HUB:FEDERATION:SCAN]', e && e.message ? e.message : e);
    }
  }

  _handleDistributedFederationRegistryRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const reg = federationRegistry.loadRegistry(this.fs);
      res.status(200).json({
        type: 'FederationRegistry',
        path: federationRegistry.REGISTRY_PATH,
        policySnapshotPath: federationRegistry.POLICY_SNAPSHOT_PATH,
        ...reg
      });
    });
  }

  /**
   * Federation validator pubkeys (hex) for Beacon epoch witnesses — env, then persisted setting, then in-memory defaults.
   * @returns {string[]}
   */
  _distributedFederationValidatorsFromEnv () {
    const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    if (env && String(env).trim()) {
      return String(env).split(',').map((s) => s.trim()).filter(Boolean);
    }
    const persisted = this._distributedFederationPersisted();
    if (persisted && Array.isArray(persisted.validators)) {
      return persisted.validators.filter((v) => typeof v === 'string' && v.trim()).map((s) => s.trim());
    }
    const v = this.settings.distributed && this.settings.distributed.federation && this.settings.distributed.federation.validators;
    return Array.isArray(v) ? v.slice() : [];
  }

  /**
   * M-of-N threshold aligned with {@link #_distributedFederationValidatorsFromEnv} source order.
   * @returns {number}
   */
  _distributedFederationThresholdEffective () {
    const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    if (env && String(env).trim()) {
      return Math.max(1, Number(process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD) || 1);
    }
    const persisted = this._distributedFederationPersisted();
    if (persisted && Array.isArray(persisted.validators)) {
      const t = persisted.threshold != null ? Number(persisted.threshold) : NaN;
      if (Number.isFinite(t) && t >= 1) return t;
      return 1;
    }
    return Math.max(1, Number(
      (this.settings.distributed && this.settings.distributed.federation && this.settings.distributed.federation.threshold) ||
        process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD || 1
    ));
  }

  _reapplyBeaconFederationPolicy () {
    if (!this.beacon || typeof this.beacon.attach !== 'function') return;
    try {
      const validators = this._distributedFederationValidatorsFromEnv();
      const thresholdRaw = this._distributedFederationThresholdEffective();
      const federationThreshold = validators.length ? thresholdRaw : Math.max(1, thresholdRaw);
      this.beacon.attach({
        fs: this.fs,
        key: this._rootKey,
        federationValidators: validators,
        federationThreshold,
        getSidechainSnapshotForEpoch: () => this._getSidechainSnapshotForBeacon()
      });
    } catch (e) {
      console.warn('[HUB:FEDERATION] beacon.attach reapply failed:', e && e.message ? e.message : e);
    }
  }

  /**
   * Same validator list + threshold as {@link #_submitSidechainStatePatch} (env + persisted + settings).
   * Used for `/services/distributed/manifest` and epoch JSON so operators see what the hub enforces even when
   * the Beacon has not called {@link Beacon#attach} yet (e.g. Bitcoin RPC not ready).
   * @returns {{ validators: string[], threshold: number }}
   */
  _getEffectiveFederationPolicyForDistributedHttp () {
    const validators = this._distributedFederationValidatorsFromEnv();
    const threshold = this._distributedFederationThresholdEffective();
    return {
      validators,
      threshold: validators.length ? threshold : 1
    };
  }

  _getDistributedManifestJson () {
    const programHash = (this.settings.distributed && this.settings.distributed.programHash) ||
      (this.contract && this.contract.id) ||
      'unknown';
    const manifest = {
      version: 1,
      programId: (this.settings.distributed && this.settings.distributed.programId) || '@fabric/hub',
      programHash: String(programHash),
      allowedMessageTypes: ['BEACON_EPOCH', 'SIDECHAIN_STATE_PATCH', 'P2P_CHAT_MESSAGE', 'P2P_FILE_SEND', 'JSONCall'],
      federation: null
    };
    const fp = this._getEffectiveFederationPolicyForDistributedHttp();
    if (fp.validators.length) {
      manifest.federation = { validators: fp.validators, threshold: fp.threshold };
    }
    const parsed = DistributedExecution.parseDistributedManifestV1(manifest);
    const out = parsed.ok ? { ...parsed.manifest } : { ...manifest };
    try {
      let hubId = (this.agent && this.agent.id) ? String(this.agent.id).trim() : '';
      if (!hubId && this._rootKey && this._rootKey.pubkey) {
        hubId = String(this._rootKey.pubkey).trim();
      }
      out.hubFabricPeerId = hubId || null;
    } catch (_) {
      out.hubFabricPeerId = null;
    }
    try {
      const vs = this._buildFederationVaultSummary();
      if (vs && vs.status === 'ok' && vs.address) {
        out.federationVault = {
          address: vs.address,
          depositMaturityBlocks: vs.policy && vs.policy.depositMaturityBlocks,
          scheme: vs.policy && vs.policy.scheme,
          endpoints: vs.endpoints || null
        };
      } else if (vs && vs.status === 'no_validators') {
        out.federationVault = { status: 'no_validators', message: vs.message || null };
      } else if (vs && vs.status === 'error') {
        out.federationVault = { status: 'error', message: vs.message || null };
      }
    } catch (_) {
      out.federationVault = null;
    }
    return out;
  }

  /**
   * Snapshot of sidechain logical head for Beacon epoch payloads (`payload.sidechain`).
   * @returns {{ clock: number, stateDigest: string }}
   */
  _getSidechainSnapshotForBeacon () {
    if (!this._sidechainState) {
      this._sidechainState = sidechainState.loadState(this.fs);
    }
    return {
      clock: Number(this._sidechainState.clock) || 0,
      stateDigest: sidechainState.stateDigest(this._sidechainState)
    };
  }

  /**
   * Apply JSON Patch to sidechain `content` after federation witness or admin token.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async _submitSidechainStatePatch (params = {}) {
    const req = (params && typeof params === 'object') ? params : {};
    const patches = req.patches;
    const basisClock = req.basisClock != null ? Number(req.basisClock) : NaN;
    const federationWitness = req.federationWitness || null;
    const adminToken = req.adminToken || req.token;

    const validators = this._distributedFederationValidatorsFromEnv();
    const threshold = this._distributedFederationThresholdEffective();

    if (!Array.isArray(patches) || !patches.length) {
      return { status: 'error', message: 'patches required' };
    }
    if (!Number.isFinite(basisClock)) {
      return { status: 'error', message: 'basisClock required' };
    }

    const state = this._sidechainState || sidechainState.loadState(this.fs);
    if (basisClock !== state.clock) {
      return { status: 'error', message: `basisClock mismatch (have ${state.clock})` };
    }

    const basisDigest = sidechainState.stateDigest(state);
    const proposal = { basisClock, basisDigest, patches };
    const msgBuf = Buffer.from(sidechainState.signingStringForSidechainStatePatch(proposal), 'utf8');

    if (validators.length > 0) {
      const ok = DistributedExecution.verifyFederationWitnessOnMessage(
        msgBuf,
        federationWitness,
        validators,
        threshold
      );
      if (!ok) {
        return { status: 'error', message: 'federationWitness invalid or insufficient' };
      }
    } else if (!this.setup.verifyAdminToken(adminToken)) {
      return { status: 'error', message: 'adminToken required (no federation validators configured)' };
    }

    const applied = sidechainState.applyPatchesToState(state, patches);
    if (!applied.ok) {
      return { status: 'error', message: applied.error || 'patch failed' };
    }

    this._sidechainState = applied.state;
    try {
      await sidechainState.persistState(this.fs, this._sidechainState);
    } catch (e) {
      return { status: 'error', message: e && e.message ? e.message : String(e) };
    }

    return {
      type: 'SubmitSidechainStatePatchResult',
      clock: this._sidechainState.clock,
      stateDigest: sidechainState.stateDigest(this._sidechainState),
      patchDigest: sidechainState.patchCommitmentDigestHex(proposal),
      content: this._sidechainState.content
    };
  }

  /**
   * After Bitcoin reorg: prune sidechain snapshots for dropped beacon epochs and reload `STATE` from the surviving tip snapshot.
   * @param {{ removedBeaconClocks?: number[], inclusiveMaxHeight?: number, sameHeight?: boolean }} info
   */
  async _handleBeaconReorgForSidechain (info = {}) {
    const removed = Array.isArray(info.removedBeaconClocks) ? info.removedBeaconClocks : [];
    if (removed.length) {
      sidechainState.pruneSnapshotsForRemovedBeaconClocksSync(this.fs, removed);
    }

    const b = this.beacon;
    const summary = b && typeof b.getEpochChainSummary === 'function'
      ? b.getEpochChainSummary()
      : { last: null };
    const lastPayload = summary.last && summary.last.payload ? summary.last.payload : null;

    if (!lastPayload || lastPayload.clock == null) {
      this._sidechainState = sidechainState.createInitialState();
      await sidechainState.persistState(this.fs, this._sidechainState);
      return;
    }

    const tipBeaconClock = Number(lastPayload.clock);
    sidechainState.pruneSnapshotsAfterBeaconClockSync(this.fs, tipBeaconClock);

    let restored = sidechainState.loadSnapshotForBeaconClock(this.fs, tipBeaconClock);
    if (!restored) {
      const st = sidechainState.loadState(this.fs);
      const dig = sidechainState.stateDigest(st);
      const want = lastPayload.sidechain && lastPayload.sidechain.stateDigest;
      if (want && dig === want) {
        restored = st;
      } else {
        restored = sidechainState.createInitialState();
        console.warn('[HUB:SIDECHAIN] Reorg: no snapshot for beacon clock', tipBeaconClock, '- reset to genesis (digest mismatch or missing snapshot)');
      }
    }

    this._sidechainState = restored;
    await sidechainState.persistState(this.fs, restored);
  }

  /**
   * Align in-memory `sidechain/STATE` with the persisted beacon epoch chain tip (snapshots written each epoch).
   */
  async _reconcileSidechainToBeaconTip () {
    const b = this.beacon;
    if (!b || typeof b.getEpochChainSummary !== 'function') return;

    const summary = b.getEpochChainSummary();
    const lastPayload = summary.last && summary.last.payload ? summary.last.payload : null;
    if (!lastPayload || lastPayload.clock == null) {
      return;
    }

    const tipBeaconClock = Number(lastPayload.clock);
    let next = sidechainState.loadSnapshotForBeaconClock(this.fs, tipBeaconClock);
    if (!next) {
      const st = this._sidechainState || sidechainState.loadState(this.fs);
      const dig = sidechainState.stateDigest(st);
      const want = lastPayload.sidechain && lastPayload.sidechain.stateDigest;
      if (want && dig === want) {
        next = st;
      } else {
        console.warn('[HUB:SIDECHAIN] Startup: missing snapshot for tip beacon clock', tipBeaconClock, '- keeping loaded STATE');
        return;
      }
    }

    this._sidechainState = next;
    await sidechainState.persistState(this.fs, next);
  }

  _getDistributedEpochJson () {
    const b = this.beacon;
    if (!b) {
      return { service: 'distributed', beacon: null };
    }
    const summary = typeof b.getEpochChainSummary === 'function'
      ? b.getEpochChainSummary()
      : { length: 0, last: null };
    let lastDigest = null;
    if (summary.last && summary.last.payload) {
      lastDigest = DistributedExecution.epochCommitmentDigestHex(summary.last.payload);
    }
    return {
      service: 'distributed',
      beacon: {
        status: b.state && b.state.status,
        clock: b.state && b.state.clock,
        merkleRoot: b.merkleRoot,
        epochCount: summary.length,
        lastCommitmentDigest: lastDigest,
        last: summary.last,
        federation: this._getEffectiveFederationPolicyForDistributedHttp()
      }
    };
  }

  async _probeTcpLocalPort (port, host = '127.0.0.1', timeoutMs = 800) {
    const startedAt = Date.now();
    return await new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const done = (ok, error) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch (_) {}
        resolve({
          ok: !!ok,
          host,
          port,
          latencyMs: Date.now() - startedAt,
          error: error ? String(error) : null
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true, null));
      socket.once('timeout', () => done(false, 'timeout'));
      socket.once('error', (err) => done(false, err && err.message ? err.message : String(err)));
      try {
        socket.connect(port, host);
      } catch (err) {
        done(false, err && err.message ? err.message : String(err));
      }
    });
  }

  _buildOperatorProbeTargets () {
    const out = [];
    const add = (name, host, port) => {
      const p = Number(port);
      if (!Number.isFinite(p) || p <= 0) return;
      if (out.some((x) => x.name === name && x.host === host && x.port === p)) return;
      out.push({ name, host, port: p });
    };

    add('hub-http', '127.0.0.1', this.settings && this.settings.http && this.settings.http.port);
    add('fabric-p2p', '127.0.0.1', this.settings && this.settings.port);
    add('bitcoin-rpc', '127.0.0.1', this.settings && this.settings.bitcoin && this.settings.bitcoin.rpcport);
    add('bitcoin-p2p', '127.0.0.1', this.settings && this.settings.bitcoin && this.settings.bitcoin.port);
    add('lightning-rpc', '127.0.0.1', this.settings && this.settings.lightning && this.settings.lightning.rpcport);
    return out;
  }

  async _collectOperatorHealthSnapshot () {
    const now = Date.now();
    const nodeUptimeSec = process.uptime();
    const mem = process.memoryUsage();
    const hostname = os.hostname();
    const platform = `${process.platform}-${process.arch}`;
    const loadAvg = os.loadavg();
    const nowCpu = process.cpuUsage();
    let processCpuPercent = null;
    if (this._operatorCpuSample && this._operatorCpuSample.at > 0) {
      const elapsedUs = Math.max(1, (now - this._operatorCpuSample.at) * 1000);
      const usedUs = Math.max(0, (nowCpu.user - this._operatorCpuSample.user) + (nowCpu.system - this._operatorCpuSample.system));
      const cores = Math.max(1, Number(os.cpus() && os.cpus().length) || 1);
      processCpuPercent = Math.max(0, Math.min(100, (usedUs / elapsedUs / cores) * 100));
    }
    this._operatorCpuSample = { at: now, user: nowCpu.user, system: nowCpu.system };

    const storePath = path.resolve(hubStoreRoot(), this.settings && this.settings.fs && this.settings.fs.path ? this.settings.fs.path : 'stores/hub');
    let disk = {
      path: storePath,
      availableBytes: null,
      totalBytes: null,
      usedBytes: null,
      usedPercent: null,
      estimatedSecondsUntilFull: null,
      estimatedAt: null,
      trendBytesPerSecond: null
    };

    try {
      const stat = await fs.promises.statfs(storePath);
      const bsize = Number(stat.bsize || 0);
      const total = Number(stat.blocks || 0) * bsize;
      const available = Number(stat.bavail || 0) * bsize;
      const used = total > 0 ? Math.max(0, total - available) : null;
      const usedPercent = (total > 0 && used != null) ? (used / total) * 100 : null;

      disk = {
        ...disk,
        availableBytes: available,
        totalBytes: total,
        usedBytes: used,
        usedPercent
      };

      this._operatorHealthSamples.push({ at: now, availableBytes: available });
      if (this._operatorHealthSamples.length > 24) this._operatorHealthSamples.shift();
      const recent = this._operatorHealthSamples.filter((s) => now - s.at <= (6 * 60 * 60 * 1000));
      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dtSec = Math.max(1, (last.at - first.at) / 1000);
        const delta = Number(first.availableBytes) - Number(last.availableBytes);
        const bytesPerSec = delta / dtSec;
        if (Number.isFinite(bytesPerSec) && bytesPerSec > 1) {
          const etaSec = Math.floor(available / bytesPerSec);
          disk.trendBytesPerSecond = bytesPerSec;
          disk.estimatedSecondsUntilFull = etaSec;
          disk.estimatedAt = new Date(now + (etaSec * 1000)).toISOString();
        }
      }
    } catch (err) {
      disk.error = err && err.message ? err.message : String(err);
    }

    let interfacesRaw = {};
    let interfacesError = null;
    try {
      interfacesRaw = os.networkInterfaces() || {};
    } catch (err) {
      interfacesError = err && err.message ? err.message : String(err);
    }
    const interfaces = Object.keys(interfacesRaw).map((name) => {
      const entries = Array.isArray(interfacesRaw[name]) ? interfacesRaw[name] : [];
      return {
        name,
        addresses: entries
          .filter((a) => a && !a.internal)
          .map((a) => ({ family: a.family, address: a.address, netmask: a.netmask, mac: a.mac }))
      };
    }).filter((x) => Array.isArray(x.addresses) && x.addresses.length > 0);

    let dnsProbe = { ok: false, resolver: 'example.com', error: null, addresses: [] };
    try {
      const addresses = await dns.resolve('example.com');
      dnsProbe = { ok: true, resolver: 'example.com', error: null, addresses: Array.isArray(addresses) ? addresses : [] };
    } catch (err) {
      dnsProbe = {
        ok: false,
        resolver: 'example.com',
        error: err && err.message ? err.message : String(err),
        addresses: []
      };
    }

    const targets = this._buildOperatorProbeTargets();
    const probeResults = await Promise.all(targets.map(async (t) => {
      const r = await this._probeTcpLocalPort(t.port, t.host, 800);
      return { ...t, ...r };
    }));

    return {
      now: new Date(now).toISOString(),
      node: {
        hostname,
        platform,
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSec: nodeUptimeSec,
        memory: {
          rss: Number(mem.rss || 0),
          heapUsed: Number(mem.heapUsed || 0),
          heapTotal: Number(mem.heapTotal || 0),
          external: Number(mem.external || 0)
        },
        loadAverage: loadAvg,
        cpu: {
          cores: Math.max(1, Number(os.cpus() && os.cpus().length) || 1),
          processPercent: processCpuPercent,
          processUsageMicros: {
            user: Number(nowCpu.user || 0),
            system: Number(nowCpu.system || 0)
          }
        }
      },
      disk,
      network: {
        interfaces,
        ...(interfacesError ? { interfacesError } : {}),
        dnsProbe,
        localProbes: probeResults
      }
    };
  }

  async _handleOperatorHealthRequest (req, res) {
    try {
      const body = await this._collectOperatorHealthSnapshot();
      res.status(200).json(body);
    } catch (err) {
      res.status(500).json({
        status: 'error',
        message: err && err.message ? err.message : String(err)
      });
    }
  }

  /**
   * L1 Taproot vault derived from federation validator list + threshold (deterministic).
   * @returns {object}
   */
  _buildFederationVaultSummary () {
    const fp = this._getEffectiveFederationPolicyForDistributedHttp();
    const validators = (fp.validators || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean).sort();
    const bitcoin = this._getBitcoinService();
    const networkName = (bitcoin && bitcoin.network) ? String(bitcoin.network) : 'mainnet';
    if (!validators.length) {
      return {
        type: 'FederationVaultSummary',
        status: 'no_validators',
        message: 'Configure federation validator pubkeys (Settings → Distributed federation or env) to derive a vault address.',
        network: networkName,
        address: null,
        policy: null
      };
    }
    const threshold = Math.max(1, Math.min(Number(fp.threshold) || 1, validators.length));
    try {
      const built = federationVault.buildFederationVaultFromPolicy({
        validatorPubkeysHex: validators,
        threshold,
        networkName
      });
      return {
        type: 'FederationVaultSummary',
        status: 'ok',
        network: networkName,
        address: built.address,
        scriptPubKeyHex: built.output.toString('hex'),
        tapscriptHex: built.multisigScript.toString('hex'),
        policy: {
          threshold: built.threshold,
          validatorsSortedHex: built.validatorsSortedHex,
          depositMaturityBlocks: built.depositMaturityBlocks,
          internalKeyHex: built.internalPubkeyHex,
          scheme: 'taproot-tapscript-k-of-n-v1'
        },
        endpoints: {
          vault: '/services/distributed/vault',
          utxos: '/services/distributed/vault/utxos'
        },
        rpc: {
          prepareWithdrawalPsbt: 'PrepareFederationVaultWithdrawalPsbt'
        }
      };
    } catch (e) {
      return {
        type: 'FederationVaultSummary',
        status: 'error',
        message: e && e.message ? e.message : String(e),
        network: networkName,
        address: null,
        policy: null
      };
    }
  }

  _handleDistributedVaultRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const body = this._buildFederationVaultSummary();
      res.status(200).json(body);
    });
  }

  _handleDistributedVaultUtxosRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) {
        return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      }
      const summary = this._buildFederationVaultSummary();
      if (!summary.address) {
        return res.status(200).json({
          type: 'FederationVaultUtxos',
          status: summary.status || 'no_address',
          message: summary.message || 'No vault address',
          address: null,
          network: bitcoin.network,
          totalSats: 0,
          utxos: []
        });
      }
      const scanObj = `addr(${summary.address})`;
      let result;
      try {
        result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
      } catch (err) {
        return res.status(500).json({
          status: 'error',
          message: 'scantxoutset failed (txindex / node readiness)',
          details: err && err.message ? err.message : String(err)
        });
      }
      let tipHeight = null;
      try {
        const ch = await bitcoin._makeRPCRequest('getblockchaininfo', []);
        tipHeight = ch && Number.isFinite(Number(ch.blocks)) ? Number(ch.blocks) : null;
      } catch (_) {}
      const mat = federationVault.DEFAULT_L1_DEPOSIT_MATURITY_BLOCKS;
      const raw = (result && Array.isArray(result.unspents)) ? result.unspents : [];
      const utxos = raw.map((u) => {
        const height = u.height != null ? Number(u.height) : null;
        const confs = tipHeight != null && height != null ? Math.max(0, tipHeight - height + 1) : null;
        return {
          txid: u.txid,
          vout: u.vout,
          amount: u.amount,
          amountSats: Math.round(Number(u.amount || 0) * 100000000),
          height,
          confirmations: confs,
          maturedForWithdrawalPolicy: confs != null ? confs >= mat : null,
          depositMaturityBlocks: mat
        };
      });
      const totalBTC = result && typeof result.total_amount === 'number' ? result.total_amount : 0;
      return res.json({
        type: 'FederationVaultUtxos',
        address: summary.address,
        network: bitcoin.network,
        depositMaturityBlocks: mat,
        totalSats: Math.round(totalBTC * 100000000),
        utxos
      });
    });
  }

  _rpcPrepareFederationVaultWithdrawalPsbt (body = {}) {
    const token = String(body.adminToken || body.token || '').trim();
    if (!this.setup.verifyAdminToken(token)) {
      return { status: 'error', message: 'adminToken required' };
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return { status: 'error', message: 'Bitcoin service unavailable' };
    const validators = this._distributedFederationValidatorsFromEnv();
    if (!validators.length) {
      return { status: 'error', message: 'No federation validators configured' };
    }
    const threshold = this._distributedFederationThresholdEffective();
    let built;
    try {
      built = federationVault.buildFederationVaultFromPolicy({
        validatorPubkeysHex: validators,
        threshold,
        networkName: bitcoin.network || 'mainnet'
      });
    } catch (e) {
      return { status: 'error', message: e && e.message ? e.message : String(e) };
    }
    const vaultAddress = String(body.vaultAddress || built.address).trim();
    if (vaultAddress !== built.address) {
      return { status: 'error', message: 'vaultAddress does not match hub federation policy vault' };
    }
    const fundedTxHex = String(body.fundedTxHex || body.txHex || '').trim();
    if (!fundedTxHex) {
      return { status: 'error', message: 'fundedTxHex is required (full raw tx hex paying the vault)' };
    }
    try {
      const r = federationVault.prepareVaultWithdrawalPsbt({
        networkName: bitcoin.network || 'mainnet',
        fundedTxHex,
        vaultAddress,
        multisigScript: built.multisigScript,
        destinationAddress: body.destinationAddress || body.toAddress,
        feeSats: body.feeSats
      });
      return { type: 'PrepareFederationVaultWithdrawalPsbtResult', ...r };
    } catch (e) {
      return { status: 'error', message: e && e.message ? e.message : String(e) };
    }
  }

  /**
   * Verify that a transaction pays at least amountSats to the given address.
   * @param {Object} bitcoin - Bitcoin service instance
   * @param {string} txid - Transaction ID
   * @param {string} address - Expected recipient address
   * @param {number} amountSats - Minimum amount in satoshis
   * @returns {Promise<boolean>}
   */
  _voutPayeeAddresses (vout) {
    const spk = vout && vout.scriptPubKey;
    if (!spk || typeof spk !== 'object') return [];
    const out = [];
    if (typeof spk.address === 'string' && spk.address) out.push(spk.address);
    if (Array.isArray(spk.addresses)) {
      for (const a of spk.addresses) {
        if (typeof a === 'string' && a) out.push(a);
      }
    }
    return out;
  }

  /**
   * Inspect whether a tx pays `address` at least `amountSats`, and return confirmation depth.
   * @returns {{ verified: boolean, confirmations: number, inMempool: boolean, matchedSats: number }}
   */
  async _l1PaymentVerificationDetail (bitcoin, txid, address, amountSats) {
    const empty = { verified: false, confirmations: 0, inMempool: false, matchedSats: 0 };
    try {
      const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
      if (!tx || !Array.isArray(tx.vout)) return empty;
      const amountBTC = amountSats / 100000000;
      let received = 0;
      for (const vout of tx.vout) {
        const addrs = this._voutPayeeAddresses(vout);
        if (addrs.includes(address)) received += Number(vout.value || 0);
      }
      const verified = received >= amountBTC;
      const confirmations = Number(tx.confirmations != null ? tx.confirmations : 0);
      let inMempool = verified && confirmations === 0;
      if (inMempool) {
        try {
          const mempool = await bitcoin._makeRPCRequest('getrawmempool', []).catch(() => []);
          inMempool = Array.isArray(mempool) && mempool.includes(txid);
        } catch (_) {
          inMempool = verified && confirmations === 0;
        }
      }
      return {
        verified,
        confirmations,
        inMempool: !!inMempool,
        matchedSats: Math.min(Number.MAX_SAFE_INTEGER, Math.round(received * SATS_PER_BTC))
      };
    } catch (err) {
      console.error('[HUB] _l1PaymentVerificationDetail error:', err);
      return empty;
    }
  }

  async _verifyL1Payment (bitcoin, txid, address, amountSats) {
    const d = await this._l1PaymentVerificationDetail(bitcoin, txid, address, amountSats);
    return d.verified;
  }

  /**
   * Confirmation depth + mempool membership for txids (one getrawmempool, parallel getrawtransaction).
   * Used for document list / status without per-row mempool RPC.
   * @returns {Object<string, { confirmations: number|null, inMempool: boolean }>}
   */
  async _l1TxChainStatusBatch (bitcoin, txids) {
    const out = {};
    const unique = [...new Set((txids || []).map((t) => String(t || '').trim()).filter(Boolean))];
    if (!bitcoin || unique.length === 0) return out;
    let mempoolSet = null;
    try {
      const mempool = await bitcoin._makeRPCRequest('getrawmempool', []).catch(() => null);
      mempoolSet = Array.isArray(mempool) ? new Set(mempool) : null;
    } catch (_) {
      mempoolSet = null;
    }
    await Promise.all(unique.map(async (txid) => {
      try {
        const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
        if (!tx) {
          out[txid] = { confirmations: null, inMempool: false };
          return;
        }
        const confirmations = Number(tx.confirmations != null ? tx.confirmations : 0);
        const inMempool = confirmations === 0 && !!(mempoolSet && mempoolSet.has(txid));
        out[txid] = { confirmations, inMempool };
      } catch (_) {
        out[txid] = { confirmations: null, inMempool: false };
      }
    }));
    return out;
  }

  /**
   * Persist a txid → Fabric contract-flow label (survives restarts). Merged into wallet transaction lists.
   * @param {string} txid
   * @param {string} type - machine id (see `functions/txContractLabels.js`)
   * @param {object} [meta]
   */
  _mergePersistedTxLabel (txid, type, meta = {}) {
    const t = String(txid || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(t) || !type) return;
    let map = {};
    try {
      if (this.fs && typeof this.fs.readFile === 'function') {
        const raw = this.fs.readFile('fabric/tx-labels.json');
        if (raw) map = JSON.parse(raw);
      }
    } catch (_) {
      map = {};
    }
    if (!map[t]) map[t] = { types: [], meta: {} };
    if (!map[t].types.includes(type)) map[t].types.push(type);
    if (meta && typeof meta === 'object') Object.assign(map[t].meta, meta);
    try {
      if (this.fs && typeof this.fs.publish === 'function') {
        this.fs.publish('fabric/tx-labels.json', map);
      }
    } catch (e) {
      console.warn('[HUB] fabric/tx-labels.json persist failed:', e && e.message ? e.message : e);
    }
  }

  /**
   * Build lower-case txid → { types, meta } from disk + in-memory Hub state (contracts, HTLC, Payjoin).
   * @returns {Object<string, { types: string[], meta: object }>}
   */
  _collectFabricTxLabelMap () {
    const out = {};
    const add = (txid, type, meta = {}) => {
      const x = String(txid || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(x) || !type) return;
      if (!out[x]) out[x] = { types: [], meta: {} };
      if (!out[x].types.includes(type)) out[x].types.push(type);
      if (meta && typeof meta === 'object') Object.assign(out[x].meta, meta);
    };

    try {
      if (this.fs && typeof this.fs.readFile === 'function') {
        const raw = this.fs.readFile('fabric/tx-labels.json');
        if (raw) {
          const parsed = JSON.parse(raw);
          for (const [k, v] of Object.entries(parsed)) {
            if (!v || typeof v !== 'object') continue;
            const kt = String(k).trim().toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(kt)) continue;
            if (Array.isArray(v.types)) v.types.forEach((ty) => add(kt, ty, v.meta || {}));
          }
        }
      }
    } catch (_) {}

    try {
      const col = this._state && this._state.content && this._state.content.collections && this._state.content.collections.contracts;
      if (col && typeof col === 'object') {
        for (const c of Object.values(col)) {
          if (c && c.txid && c.type === 'StorageContract') {
            add(c.txid, 'storage_contract', { documentId: c.document, contractId: c.id });
          }
        }
      }
    } catch (_) {}

    try {
      for (const s of this._inventoryHtlcById.values()) {
        if (s && s.fundedTxid) {
          add(s.fundedTxid, 'inventory_htlc', {
            documentId: s.documentId,
            settlementId: s.settlementId,
            phase: 'fund',
            amountSats: Number.isFinite(Number(s.amountSats)) ? Math.round(Number(s.amountSats)) : undefined
          });
        }
        if (s && s.claimTxid) {
          add(s.claimTxid, 'inventory_htlc_claim', {
            documentId: s.documentId,
            settlementId: s.settlementId,
            phase: 'seller_claim',
            amountSats: Number.isFinite(Number(s.amountSats)) ? Math.round(Number(s.amountSats)) : undefined
          });
        }
      }
    } catch (_) {}

    try {
      const pj = this._getPayjoinService();
      if (pj && pj._payjoinState && pj._payjoinState.sessions) {
        for (const session of Object.values(pj._payjoinState.sessions)) {
          if (!session || !session.proposals) continue;
          for (const p of Object.values(session.proposals)) {
            if (!p) continue;
            const id = pj.extractProposalTxid(p);
            if (id) {
              add(id, 'payjoin', {
                sessionId: session.id,
                proposalId: p.id,
                amountSats: Number.isFinite(Number(session.amountSats)) ? Math.round(Number(session.amountSats)) : undefined
              });
            }
          }
        }
      }
    } catch (_) {}

    return out;
  }

  /**
   * Label txs that pay to a Payjoin session deposit address (BIP21 deposit flow).
   * @param {Array<object>} transactions
   * @returns {Array<object>}
   */
  _applyPayjoinDepositAddressLabels (transactions) {
    const pj = this._getPayjoinService();
    if (!pj || !pj._payjoinState || !Array.isArray(transactions)) return transactions;
    const sessions = Object.values(pj._payjoinState.sessions || {});
    if (sessions.length === 0) return transactions;
    const byAddr = new Map();
    for (const s of sessions) {
      const addr = s && s.address ? String(s.address).trim() : '';
      if (addr) byAddr.set(addr, { sessionId: s.id, label: s.label || '' });
    }
    if (byAddr.size === 0) return transactions;

    const mergeOnto = (tx, type, meta) => {
      const existing = tx.fabricContract;
      const types = [...new Set([...((existing && existing.types) || []), type])];
      const m = { ...((existing && existing.meta) || {}), ...meta };
      return {
        ...tx,
        fabricContract: {
          types,
          label: txContractLabels.summarizeContractTypes(types),
          meta: m
        }
      };
    };

    return transactions.map((tx) => {
      if (!tx || !Array.isArray(tx.vout)) return tx;
      let meta = null;
      for (const v of tx.vout) {
        const spk = v.scriptPubKey;
        if (!spk || typeof spk !== 'object') continue;
        const one = typeof spk.address === 'string' ? spk.address : null;
        const many = Array.isArray(spk.addresses) ? spk.addresses : [];
        const addrs = one ? [one] : many;
        for (const a of addrs) {
          if (a && byAddr.has(a)) {
            meta = Object.assign({ payjoinAddress: a }, byAddr.get(a));
            break;
          }
        }
        if (meta) break;
      }
      if (!meta) return tx;
      return mergeOnto(tx, 'payjoin_deposit', meta);
    });
  }

  _decorateTransactionsWithFabricLabels (transactions) {
    if (!Array.isArray(transactions)) return [];
    const map = this._collectFabricTxLabelMap();
    const merged = txContractLabels.mergeLabelsOntoTransactions(transactions, map);
    return this._applyPayjoinDepositAddressLabels(merged);
  }

  _computeNodeWealthSummaryFromLabels () {
    const map = this._collectFabricTxLabelMap();
    const totals = {
      payjoin: 0,
      payjoinDeposit: 0,
      inventoryHtlcFund: 0,
      inventoryHtlcClaim: 0,
      storageContract: 0,
      totalLabeled: 0
    };
    const counts = {
      payjoin: 0,
      payjoinDeposit: 0,
      inventoryHtlcFund: 0,
      inventoryHtlcClaim: 0,
      storageContract: 0,
      totalLabeled: 0
    };
    const amountFor = (row) => {
      if (!row || !row.meta) return 0;
      const a = Number(
        row.meta.amountSats != null
          ? row.meta.amountSats
          : (row.meta.purchasePriceSats != null ? row.meta.purchasePriceSats : 0)
      );
      return Number.isFinite(a) && a > 0 ? Math.round(a) : 0;
    };
    for (const row of Object.values(map || {})) {
      if (!row || !Array.isArray(row.types)) continue;
      const amount = amountFor(row);
      const hasType = (t) => row.types.includes(t);
      if (hasType('payjoin')) {
        counts.payjoin += 1;
        if (amount > 0) totals.payjoin += amount;
      }
      if (hasType('payjoin_deposit')) {
        counts.payjoinDeposit += 1;
        if (amount > 0) totals.payjoinDeposit += amount;
      }
      if (hasType('inventory_htlc')) {
        counts.inventoryHtlcFund += 1;
        if (amount > 0) totals.inventoryHtlcFund += amount;
      }
      if (hasType('inventory_htlc_claim')) {
        counts.inventoryHtlcClaim += 1;
        if (amount > 0) totals.inventoryHtlcClaim += amount;
      }
      if (hasType('storage_contract')) {
        counts.storageContract += 1;
        if (amount > 0) totals.storageContract += amount;
      }
      if (row.types.length > 0) counts.totalLabeled += 1;
    }
    totals.totalLabeled = totals.payjoin + totals.storageContract;
    return { counts, totals };
  }

  _pruneInventoryHtlcSettlements () {
    const now = Date.now();
    for (const [k, v] of this._inventoryHtlcById) {
      if (!v || now - (v.createdAt || 0) > INVENTORY_HTLC_TTL_MS) this._inventoryHtlcById.delete(k);
    }
    while (this._inventoryHtlcById.size > INVENTORY_HTLC_MAX_SETTLEMENTS) {
      let oldest = null;
      let oldestKey = null;
      for (const [key, v] of this._inventoryHtlcById) {
        const t = v && v.createdAt ? v.createdAt : 0;
        if (oldest == null || t < oldest) {
          oldest = t; oldestKey = key;
        }
      }
      if (oldestKey != null) this._inventoryHtlcById.delete(oldestKey);
      else break;
    }
  }

  _sellerHtlcPubkeyCompressed () {
    const k = this.agent && this.agent.key;
    if (!k || !k.public || typeof k.public.encodeCompressed !== 'function') return null;
    try {
      return Buffer.from(k.public.encodeCompressed('hex'), 'hex');
    } catch (e) {
      return null;
    }
  }

  /**
   * Send document bytes to a connected peer (P2P_FILE_SEND chunks).
   * @param {string} address - Peer connection key (host:port) — immediate next hop.
   * @param {string|Object} docOrId - Document id or in-memory `{ id, contentBase64, ... }`.
   * @param {Object|null} [fileRelayMeta] - When set, each chunk includes `deliveryFabricId` / `fileRelayTtl` so intermediaries can forward (HTLC phase 2 over a relay).
   * @returns {Promise<{status: string, document: (Object|undefined), message: (string|undefined)}>}
   */
  async _sendDocumentToPeerAddress (address, docOrId, fileRelayMeta = null, htlcEncrypt = null) {
    if (!address || !this.agent.connections[address]) {
      return { status: 'error', message: 'peer not connected' };
    }

    let doc = null;
    if (docOrId && typeof docOrId === 'object' && docOrId.contentBase64) {
      doc = docOrId;
    } else {
      const docIdNorm = this._normalizeDocumentId(docOrId);
      if (!docIdNorm) return { status: 'error', message: 'document id required' };
      try {
        const raw = this.fs.readFile(`documents/${docIdNorm}.json`);
        if (!raw) return { status: 'error', message: 'document not found' };
        doc = JSON.parse(raw);
      } catch (e) {
        return { status: 'error', message: e && e.message ? e.message : 'document read failed' };
      }
    }
    if (!doc || !doc.contentBase64) return { status: 'error', message: 'document content missing' };

    let buf = Buffer.from(doc.contentBase64, 'base64');
    const sizeErr = this._validateDocumentSize(buf);
    if (sizeErr) return sizeErr;

    /** @type {{ v:number, iv:string, paymentHashHex:string }|null} */
    let htlcFileV1Header = null;
    if (htlcEncrypt && htlcEncrypt.preimage32) {
      const preimageBuf = Buffer.isBuffer(htlcEncrypt.preimage32)
        ? htlcEncrypt.preimage32
        : Buffer.from(String(htlcEncrypt.preimage32), 'hex');
      if (preimageBuf.length !== 32) {
        return { status: 'error', message: 'HTLC preimage must be 32 bytes.' };
      }
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', preimageBuf, iv);
      const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
      const tag = cipher.getAuthTag();
      buf = Buffer.concat([enc, tag]);
      htlcFileV1Header = {
        v: 1,
        iv: iv.toString('base64'),
        paymentHashHex: crypto.createHash('sha256').update(preimageBuf).digest('hex')
      };
    }

    const totalChunks = Math.max(1, Math.ceil(buf.length / P2P_FILE_CHUNK_BYTES));
    const transferId = `${doc.id || (doc.sha256 || 'document')}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;

    let relayExtras = null;
    if (fileRelayMeta && fileRelayMeta.deliveryFabricId) {
      let ttl = Number(fileRelayMeta.fileRelayTtl);
      if (!Number.isFinite(ttl) || ttl <= 0) ttl = INVENTORY_FILE_RELAY_TTL;
      ttl = Math.min(16, Math.max(1, Math.round(ttl)));
      relayExtras = {
        deliveryFabricId: String(fileRelayMeta.deliveryFabricId).trim(),
        fileRelayTtl: ttl
      };
    }

    for (let index = 0; index < totalChunks; index++) {
      const start = index * P2P_FILE_CHUNK_BYTES;
      const end = start + P2P_FILE_CHUNK_BYTES;
      const chunkContentBase64 = buf.subarray(start, end).toString('base64');
      const filePayload = {
        type: 'P2P_FILE_SEND',
        actor: { id: this.agent.identity.id },
        object: {
          id: doc.id,
          name: doc.name,
          mime: doc.mime || 'application/octet-stream',
          size: doc.size,
          sha256: doc.sha256 || doc.id,
          contentBase64: chunkContentBase64,
          created: doc.created || new Date().toISOString(),
          target: address,
          htlcSettlement: true,
          ...(index === 0 && htlcFileV1Header ? { htlcFileV1: htlcFileV1Header } : {}),
          ...(relayExtras || {}),
          part: { transferId, index, total: totalChunks }
        }
      };
      this._sendVectorToPeer(address, ['P2P_FILE_SEND', JSON.stringify(filePayload)]);
    }

    this.recordActivity({
      type: 'Send',
      object: {
        type: 'Document',
        id: doc.id,
        name: doc.name,
        mime: doc.mime || 'application/octet-stream',
        size: doc.size,
        sha256: doc.sha256 || doc.id
      },
      target: address
    });

    return { status: 'success', document: { id: doc.id, name: doc.name } };
  }

  async _attachHtlcToInventoryItems (items, message, htlcDirectConn, requesterFabricId, relayReturnHop = null) {
    const obj = (message && message.object) || {};
    const buyerHex = String(obj.buyerRefundPublicKey || '').trim();
    if (!buyerHex || !/^[0-9a-fA-F]{66}$/.test(buyerHex)) return items;

    const buyerBuf = Buffer.from(buyerHex, 'hex');
    if (buyerBuf.length !== 33 || (buyerBuf[0] !== 0x02 && buyerBuf[0] !== 0x03)) return items;

    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return items;

    const sellerPub = this._sellerHtlcPubkeyCompressed();
    if (!sellerPub || sellerPub.length !== 33) {
      console.warn('[HUB] inventory HTLC skipped: no seller compressed pubkey from agent key.');
      return items;
    }

    let lockBlocks = Number(obj.htlcLocktimeBlocks);
    if (!Number.isFinite(lockBlocks) || lockBlocks <= 0) lockBlocks = 144;
    lockBlocks = Math.min(Math.max(Math.round(lockBlocks), 36), 10000);

    let height = 0;
    try {
      height = await bitcoin._makeRPCRequest('getblockcount', []);
    } catch (e) {
      console.warn('[HUB] inventory HTLC: getblockcount failed:', e && e.message ? e.message : e);
      return items;
    }
    const refundHeight = height + lockBlocks;
    const globalAmt = Number(obj.htlcAmountSats || 0);
    const netName = bitcoin.network || 'regtest';

    this._pruneInventoryHtlcSettlements();

    const results = await Promise.all(items.map(async (meta) => {
      if (!meta || !meta.id) return meta;
      const amt = Number(meta.purchasePriceSats || globalAmt || 0);
      if (!Number.isFinite(amt) || amt <= 0) return meta;

      const docIdNorm = this._normalizeDocumentId(meta.id);
      let raw;
      try {
        raw = this.fs.readFile(`documents/${docIdNorm}.json`);
      } catch (e) {
        return meta;
      }
      if (!raw) return meta;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return meta;
      }
      if (!parsed.contentBase64) return meta;
      let contentBuffer;
      try {
        contentBuffer = Buffer.from(parsed.contentBase64, 'base64');
      } catch (e) {
        return meta;
      }
      const sizeErr = this._validateDocumentSize(contentBuffer);
      if (sizeErr) return meta;

      // Preimage = sha256(DocumentPublish Fabric Message bytes); same binding as CreatePurchaseInvoice.
      let preimage;
      try {
        preimage = publishedDocumentEnvelope.inventoryHtlcPreimage32(docIdNorm, parsed);
      } catch (e) {
        console.warn('[HUB] inventory HTLC: publish envelope preimage failed:', e && e.message ? e.message : e);
        return meta;
      }
      const paymentHash = inventoryHtlc.hash256(preimage);
      let built;
      try {
        built = inventoryHtlc.buildInventoryHtlcP2tr({
          networkName: netName,
          sellerPubkeyCompressed: sellerPub,
          buyerRefundPubkeyCompressed: buyerBuf,
          paymentHash32: paymentHash,
          refundLocktimeHeight: refundHeight
        });
      } catch (err) {
        console.error('[HUB] inventory HTLC build failed:', err);
        return meta;
      }

      const settlementId = crypto.randomBytes(16).toString('hex');
      const fundingHints = inventoryHtlc.buildHtlcFundingHints({
        paymentAddress: built.address,
        amountSats: Math.round(amt),
        label: `Fabric doc ${meta.id.slice(0, 12)}…`
      });

      this._inventoryHtlcById.set(settlementId, {
        settlementId,
        documentId: meta.id,
        preimageHex: preimage.toString('hex'),
        paymentHashHex: paymentHash.toString('hex'),
        paymentAddress: built.address,
        amountSats: Math.round(amt),
        requesterConnection: htlcDirectConn || null,
        requesterFabricId: requesterFabricId || null,
        relayReturnHop: relayReturnHop || null,
        refundLockHeight: refundHeight,
        createdAt: Date.now(),
        status: 'AWAITING_FUNDING',
        fundedTxid: null,
        claimScriptHex: built.claimScript.toString('hex'),
        refundScriptHex: built.refundScript.toString('hex'),
        numsInternalPubkeyHex: inventoryHtlc.TAPROOT_INTERNAL_NUMS.toString('hex'),
        sellerPublicKeyHex: sellerPub.toString('hex')
      });

      return {
        ...meta,
        htlc: {
          kind: 'P2TR_SCRIPT_PATH',
          settlementId,
          paymentAddress: built.address,
          paymentHashHex: paymentHash.toString('hex'),
          amountSats: Math.round(amt),
          amountBtc: fundingHints.amountBtc,
          bitcoinUri: fundingHints.bitcoinUri,
          refundLockHeight: refundHeight,
          locktimeDeltaBlocks: lockBlocks,
          sellerPublicKeyHex: sellerPub.toString('hex'),
          note: 'Fund this Taproot output for the agreed amount (BIP21 URI when supported). After confirmation the seller pushes phase 2 (AES-GCM ciphertext; unlock preimage = sha256(canonical Fabric DocumentPublish message wrapping the stored document JSON fields)). Same preimage as JSON-RPC CreatePurchaseInvoice content-hash chain. Buyer refund path: CLTV after refundLockHeight using buyerRefundPublicKey from the request. See INVENTORY_HTLC_ONCHAIN.md for manual seller claim.',
          walletHint: 'Send to paymentAddress with at least amountSats; many wallets accept bitcoin: Taproot URIs. Fee is separate from invoice amount.'
        }
      };
    }));
    return results;
  }

  async _confirmInventoryHtlcPayment (body = {}) {
    const _htlcResult = (obj) => Object.assign({ type: 'ConfirmInventoryHtlcPaymentResult' }, obj);

    const settlementId = String(body.settlementId || '').trim();
    const txid = String(body.txid || '').trim();
    if (!settlementId || !txid) {
      return _htlcResult({ status: 'error', message: 'settlementId and txid are required.' });
    }

    const s = this._inventoryHtlcById.get(settlementId);
    if (!s) return _htlcResult({ status: 'error', message: 'Unknown or expired HTLC settlement.' });
    if (s.status === 'COMPLETED') {
      return _htlcResult({
        status: 'success',
        message: 'Already completed.',
        documentId: s.documentId,
        settlementId,
        txid: s.fundedTxid
      });
    }

    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return _htlcResult({ status: 'error', message: 'Bitcoin service unavailable.' });

    const needVerify = s.status !== 'FUNDED_PENDING_SEND' || s.fundedTxid !== txid;
    if (needVerify) {
      const ok = await this._verifyL1Payment(bitcoin, txid, s.paymentAddress, s.amountSats);
      if (!ok) {
        return _htlcResult({
          status: 'error',
          message: 'Transaction does not pay the HTLC address for at least the invoice amount (or tx not visible).'
        });
      }
      s.status = 'FUNDED_PENDING_SEND';
      s.fundedTxid = txid;
      try {
        this._mergePersistedTxLabel(txid, 'inventory_htlc', { documentId: s.documentId, settlementId, phase: 'fund' });
      } catch (_) {}
    }

    let addr = null;
    if (s.requesterConnection && this.agent.connections[s.requesterConnection]) {
      addr = s.requesterConnection;
    }
    if (!addr && s.requesterFabricId) {
      addr = this._resolvePeerAddress(s.requesterFabricId);
    }
    let fileRelayMeta = null;
    if (!addr || !this.agent.connections[addr]) {
      if (
        s.relayReturnHop && this.agent.connections[s.relayReturnHop] &&
        s.requesterFabricId
      ) {
        addr = s.relayReturnHop;
        fileRelayMeta = {
          deliveryFabricId: s.requesterFabricId,
          fileRelayTtl: INVENTORY_FILE_RELAY_TTL
        };
      }
    }

    if (!addr || !this.agent.connections[addr]) {
      return _htlcResult({
        status: 'error',
        message: 'Payment verified, but the buyer peer is not connected. Reconnect the same peer (or ensure the relay is online), then call ConfirmInventoryHtlcPayment again with the same txid.',
        funded: true,
        settlementId,
        documentId: s.documentId
      });
    }

    const sendRes = await this._sendDocumentToPeerAddress(addr, s.documentId, fileRelayMeta, {
      preimage32: Buffer.from(s.preimageHex, 'hex')
    });
    if (!sendRes || sendRes.status !== 'success') {
      return _htlcResult({
        status: 'error',
        message: (sendRes && sendRes.message) || 'Failed to send document after payment.',
        funded: true,
        settlementId,
        retryWithSameTxid: true
      });
    }

    s.status = 'COMPLETED';
    console.debug('[HUB] INVENTORY HTLC phase 2: sent document', s.documentId, 'to', addr, 'txid', txid);
    return _htlcResult({ status: 'success', settlementId, documentId: s.documentId, txid });
  }

  /**
   * Admin-only: preimage + scripts for seller on-chain claim tooling (see INVENTORY_HTLC_ONCHAIN.md).
   * @param {Object} body - { settlementId, adminToken|token }
   */
  _getInventoryHtlcSellerReveal (body = {}) {
    const token = body.adminToken || body.token;
    const deny = (msg) => ({
      type: 'GetInventoryHtlcSellerRevealResult',
      status: 'error',
      message: msg
    });
    if (!this.setup.verifyAdminToken(token)) return deny('Admin token required.');
    const settlementId = String(body.settlementId || '').trim();
    if (!settlementId) return deny('settlementId is required.');
    const s = this._inventoryHtlcById.get(settlementId);
    if (!s) return deny('Unknown or expired HTLC settlement.');
    return {
      type: 'GetInventoryHtlcSellerRevealResult',
      status: 'success',
      settlementId,
      documentId: s.documentId,
      preimageHex: s.preimageHex,
      paymentHashHex: s.paymentHashHex,
      paymentAddress: s.paymentAddress,
      amountSats: s.amountSats,
      refundLockHeight: s.refundLockHeight,
      claimScriptHex: s.claimScriptHex,
      refundScriptHex: s.refundScriptHex,
      numsInternalPubkeyHex: s.numsInternalPubkeyHex,
      sellerPublicKeyHex: s.sellerPublicKeyHex,
      htlcStatus: s.status,
      fundedTxid: s.fundedTxid || undefined,
      claimTxid: s.claimTxid || undefined,
      relayReturnHop: s.relayReturnHop || undefined,
      requesterFabricId: s.requesterFabricId || undefined
    };
  }

  /**
   * Admin-only: build, sign (hub Fabric identity key), and broadcast seller claim for a funded inventory HTLC.
   * Params: { settlementId, adminToken|token, toAddress?, destinationAddress?, feeSats? }
   */
  async _claimInventoryHtlcOnChain (body = {}) {
    const deny = (msg) => ({
      type: 'ClaimInventoryHtlcOnChainResult',
      status: 'error',
      message: msg
    });
    const token = body.adminToken || body.token;
    if (!this.setup.verifyAdminToken(token)) return deny('Admin token required.');
    const settlementId = String(body.settlementId || '').trim();
    if (!settlementId) return deny('settlementId is required.');
    const s = this._inventoryHtlcById.get(settlementId);
    if (!s) return deny('Unknown or expired HTLC settlement.');
    if (!s.fundedTxid) return deny('No fundedTxid; verify payment with ConfirmInventoryHtlcPayment first.');
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return deny('Bitcoin service unavailable.');
    const key = this.agent && this.agent.key;
    const priv = key && key.keypair && typeof key.keypair.getPrivate === 'function'
      ? key.keypair.getPrivate('bytes')
      : null;
    if (!priv || !Buffer.isBuffer(priv) || priv.length !== 32) {
      return deny('Hub identity key has no usable secp256k1 private key for signing.');
    }
    const sellerHex = this._sellerHtlcPubkeyCompressed();
    if (!sellerHex) return deny('Could not derive seller pubkey from hub key.');
    try {
      const ecpairMod = require('ecpair');
      const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
      const ecc = require('@fabric/core/types/ecc');
      const kp = ECPairFactory(ecc).fromPrivateKey(priv);
      if (kp.publicKey.toString('hex') !== sellerHex.toString('hex')) {
        return deny('Hub key does not match settlement sellerPublicKeyHex; refusing to sign.');
      }
    } catch (e) {
      return deny(e && e.message ? e.message : 'Key check failed.');
    }
    let rawHex;
    try {
      rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [s.fundedTxid, false]);
    } catch (e) {
      return deny(e && e.message ? e.message : 'getrawtransaction failed.');
    }
    const dest = String(body.toAddress || body.destinationAddress || '').trim() || await bitcoin.getUnusedAddress();
    const feeSats = Number(body.feeSats || 1000);
    const claimScript = Buffer.from(s.claimScriptHex, 'hex');
    const refundScript = Buffer.from(s.refundScriptHex, 'hex');
    const preimage = Buffer.from(s.preimageHex, 'hex');
    let bundle;
    try {
      bundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
        networkName: bitcoin.network || 'regtest',
        fundedTxHex: rawHex,
        paymentAddress: s.paymentAddress,
        claimScript,
        refundScript,
        preimage32: preimage,
        destinationAddress: dest,
        feeSats
      });
    } catch (e) {
      return deny(e && e.message ? e.message : 'Failed to build claim transaction.');
    }
    let txHex;
    try {
      ({ txHex } = inventoryHtlc.signAndExtractInventoryHtlcSellerClaim(bundle, priv));
    } catch (e) {
      return deny(e && e.message ? e.message : 'Failed to sign claim transaction.');
    }
    let claimTxid;
    try {
      claimTxid = await bitcoin._makeRPCRequest('sendrawtransaction', [txHex]);
    } catch (e) {
      return deny(e && e.message ? e.message : 'sendrawtransaction failed.');
    }
    s.claimTxid = claimTxid;
    try {
      this._mergePersistedTxLabel(claimTxid, 'inventory_htlc_claim', { documentId: s.documentId, settlementId, phase: 'seller_claim' });
    } catch (_) {}
    console.debug('[HUB] INVENTORY HTLC seller claim broadcast', settlementId, claimTxid);
    return {
      type: 'ClaimInventoryHtlcOnChainResult',
      status: 'success',
      settlementId,
      claimTxid,
      fundedTxid: s.fundedTxid,
      toAddress: dest,
      feeSats: bundle.fee,
      destSats: bundle.destSats
    };
  }

  _documentOfferAllowPublicBroadcast () {
    const b = this.settings.bitcoin || {};
    if (b.publicDocumentOfferBroadcast === true) return true;
    return String(b.network || '').toLowerCase() === 'regtest';
  }

  /**
   * JSON-RPC: relay a signed raw tx to bitcoind. On regtest (or if settings.bitcoin.publicDocumentOfferBroadcast),
   * no admin token; otherwise requires adminToken.
   */
  async _rpcBroadcastSignedTransaction (body = {}) {
    const hex = String(body.signedTxHex || body.txHex || body.hex || '').replace(/\s+/g, '');
    if (!hex) return { status: 'error', message: 'signedTxHex (raw hex) is required.' };
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return { status: 'error', message: 'Bitcoin service unavailable.' };
    if (!this._documentOfferAllowPublicBroadcast()) {
      const token = body.adminToken || body.token;
      if (!this.setup.verifyAdminToken(token)) {
        return { status: 'error', message: 'adminToken required to broadcast (or enable regtest / publicDocumentOfferBroadcast).' };
      }
    }
    try {
      const txid = await bitcoin._makeRPCRequest('sendrawtransaction', [hex]);
      await this._collectBitcoinStatus({ force: true }).catch(() => {});
      return { type: 'BroadcastSignedTransactionResult', status: 'success', txid };
    } catch (e) {
      return { status: 'error', message: e && e.message ? e.message : String(e) };
    }
  }

  _buildDocumentOfferEscrow (body = {}) {
    try {
      const bitcoin = this._getBitcoinService();
      const networkName = String(
        body.networkName || (bitcoin && bitcoin.network) || 'regtest'
      ).toLowerCase();
      const delivererPubkeyHex = String(body.delivererPubkeyHex || '').trim();
      const initiatorRefundPubkeyHex = String(body.initiatorRefundPubkeyHex || '').trim();
      const paymentHashHex = String(body.paymentHashHex || '').trim();
      const refundLockHeight = Number(body.refundLockHeight);
      if (!delivererPubkeyHex || !initiatorRefundPubkeyHex || !paymentHashHex) {
        return {
          type: 'BuildDocumentOfferEscrowResult',
          status: 'error',
          message: 'delivererPubkeyHex, initiatorRefundPubkeyHex, and paymentHashHex are required.'
        };
      }
      if (!Number.isFinite(refundLockHeight) || refundLockHeight < 1) {
        return {
          type: 'BuildDocumentOfferEscrowResult',
          status: 'error',
          message: 'refundLockHeight must be a positive block height.'
        };
      }
      const built = documentOfferEscrow.buildDocumentOfferEscrow({
        networkName,
        delivererPubkeyHex,
        initiatorRefundPubkeyHex,
        paymentHashHex,
        refundLockHeight,
        amountSats: Math.round(Number(body.rewardSats || body.amountSats || 0)),
        label: String(body.label || 'document-offer').slice(0, 120)
      });
      return {
        type: 'BuildDocumentOfferEscrowResult',
        status: 'success',
        networkName,
        ...built
      };
    } catch (e) {
      return {
        type: 'BuildDocumentOfferEscrowResult',
        status: 'error',
        message: e && e.message ? e.message : String(e)
      };
    }
  }

  async _rpcVerifyDocumentOfferFunding (body = {}) {
    const txid = String(body.fundingTxid || body.txid || '').trim().toLowerCase();
    const address = String(body.paymentAddress || '').trim();
    const rewardSats = Math.round(Number(body.rewardSats || body.amountSats || 0));
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      return { type: 'VerifyDocumentOfferFundingResult', status: 'error', message: 'fundingTxid must be 64 hex chars.' };
    }
    if (!address) {
      return { type: 'VerifyDocumentOfferFundingResult', status: 'error', message: 'paymentAddress is required.' };
    }
    if (!Number.isFinite(rewardSats) || rewardSats < 1) {
      return { type: 'VerifyDocumentOfferFundingResult', status: 'error', message: 'rewardSats must be a positive integer.' };
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return { type: 'VerifyDocumentOfferFundingResult', status: 'error', message: 'Bitcoin service unavailable.' };
    try {
      const detail = await this._l1PaymentVerificationDetail(bitcoin, txid, address, rewardSats);
      let fundingVout = -1;
      try {
        const rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [txid, false]);
        const bitcoinjs = require('bitcoinjs-lib');
        const tx = bitcoinjs.Transaction.fromHex(rawHex);
        const net = inventoryHtlc.networkForFabricName(bitcoin.network || 'mainnet');
        fundingVout = inventoryHtlc.findP2trVoutForAddress(tx, address, net);
      } catch (_) { /* optional */ }
      return {
        type: 'VerifyDocumentOfferFundingResult',
        status: 'success',
        verified: !!detail.verified,
        confirmations: detail.confirmations,
        inMempool: !!detail.inMempool,
        matchedSats: detail.matchedSats,
        fundingVout: fundingVout >= 0 ? fundingVout : undefined,
        txid,
        address,
        rewardSats
      };
    } catch (e) {
      return {
        type: 'VerifyDocumentOfferFundingResult',
        status: 'error',
        message: e && e.message ? e.message : String(e)
      };
    }
  }

  async _rpcPrepareDocumentOfferDelivererClaimPsbt (body = {}) {
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) {
      return { type: 'PrepareDocumentOfferDelivererClaimPsbtResult', status: 'error', message: 'Bitcoin service unavailable.' };
    }
    const fundedTxid = String(body.fundingTxid || '').trim();
    const paymentAddress = String(body.paymentAddress || '').trim();
    const claimScriptHex = String(body.claimScriptHex || '').trim();
    const refundScriptHex = String(body.refundScriptHex || '').trim();
    const preimageHex = String(body.preimageHex || body.revealedPreimageHex || '').trim().replace(/^0x/i, '');
    const destinationAddress = String(body.destinationAddress || body.toAddress || '').trim();
    const feeSats = Math.max(1, Math.round(Number(body.feeSats || 1000)));
    if (!/^[0-9a-f]{64}$/i.test(fundedTxid) || !paymentAddress || !claimScriptHex || !refundScriptHex) {
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'error',
        message: 'fundingTxid, paymentAddress, claimScriptHex, and refundScriptHex are required.'
      };
    }
    if (!/^[0-9a-f]{64}$/i.test(preimageHex)) {
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'error',
        message: 'preimageHex must be 64 hex characters (32 bytes).'
      };
    }
    if (!destinationAddress) {
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'error',
        message: 'destinationAddress is required.'
      };
    }
    let rawHex;
    try {
      rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [fundedTxid, false]);
    } catch (e) {
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'error',
        message: e && e.message ? e.message : 'getrawtransaction failed.'
      };
    }
    try {
      const bundle = inventoryHtlc.prepareInventoryHtlcSellerClaimPsbt({
        networkName: bitcoin.network || 'mainnet',
        fundedTxHex: rawHex,
        paymentAddress,
        claimScript: Buffer.from(claimScriptHex, 'hex'),
        refundScript: Buffer.from(refundScriptHex, 'hex'),
        preimage32: Buffer.from(preimageHex, 'hex'),
        destinationAddress,
        feeSats
      });
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'success',
        psbtBase64: bundle.psbt.toBase64(),
        feeSats: bundle.fee,
        destSats: bundle.destSats,
        inputSats: bundle.inputSats,
        fundingVout: bundle.vout
      };
    } catch (e) {
      return {
        type: 'PrepareDocumentOfferDelivererClaimPsbtResult',
        status: 'error',
        message: e && e.message ? e.message : String(e)
      };
    }
  }

  async _rpcPrepareDocumentOfferInitiatorRefundPsbt (body = {}) {
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) {
      return { type: 'PrepareDocumentOfferInitiatorRefundPsbtResult', status: 'error', message: 'Bitcoin service unavailable.' };
    }
    const fundedTxid = String(body.fundingTxid || '').trim();
    const paymentAddress = String(body.paymentAddress || '').trim();
    const claimScriptHex = String(body.claimScriptHex || '').trim();
    const refundScriptHex = String(body.refundScriptHex || '').trim();
    const refundLockHeight = Number(body.refundLockHeight);
    const destinationAddress = String(body.destinationAddress || body.toAddress || '').trim();
    const feeSats = Math.max(1, Math.round(Number(body.feeSats || 1000)));
    if (!/^[0-9a-f]{64}$/i.test(fundedTxid) || !paymentAddress || !claimScriptHex || !refundScriptHex) {
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'error',
        message: 'fundingTxid, paymentAddress, claimScriptHex, and refundScriptHex are required.'
      };
    }
    if (!Number.isFinite(refundLockHeight) || refundLockHeight < 1) {
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'error',
        message: 'refundLockHeight is required.'
      };
    }
    if (!destinationAddress) {
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'error',
        message: 'destinationAddress is required.'
      };
    }
    let chainTip = Number(body.chainTipHeight);
    if (!Number.isFinite(chainTip)) {
      try {
        const info = await bitcoin._makeRPCRequest('getblockchaininfo', []);
        chainTip = info && Number(info.blocks);
      } catch (_) {
        chainTip = NaN;
      }
    }
    let rawHex;
    try {
      rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [fundedTxid, false]);
    } catch (e) {
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'error',
        message: e && e.message ? e.message : 'getrawtransaction failed.'
      };
    }
    try {
      const bundle = inventoryHtlc.prepareInventoryHtlcBuyerRefundPsbt({
        networkName: bitcoin.network || 'mainnet',
        fundedTxHex: rawHex,
        paymentAddress,
        claimScript: Buffer.from(claimScriptHex, 'hex'),
        refundScript: Buffer.from(refundScriptHex, 'hex'),
        refundLocktimeHeight: refundLockHeight,
        destinationAddress,
        feeSats
      });
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'success',
        psbtBase64: bundle.psbt.toBase64(),
        feeSats: bundle.fee,
        destSats: bundle.destSats,
        inputSats: bundle.inputSats,
        locktime: bundle.locktime,
        chainTipHeight: Number.isFinite(chainTip) ? chainTip : undefined,
        refundValidOnChain: Number.isFinite(chainTip) ? chainTip >= refundLockHeight : undefined
      };
    } catch (e) {
      return {
        type: 'PrepareDocumentOfferInitiatorRefundPsbtResult',
        status: 'error',
        message: e && e.message ? e.message : String(e)
      };
    }
  }

  /**
   * HTTP JSON-RPC for the same method set as WebSocket `JSONCall` (`this.http._registerMethod`).
   * Registered as an explicit route so `POST /services/rpc` is not handled by the SPA `POST /*`
   * resource path (which would return 500 for unknown POST /services/...).
   */
  async _handleHttpJsonRpcRequest (req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const method = typeof body.method === 'string' ? body.method : '';
    const rawParams = body.params;
    const paramArray = rawParams === undefined || rawParams === null
      ? []
      : (Array.isArray(rawParams) ? rawParams : [rawParams]);
    const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;

    if (!method) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'method required' }, id });
    }

    const fn = this.http.methods && this.http.methods[method];
    if (!fn) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
    }

    const addr = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
    const isLocal = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    this._rpcHttpIsLocal = isLocal;
    try {
      const result = await Promise.resolve(fn.apply(this.http, paramArray));
      res.setHeader('Content-Type', 'application/json');
      if (body.jsonrpc === '2.0') {
        return res.status(200).json({ jsonrpc: '2.0', result, id });
      }
      return res.status(200).json({ result });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error('[HUB] HTTP JSON-RPC error:', method, msg);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: msg },
        id
      });
    } finally {
      this._rpcHttpIsLocal = false;
    }
  }

  /**
   * Returns minimal public Bitcoin status for global state / GetNetworkStatus.
   * Excludes balance, beacon, blockchain, networkInfo, mempoolInfo, recentBlocks, recentTransactions.
   */
  _normBitcoinChainHeight (heightRaw, blockchain) {
    let n = heightRaw != null && heightRaw !== '' ? Number(heightRaw) : NaN;
    if (!Number.isFinite(n) && blockchain && typeof blockchain === 'object' && blockchain.blocks != null) {
      n = Number(blockchain.blocks);
    }
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }

  _sanitizeBitcoinStatusForPublic (full) {
    if (!full || typeof full !== 'object') return { available: false, status: 'UNKNOWN', message: 'No status.' };
    const mempoolInfo = full.mempoolInfo && typeof full.mempoolInfo === 'object' ? full.mempoolInfo : null;
    const mempoolTxCount = mempoolInfo && mempoolInfo.size != null ? Number(mempoolInfo.size) : undefined;
    const mempoolBytes = mempoolInfo && mempoolInfo.bytes != null ? Number(mempoolInfo.bytes) : undefined;
    const bestBlockHash = full.bestHash != null && String(full.bestHash).trim()
      ? String(full.bestHash).trim()
      : undefined;
    const heightNorm = this._normBitcoinChainHeight(full.height, full.blockchain);
    const p2pTargets = full.p2pAddNodeTargets;
    return {
      available: !!full.available,
      status: full.status || (full.available ? 'ONLINE' : 'UNAVAILABLE'),
      network: full.network || null,
      ...(heightNorm != null ? { height: heightNorm } : {}),
      ...(bestBlockHash ? { bestBlockHash } : {}),
      message: full.message || undefined,
      ...(mempoolTxCount != null && Number.isFinite(mempoolTxCount) ? { mempoolTxCount } : {}),
      ...(mempoolBytes != null && Number.isFinite(mempoolBytes) ? { mempoolBytes } : {}),
      ...(Array.isArray(p2pTargets) && p2pTargets.length
        ? { p2pAddNodeTargets: p2pTargets.slice(0, 16) }
        : {}),
      ...(full.bitcoinPruned != null ? { bitcoinPruned: !!full.bitcoinPruned } : {}),
      ...(Number.isFinite(full.bitcoinPruneHeight) ? { bitcoinPruneHeight: Math.round(full.bitcoinPruneHeight) } : {})
    };
  }

  /**
   * Positive sats listed on Bitcoin block/tx Fabric documents for inventory HTLC (`purchasePriceSats`).
   * @param {'block'|'transaction'} kind
   * @returns {number|undefined}
   */
  _resolveBitcoinDocumentInventoryPriceSats (kind) {
    const b = this.settings && this.settings.bitcoin ? this.settings.bitcoin : {};
    let raw;
    if (kind === 'block') {
      raw = b.documentInventoryBlockPriceSats;
    } else if (kind === 'transaction') {
      raw = b.documentInventoryTransactionPriceSats;
    } else {
      return undefined;
    }
    const n = raw != null && raw !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n);
  }

  /**
   * Unpublish and delete on-disk Bitcoin index documents whose `bitcoinHeight` is below Core `pruneheight`.
   * Local-only: does not append Fabric `Tombstone` (catalogs may diverge; Beacon + P2P `BitcoinBlock` stay aligned).
   */
  async _dropLocalPublishedBitcoinIndexBelowPruneHeight (pruneHeight) {
    const { isDocumentHeightPruned } = require('../functions/bitcoinPruneInventory');
    if (pruneHeight == null || !Number.isFinite(pruneHeight)) return { dropped: 0 };
    this._ensureResourceCollections();
    const coll = this._state.content.collections.documents || {};
    const docs = this._state.documents || {};
    const ids = Object.keys(coll).filter((id) => {
      const c = coll[id];
      const d = docs[id];
      const mime = (d && d.mime) || (c && c.mime) || '';
      if (mime !== FABRIC_BITCOIN_BLOCK_DOC_MIME && mime !== FABRIC_BITCOIN_TX_DOC_MIME) return false;
      const h = (d && d.bitcoinHeight != null) ? d.bitcoinHeight : (c && c.bitcoinHeight);
      return isDocumentHeightPruned(pruneHeight, h);
    });
    let dropped = 0;
    for (const id of ids) {
      const unp = this._unpublishDocument(id);
      if (!unp.ok) continue;
      try {
        if (this.fs && typeof this.fs.delete === 'function') this.fs.delete(`documents/${id}.json`);
      } catch (e) {
        console.warn('[HUB:BITCOIN] prune doc file delete:', id, e && e.message ? e.message : e);
      }
      if (this._state.documents[id]) delete this._state.documents[id];
      dropped++;
    }
    if (dropped > 0) {
      this._refreshChainState('bitcoin-prune-inventory');
      this.commit();
      if (typeof this._pushNetworkStatus === 'function') {
        try {
          this._pushNetworkStatus();
        } catch (_) { /* optional */ }
      }
      console.log(
        '[HUB:BITCOIN] dropped', dropped,
        'local Bitcoin block/tx documents below prune height', pruneHeight,
        '(restore via peers / Document Market; chain tips still follow Beacon / P2P)'
      );
    }
    return { dropped };
  }

  async _syncPrunedBitcoinIndexDocuments (status) {
    if (!status || !status.available || !status.blockchain) return;
    const { pruned, pruneHeight } = require('../functions/bitcoinPruneInventory').pruneStatusFromBlockchainInfo(status.blockchain);
    if (!pruned || pruneHeight == null) return;
    await this._dropLocalPublishedBitcoinIndexBelowPruneHeight(pruneHeight);
  }

  async _collectBitcoinStatus (options = {}) {
    const force = !!options.force;
    const now = Date.now();
    this._state.content.services = this._state.content.services || {};
    this._state.content.services.bitcoin = this._state.content.services.bitcoin || {};
    if (!force && this._bitcoinStatusCache.value && (now - this._bitcoinStatusCache.updatedAt) < this._bitcoinCacheTTL) {
      return this._bitcoinStatusCache.value;
    }

    const bitcoin = this._getBitcoinService();
    if (!bitcoin) {
      const unavailable = {
        available: false,
        status: 'UNAVAILABLE',
        message: 'Bitcoin service is not configured on this Hub node.',
        balance: 0,
        beacon: { balanceSats: 0, clock: 0 }
      };
      this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic(unavailable);
      this._bitcoinStatusCache = { value: unavailable, updatedAt: now };
      return unavailable;
    }

    const walletName = (bitcoin.walletName || (bitcoin.settings && bitcoin.settings.walletName)) || null;
    const getBalances = walletName && typeof bitcoin._makeWalletRequest === 'function'
      ? () => bitcoin._makeWalletRequest('getbalances', [], walletName).catch(() => bitcoin._makeRPCRequest('getbalances', []).catch(() => null))
      : () => bitcoin._makeRPCRequest('getbalances', []).catch(() => null);

    try {
      const [blockchain, networkInfo, balances, bestHash, height, mempoolInfo] = await Promise.all([
        bitcoin._makeRPCRequest('getblockchaininfo', []),
        bitcoin._makeRPCRequest('getnetworkinfo', []),
        getBalances(),
        bitcoin._makeRPCRequest('getbestblockhash', []),
        bitcoin._makeRPCRequest('getblockcount', []),
        bitcoin._makeRPCRequest('getmempoolinfo', []).catch(() => null)
      ]);

      const heightNorm = this._normBitcoinChainHeight(height, blockchain);
      const chainHeight = heightNorm != null ? heightNorm : 0;

      const maxRecent = 6;
      const recentBlocks = [];
      for (let h = chainHeight; h >= 0 && recentBlocks.length < maxRecent; h--) {
        try {
          const hash = await bitcoin._makeRPCRequest('getblockhash', [h]);
          const block = await bitcoin._makeRPCRequest('getblock', [hash, 1]);
          const txCount = Array.isArray(block.tx) ? block.tx.length : 0;
          let rewardSats;
          let totalOutSats;
          try {
            const stats = await bitcoin._makeRPCRequest('getblockstats', [hash]);
            if (stats && typeof stats === 'object') {
              const subsidy = Number(stats.subsidy || 0);
              const totalfee = Number(stats.totalfee || 0);
              if (Number.isFinite(subsidy) && Number.isFinite(totalfee)) {
                rewardSats = Math.round(subsidy + totalfee);
              }
              if (stats.total_out != null) {
                const out = Number(stats.total_out);
                if (Number.isFinite(out)) totalOutSats = Math.round(out);
              }
            }
          } catch (_) { /* older nodes may lack getblockstats */ }
          recentBlocks.push({
            hash: block.hash,
            height: block.height,
            time: block.time,
            txCount,
            size: block.size,
            ...(rewardSats != null ? { rewardSats } : {}),
            ...(totalOutSats != null ? { totalOutSats } : {})
          });
        } catch (e) {
          break;
        }
      }

      const mempoolVerbose = await bitcoin._makeRPCRequest('getrawmempool', [true]).catch(() => ({}));
      const mempoolTxs = Object.entries(mempoolVerbose || {})
        .sort((a, b) => Number((b[1] && b[1].time) || 0) - Number((a[1] && a[1].time) || 0))
        .slice(0, 10)
        .map(([txid, tx]) => ({
          txid,
          time: tx && tx.time ? tx.time : null,
          fee: tx && tx.fees ? (tx.fees.base || tx.fees.modified || null) : (tx && tx.fee ? tx.fee : null),
          vsize: tx && tx.vsize != null ? tx.vsize : null
        }));

      const mempoolTxCountFull = Object.keys(mempoolVerbose || {}).length;
      const MAX_MEMPOOL_FEE_SUM = 25000;
      let mempoolFeeSats = 0;
      let fi = 0;
      for (const txid of Object.keys(mempoolVerbose || {})) {
        if (fi++ >= MAX_MEMPOOL_FEE_SUM) break;
        const tx = mempoolVerbose[txid];
        if (tx && tx.fees) {
          const btc = tx.fees.modified != null ? tx.fees.modified : tx.fees.base;
          if (typeof btc === 'number' && Number.isFinite(btc)) mempoolFeeSats += Math.round(btc * SATS_PER_BTC);
        }
      }
      const mempoolFeesTruncated = mempoolTxCountFull > MAX_MEMPOOL_FEE_SUM;

      const trusted = balances && balances.mine && balances.mine.trusted != null ? balances.mine.trusted : 0;
      const beacon = this._beaconEpochState || null;
      const { pruned: bitcoinPruned, pruneHeight: bitcoinPruneHeight } = require('../functions/bitcoinPruneInventory').pruneStatusFromBlockchainInfo(blockchain);
      const summary = {
        available: true,
        status: 'ONLINE',
        network: bitcoin.network,
        ...(walletName ? { walletName: String(walletName) } : {}),
        blockchain,
        networkInfo,
        bestHash,
        height: chainHeight,
        mempoolInfo: mempoolInfo || {},
        mempoolTxCount: mempoolTxCountFull,
        mempoolFeeSats,
        mempoolFeesTruncated,
        recentBlocks,
        recentTransactions: mempoolTxs,
        balance: trusted,
        beacon: beacon || undefined,
        p2pAddNodeTargets: this._bitcoinP2pAddNodesList(),
        bitcoinPruned,
        ...(bitcoinPruneHeight != null ? { bitcoinPruneHeight } : {})
      };

      this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic(summary);
      this._bitcoinStatusCache = { value: summary, updatedAt: now };
      return summary;
    } catch (error) {
      const failed = {
        available: false,
        status: 'ERROR',
        message: error && error.message ? error.message : String(error),
        balance: 0,
        beacon: { balanceSats: 0, clock: 0 }
      };
      this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic(failed);
      this._bitcoinStatusCache = { value: failed, updatedAt: now };
      return failed;
    }
  }

  /**
   * Push sanitized Bitcoin status to browsers (wallet-safe fields only).
   */
  _broadcastBitcoinStatusToClients (status) {
    if (!status || !status.available) return;
    try {
      const patch = { op: 'add', path: '/bitcoin', value: this._sanitizeBitcoinStatusForPublic(status) };
      const msg = Message.fromVector(['JSONPatch', JSON.stringify(patch)]);
      if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
      if (this.http && typeof this.http.broadcast === 'function') {
        this.http.broadcast(msg);
      }
    } catch (err) {
      console.error('[HUB] _broadcastBitcoinStatusToClients error:', err && err.message ? err.message : err);
    }
  }

  /**
   * Gossip the local chain tip to Fabric P2P peers (signed with the agent identity key).
   * Incoming tips are relayed by Fabric `Peer` (Bitcoin block opcode). Use the `BitcoinBlock` vector label so encoders map to the correct opcode (not all cores accept `BITCOIN_BLOCK` as the constructor label).
   * @param {object} payload Same shape as `BitcoinBlock` Fabric message log (tip, height, network, at, …)
   */
  _broadcastBitcoinBlockToFabricPeers (payload = {}) {
    try {
      if (!this.agent || typeof this.agent.relayFrom !== 'function') return;
      if (!this.agent.key || !this.agent.key.private) return;
      const tip = String(payload.tip || '').trim();
      if (!tip) return;
      const p2pMsg = Message.fromVector(['BitcoinBlock', JSON.stringify(payload)]).signWithKey(this.agent.key);
      this.agent.relayFrom('_hub', p2pMsg);
    } catch (err) {
      console.error('[HUB] _broadcastBitcoinBlockToFabricPeers error:', err && err.message ? err.message : err);
    }
  }

  /**
   * Called when the Bitcoin service receives a new block (ZMQ hashblock).
   * Updates global state, Fabric chain, Activity stream, and broadcasts status to clients.
   */
  /**
   * When a BitcoinBlock arrives over Fabric P2P (e.g. peer resync replay), append to the hub Fabric
   * message log if this tip is not already recorded — keeps two hubs' Fabric views closer without
   * replacing L1 IBD (still use bitcoind addnode / RPC for chain data).
   * @param {object} payload
   * @param {string} [originName] TCP peer host:port
   */
  async _ingestP2pBitcoinBlockForFabricLog (payload = {}, originName) {
    try {
      const tip = String(payload.tip || '').trim();
      if (!tip || !/^[0-9a-fA-F]{64}$/.test(tip)) return;
      const cached = this._bitcoinStatusCache && this._bitcoinStatusCache.value;
      if (cached && String(cached.bestHash || '') === tip) return;
      const msgs = this._getFabricMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.type === 'BitcoinBlock' && m.payload && String(m.payload.tip) === tip) return;
      }
      const height = payload.height != null ? Number(payload.height) : undefined;
      await this._appendFabricMessage('BitcoinBlock', {
        tip,
        ...(Number.isFinite(height) ? { height } : {}),
        network: payload.network,
        supply: payload.supply,
        at: payload.at || new Date().toISOString(),
        source: 'p2p-gossip',
        ...(originName ? { p2pOrigin: originName } : {})
      });
    } catch (e) {
      console.warn('[HUB] _ingestP2pBitcoinBlockForFabricLog:', e && e.message ? e.message : e);
    }
  }

  async _handleBitcoinBlockUpdate (payload = {}) {
    try {
      this._bitcoinStatusCache = { value: null, updatedAt: 0 };
      const status = await this._collectBitcoinStatus({ force: true });
      if (!status || !status.available) return;

      const tip = String(payload.tip || status.bestHash || '').trim();
      const height = payload.height != null ? Number(payload.height) : Number(status.height);

      const blockPayload = {
        tip: tip || status.bestHash,
        height: Number.isFinite(height) ? height : status.height,
        supply: payload.supply,
        network: status.network,
        at: new Date().toISOString()
      };

      await this._appendFabricMessage('BitcoinBlock', blockPayload);

      if (this.beacon && this.beacon.state && this.beacon.state.status === 'RUNNING') {
        try {
          await this.beacon.recordEpochFromBlock({
            tip: blockPayload.tip,
            height: blockPayload.height,
            supply: payload.supply
          });
        } catch (beaconErr) {
          console.warn('[HUB:BEACON] recordEpochFromBlock:', beaconErr && beaconErr.message ? beaconErr.message : beaconErr);
        }
      }

      let txCount;
      const rb = Array.isArray(status.recentBlocks) ? status.recentBlocks[0] : null;
      if (rb && (!tip || rb.hash === tip)) txCount = rb.txCount;
      else if (rb) txCount = rb.txCount;

      if (tip && this._lastBitcoinBlockActivityTip !== tip) {
        this._lastBitcoinBlockActivityTip = tip;
        this._broadcastBitcoinBlockToFabricPeers(blockPayload);
        this.recordActivity({
          type: 'Announce',
          object: {
            type: 'BitcoinBlock',
            id: tip,
            name: Number.isFinite(height) ? `Block ${height}` : 'New block',
            height: Number.isFinite(height) ? height : undefined,
            hash: tip,
            txCount,
            supply: payload.supply,
            network: status.network
          }
        });
      }

      this._broadcastBitcoinStatusToClients(status);

      const docBlocksCfg = this.settings.bitcoin && this.settings.bitcoin.documentBlocks;
      const documentBlocksEnabled = !(docBlocksCfg === false || docBlocksCfg === 'false' || docBlocksCfg === 0 || docBlocksCfg === '0');
      if (documentBlocksEnabled && tip) {
        try {
          const bitcoinSvc = this._getBitcoinService();
          if (bitcoinSvc && typeof bitcoinSvc._makeRPCRequest === 'function') {
            const fullBlock = await bitcoinSvc._makeRPCRequest('getblock', [tip, 2]);
            if (fullBlock) {
              await this._ensureBitcoinBlockPublishedDocument(fullBlock, status.network);
              const docTxCfg = this.settings.bitcoin && this.settings.bitcoin.documentTransactions;
              const documentTxEnabled = docTxCfg === true || docTxCfg === 'true' || docTxCfg === 1 || docTxCfg === '1';
              if (documentTxEnabled) {
                await this._ensureBitcoinTransactionPublishedDocuments(fullBlock, status.network);
              }
            }
          }
        } catch (docErr) {
          console.warn('[HUB:BITCOIN] block document index:', docErr && docErr.message ? docErr.message : docErr);
        }
      }

      try {
        await this._syncPrunedBitcoinIndexDocuments(status);
      } catch (pruneErr) {
        console.warn('[HUB:BITCOIN] prune inventory sync:', pruneErr && pruneErr.message ? pruneErr.message : pruneErr);
      }

      await this._maybeScanSidechainBlock(tip, Number.isFinite(height) ? height : null);
      await this._maybeScanFederationRegistryBlock(tip, Number.isFinite(height) ? height : null);
    } catch (err) {
      console.error('[HUB] _handleBitcoinBlockUpdate error:', err && err.message ? err.message : err);
    }
  }

  /**
   * Persist a compact Bitcoin block summary as a Fabric Document and publish it to the hub catalog
   * (`collections.documents` + `PublishDocument` message). Idempotent per block (stable JSON → sha256 id).
   * @param {object} block — Bitcoin Core `getblock` verbosity 2 JSON
   * @param {string|null} networkName
   */
  async _ensureBitcoinBlockPublishedDocument (block, networkName) {
    const {
      bitcoinBlockDocumentBuffer,
      bitcoinBlockDocumentId,
      buildBitcoinBlockSummary
    } = require('../functions/bitcoinBlockDocument');
    if (!block || typeof block !== 'object' || !block.hash) return;
    const buffer = bitcoinBlockDocumentBuffer(block, networkName);
    const sizeErr = this._validateDocumentSize(buffer);
    if (sizeErr) {
      console.warn('[HUB:BITCOIN] block document:', sizeErr.message);
      return;
    }
    const id = bitcoinBlockDocumentId(block, networkName);
    const summary = buildBitcoinBlockSummary(block, networkName);
    const now = new Date().toISOString();
    const h = String(block.hash);
    const name = `Bitcoin block ${summary.height != null && Number.isFinite(Number(summary.height)) ? summary.height : '?'} (${h.slice(0, 10)}…)`;
    const mime = FABRIC_BITCOIN_BLOCK_DOC_MIME;
    const blockPriceSats = this._resolveBitcoinDocumentInventoryPriceSats('block');
    const heightNorm = summary.height != null && Number.isFinite(Number(summary.height)) ? Number(summary.height) : null;

    this._ensureResourceCollections();
    this._state.documents = this._state.documents || {};
    this._state.content.collections = this._state.content.collections || {};
    this._state.content.collections.documents = this._state.content.collections.documents || {};
    this._state.content.counts = this._state.content.counts || {};

    const coll = this._state.content.collections.documents;
    if (coll[id] && coll[id].published) return;

    const existingRaw = this.fs.readFile(`documents/${id}.json`);
    let parsed;

    if (!existingRaw) {
      // Persist only envelope-whitelisted document fields + content; prune/listing metadata lives on `collections.documents` only.
      const meta = {
        id,
        sha256: id,
        name,
        mime,
        size: buffer.length,
        created: now,
        lineage: id,
        parent: null,
        revision: 1,
        edited: now
      };
      try {
        await this.fs.publish(`documents/${id}.json`, {
          ...meta,
          contentBase64: buffer.toString('base64')
        });
      } catch (e) {
        console.error('[HUB:BITCOIN] block document persist failed:', e && e.message ? e.message : e);
        return;
      }
      this._state.documents[id] = { ...meta };
      this._refreshChainState('bitcoin-block-document');
      // Single activity: `Add` to the documents collection below (avoids paired Create+Add rows).
      parsed = meta;
    } else {
      try {
        parsed = JSON.parse(existingRaw);
      } catch (e) {
        console.error('[HUB:BITCOIN] block document corrupt:', id, e && e.message ? e.message : e);
        return;
      }
      if (!this._state.documents[id]) {
        this._state.documents[id] = {
          id: parsed.id || id,
          sha256: parsed.sha256 || id,
          name: parsed.name || name,
          mime: parsed.mime || mime,
          size: parsed.size != null ? parsed.size : buffer.length,
          created: parsed.created || now,
          lineage: parsed.lineage || id,
          parent: parsed.parent || null,
          revision: parsed.revision || 1,
          edited: parsed.edited || now
        };
      }
    }

    if (coll[id] && coll[id].published) return;

    const pubNow = new Date().toISOString();
    const exists = !!coll[id];
    coll[id] = {
      id,
      document: id,
      name: parsed.name || name,
      mime: parsed.mime || mime,
      size: parsed.size != null ? parsed.size : buffer.length,
      sha256: parsed.sha256 || id,
      created: parsed.created || pubNow,
      lineage: parsed.lineage || id,
      parent: parsed.parent != null ? parsed.parent : null,
      revision: parsed.revision || 1,
      edited: parsed.edited || parsed.created || pubNow,
      published: pubNow,
      bitcoinBlockHash: h,
      ...(heightNorm != null ? { bitcoinHeight: heightNorm } : {}),
      ...(blockPriceSats != null ? { purchasePriceSats: blockPriceSats } : {})
    };
    if (!exists) {
      this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
    }

    try {
      await this._appendFabricMessage('PublishDocument', {
        id,
        name: coll[id].name,
        mime: coll[id].mime
      });
    } catch (e) {
      console.error('[HUB:BITCOIN] PublishDocument message failed:', e && e.message ? e.message : e);
    }
    this._refreshChainState('publish-bitcoin-block-document');
    this.commit();
    if (typeof this._pushNetworkStatus === 'function') {
      try {
        this._pushNetworkStatus();
      } catch (_) { /* optional */ }
    }
    try {
      this.recordActivity({
        type: 'Add',
        object: {
          type: 'Document',
          id,
          name: coll[id].name,
          mime: coll[id].mime,
          size: coll[id].size,
          sha256: coll[id].sha256,
          published: pubNow,
          bitcoinBlock: true
        },
        target: { type: 'Collection', name: 'documents' }
      });
    } catch (_) { /* optional */ }
  }

  /**
   * Publish verbose transactions from a `getblock` … 2 result as Fabric documents (optional; see `documentTransactions`).
   * @param {object} block
   * @param {string|null} networkName
   */
  async _ensureBitcoinTransactionPublishedDocuments (block, networkName) {
    const {
      bitcoinTransactionDocumentBuffer,
      bitcoinTransactionDocumentId
    } = require('../functions/bitcoinTransactionDocument');
    if (!block || typeof block !== 'object' || !block.hash) return;
    const txs = Array.isArray(block.tx) ? block.tx : [];
    if (txs.length === 0) return;
    if (txs.length > BITCOIN_TX_DOC_INDEX_MAX_TXS) {
      if (this.settings.debug) {
        console.debug('[HUB:BITCOIN] skip tx document index: too many txs in block', txs.length);
      }
      return;
    }
    const bh = String(block.hash);
    const bheight = block.height != null && Number.isFinite(Number(block.height)) ? Number(block.height) : null;
    const txPriceSats = this._resolveBitcoinDocumentInventoryPriceSats('transaction');

    for (const tx of txs) {
      if (!tx || typeof tx !== 'object') continue;
      const buffer = bitcoinTransactionDocumentBuffer(tx, bh, bheight, networkName);
      if (!buffer) {
        if (this.settings.debug) {
          const tid = tx.txid != null ? String(tx.txid).slice(0, 16) : '';
          console.debug('[HUB:BITCOIN] tx document skip (no canonical hex):', tid);
        }
        continue;
      }
      const sizeErr = this._validateDocumentSize(buffer);
      if (sizeErr) {
        console.warn('[HUB:BITCOIN] tx document:', sizeErr.message);
        continue;
      }
      const id = bitcoinTransactionDocumentId(tx, bh, bheight, networkName);
      if (!id) continue;
      const txid = tx.txid != null ? String(tx.txid) : '';
      const shortTx = txid ? txid.slice(0, 10) : '?';
      const name = `Bitcoin tx ${shortTx}… (block ${bheight != null ? bheight : '?'})`;
      const mime = FABRIC_BITCOIN_TX_DOC_MIME;
      const now = new Date().toISOString();

      this._ensureResourceCollections();
      this._state.documents = this._state.documents || {};
      this._state.content.collections.documents = this._state.content.collections.documents || {};
      const coll = this._state.content.collections.documents;

      if (coll[id] && coll[id].published) continue;

      const existingRaw = this.fs.readFile(`documents/${id}.json`);
      let parsed;
      if (!existingRaw) {
        const meta = {
          id,
          sha256: id,
          name,
          mime,
          size: buffer.length,
          created: now,
          lineage: id,
          parent: null,
          revision: 1,
          edited: now
        };
        try {
          await this.fs.publish(`documents/${id}.json`, {
            ...meta,
            contentBase64: buffer.toString('base64')
          });
        } catch (e) {
          console.error('[HUB:BITCOIN] tx document persist failed:', e && e.message ? e.message : e);
          continue;
        }
        this._state.documents[id] = { ...meta };
        this._refreshChainState('bitcoin-tx-document');
        parsed = meta;
      } else {
        try {
          parsed = JSON.parse(existingRaw);
        } catch (e) {
          console.error('[HUB:BITCOIN] tx document corrupt:', id, e && e.message ? e.message : e);
          continue;
        }
        if (!this._state.documents[id]) {
          this._state.documents[id] = {
            id: parsed.id || id,
            sha256: parsed.sha256 || id,
            name: parsed.name || name,
            mime: parsed.mime || mime,
            size: parsed.size != null ? parsed.size : buffer.length,
            created: parsed.created || now,
            lineage: parsed.lineage || id,
            parent: parsed.parent || null,
            revision: parsed.revision || 1,
            edited: parsed.edited || now
          };
        }
      }

      if (coll[id] && coll[id].published) continue;

      const pubNow = new Date().toISOString();
      const exists = !!coll[id];
      coll[id] = {
        id,
        document: id,
        name: parsed.name || name,
        mime: parsed.mime || mime,
        size: parsed.size != null ? parsed.size : buffer.length,
        sha256: parsed.sha256 || id,
        created: parsed.created || pubNow,
        lineage: parsed.lineage || id,
        parent: parsed.parent != null ? parsed.parent : null,
        revision: parsed.revision || 1,
        edited: parsed.edited || parsed.created || pubNow,
        published: pubNow,
        bitcoinBlockHash: bh,
        ...(bheight != null ? { bitcoinHeight: bheight } : {}),
        ...(txid ? { bitcoinTxid: txid } : {}),
        ...(txPriceSats != null ? { purchasePriceSats: txPriceSats } : {})
      };
      if (!exists) {
        this._state.content.counts = this._state.content.counts || {};
        this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
      }

      try {
        await this._appendFabricMessage('PublishDocument', {
          id,
          name: coll[id].name,
          mime: coll[id].mime
        });
      } catch (e) {
        console.error('[HUB:BITCOIN] tx PublishDocument message failed:', e && e.message ? e.message : e);
      }
      this._refreshChainState('publish-bitcoin-tx-document');
      this.commit();
    }
  }

  /**
   * Optional playnet / sidechain indexing: scan new block for OP_RETURN markers and watched addresses.
   * Enable with `settings.bitcoin.sidechainScan.enable` (off by default for production).
   */
  async _maybeScanSidechainBlock (blockHash, height) {
    const cfg = this.settings.bitcoin && this.settings.bitcoin.sidechainScan;
    if (!cfg || !cfg.enable || !blockHash) return;
    const bitcoin = this._getBitcoinService();
    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') return;
    try {
      const { scanBlockForSidechainSignals } = require('../functions/sidechainBlockScan');
      const summary = await scanBlockForSidechainSignals(bitcoin, blockHash, height != null ? height : -1, cfg);
      if (!summary || !Array.isArray(summary.signals) || summary.signals.length === 0) return;
      if (this.settings.debug) {
        console.log('[HUB:SIDECHAIN]', `block ${summary.height}`, summary.signals.length, 'signal(s)');
      }
      try {
        this.recordActivity({
          type: 'SidechainScan',
          object: {
            blockHash: summary.blockHash,
            height: summary.height,
            count: summary.signals.length
          }
        });
      } catch (_) { /* recordActivity optional */ }
    } catch (e) {
      console.warn('[HUB:SIDECHAIN] scan failed:', e && e.message ? e.message : e);
    }
  }

  /**
   * Wallet / mempool refresh on transaction-related ZMQ (no new chain tip).
   */
  async _handleBitcoinTransactionUpdate (_payload = {}) {
    try {
      this._bitcoinStatusCache = { value: null, updatedAt: 0 };
      const status = await this._collectBitcoinStatus({ force: true });
      if (!status || !status.available) return;
      this._broadcastBitcoinStatusToClients(status);
    } catch (err) {
      console.error('[HUB] _handleBitcoinTransactionUpdate error:', err && err.message ? err.message : err);
    }
  }

  _handleBitcoinStatusRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const status = await this._collectBitcoinStatus({ force: true });
      // Always 200 so the client receives balance/beacon/message even when unavailable
      const body = status && typeof status === 'object'
        ? { ...status, balance: status.balance != null ? status.balance : 0, beacon: status.beacon || { balanceSats: 0, clock: 0 } }
        : { available: false, status: 'UNAVAILABLE', balance: 0, beacon: { balanceSats: 0, clock: 0 }, message: 'Bitcoin status unknown.' };
      return res.status(200).json(body);
    });
  }

  _handleHubUiConfigRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const { normalizeHubUiAlerts } = require('../functions/hubUiAlerts');
      const raw = this.settings.ui && Array.isArray(this.settings.ui.alerts)
        ? this.settings.ui.alerts
        : [];
      const alerts = normalizeHubUiAlerts(raw);
      return res.status(200).json({ success: true, alerts });
    });
  }

  _handleSettingsListRequest (req, res) {
    // Same Accept negotiation as `GET /settings/:name`: HTML shell for `Accept: text/html` (SPA
    // refresh on `/settings`); JSON for `Accept: application/json`. The app must not rely on
    // default `*/*` for the setup probe—`HubInterface` and tests use `Accept: application/json`.
    return this.http.jsonOrShell(req, res, async () => {
      const settings = this.setup.listSettings();
      const setupStatus = this.setup.getSetupStatus();
      return res.status(200).json({ success: true, settings, ...setupStatus });
    });
  }

  _handleSettingsBootstrapRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const status = this.setup.getSetupStatus();
      if (status.configured) {
        return res.status(403).json({ error: 'Already configured', message: 'Hub is already configured.' });
      }
      const body = req.body || {};
      const initialConfig = {
        NODE_NAME: body.NODE_NAME || body.nodeName || 'Hub',
        NODE_PERSONALITY: body.NODE_PERSONALITY || body.nodePersonality || JSON.stringify(['helpful']),
        NODE_TEMPERATURE: body.NODE_TEMPERATURE ?? body.nodeTemperature ?? 0,
        NODE_GOALS: body.NODE_GOALS || body.nodeGoals || JSON.stringify([]),
        BITCOIN_NETWORK: body.BITCOIN_NETWORK || body.bitcoinNetwork || 'regtest',
        BITCOIN_MANAGED: body.BITCOIN_MANAGED !== false && body.bitcoinManaged !== false,
        ...(body.BITCOIN_MANAGED === false || body.bitcoinManaged === false ? {
          BITCOIN_HOST: body.BITCOIN_HOST || body.bitcoinHost || '127.0.0.1',
          BITCOIN_RPC_PORT: body.BITCOIN_RPC_PORT || body.bitcoinRpcPort || '8332',
          BITCOIN_USERNAME: body.BITCOIN_USERNAME || body.bitcoinUsername || '',
          BITCOIN_PASSWORD: body.BITCOIN_PASSWORD || body.bitcoinPassword || ''
        } : {}),
        LIGHTNING_MANAGED: body.LIGHTNING_MANAGED !== false && body.lightningManaged !== false,
        ...(body.LIGHTNING_MANAGED === false || body.lightningManaged === false ? {
          LIGHTNING_SOCKET: body.LIGHTNING_SOCKET || body.lightningSocket || ''
        } : {}),
        DISK_ALLOCATION_MB: body.DISK_ALLOCATION_MB ?? body.diskAllocationMb ?? 1024,
        COST_PER_BYTE_SATS: body.COST_PER_BYTE_SATS ?? body.costPerByteSats ?? 0.01
      };
      const result = await this.setup.createAdminToken(initialConfig);
      return res.status(200).json(result);
    });
  }

  _handleSettingsGetRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const name = req.params && req.params.name;
      if (!name) return res.status(400).json({ error: 'Setting name is required' });
      const value = this.setup.getSetting(name);
      if (value === undefined) return res.status(404).json({ error: 'Setting not found', setting: name });
      return res.status(200).json({ success: true, setting: name, value });
    });
  }

  _handleSettingsPutRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const token = SetupService.extractBearerToken(req);
      if (!this.setup.verifyAdminToken(token)) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Admin token required' });
      }
      const name = req.params && req.params.name;
      if (!name) return res.status(400).json({ error: 'Setting name is required' });
      const body = req.body || {};
      const value = body.value !== undefined ? body.value : body;
      if (value === undefined || value === null) return res.status(400).json({ error: 'Setting value is required' });
      await this.setup.setSetting(name, value);

      const settingName = String(name).trim();
      if (settingName === 'HTTP_SHARED_MODE') {
        const envIf = process.env.FABRIC_HUB_INTERFACE || process.env.INTERFACE;
        if (envIf && String(envIf).trim()) {
          return res.status(200).json({
            success: true,
            setting: name,
            value,
            httpRebind: 'skipped',
            httpRebindReason: 'FABRIC_HUB_INTERFACE or INTERFACE is set; restart the hub to change bind address.'
          });
        }
        res.status(200).json({
          success: true,
          setting: name,
          value,
          httpRebind: 'scheduled',
          message: 'HTTP listener will rebind shortly; WebSocket clients will disconnect and reconnect.'
        });
        if (!this._httpRebindLock) this._httpRebindLock = Promise.resolve();
        this._httpRebindLock = this._httpRebindLock
          .then(() => this._rebindHttpForSharedModeIfChanged())
          .catch((err) => {
            console.error('[HUB] HTTP_SHARED_MODE rebind failed:', err && err.message ? err.message : err);
          });
        return;
      }

      return res.status(200).json({ success: true, setting: name, value });
    });
  }

  /**
   * Apply HTTP bind interface from persisted HTTP_SHARED_MODE (127.0.0.1 vs 0.0.0.0).
   * No-op when FABRIC_HUB_INTERFACE / INTERFACE env overrides (handled at process start).
   */
  async _rebindHttpForSharedModeIfChanged () {
    const envIf = process.env.FABRIC_HUB_INTERFACE || process.env.INTERFACE;
    if (envIf && String(envIf).trim()) return;

    const raw = this.setup.getSetting('HTTP_SHARED_MODE');
    const shared = isHttpSharedModeEnabled(raw);
    const nextIf = shared ? '0.0.0.0' : '127.0.0.1';

    const cur = String(
      this.http.settings.interface != null && this.http.settings.interface !== ''
        ? this.http.settings.interface
        : (this.http.settings.host || '0.0.0.0')
    );
    if (cur === nextIf) {
      if (this.settings && this.settings.http) this.settings.http.interface = nextIf;
      return;
    }

    this.http.settings.interface = nextIf;
    this.http.interface = nextIf;
    if (this.settings && this.settings.http) {
      this.settings.http.interface = nextIf;
    }

    const { rebindFabricHttpListen } = require('../functions/fabricHttpRebind');
    console.log('[FABRIC:HUB] Rebinding HTTP from %s to %s (port %s)', cur, nextIf, this.http.settings.port);
    await rebindFabricHttpListen(this.http);
    console.log('[FABRIC:HUB] HTTP listener active on %s:%s', nextIf, this.http.settings.port);
  }

  _handleSettingsRefreshRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const token = SetupService.extractBearerToken(req) || (req.body && req.body.token);
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Current token required for refresh.' });
      }
      try {
        const result = await this.setup.refreshAdminToken(token);
        return res.status(200).json(result);
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized', message: err && err.message ? err.message : 'Invalid or expired token.' });
      }
    });
  }

  _handleBitcoinBlocksListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const status = await this._collectBitcoinStatus({ force: true });
      if (!status || !status.available) {
        return res.status(503).json(status || { status: 'error', message: 'Bitcoin service unavailable' });
      }
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
      const blocks = (status.recentBlocks || []).slice(0, limit);
      return res.json(blocks);
    });
  }

  _handleBitcoinGenerateBlockRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({ status: 'error', message: 'Admin token required for block generation.' });
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
    if (bitcoin.network !== 'regtest') {
      return res.status(400).json({ status: 'error', message: 'Block generation is only available on regtest.' });
    }

    const body = req.body || {};
    return Promise.resolve()
      .then(async () => {
        const count = Math.max(1, Math.min(10, Number(body.count || 1)));
        // Always use Hub's wallet for block generation so coinbase goes to the Hub.
        const address = await bitcoin.getUnusedAddress();
        const hashes = [];

        for (let i = 0; i < count; i++) {
          const generated = await bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
          if (Array.isArray(generated)) hashes.push(...generated);
          else if (generated) hashes.push(generated);
        }

        await this._collectBitcoinStatus({ force: true });
        return res.json({
          status: 'success',
          network: bitcoin.network,
          address,
          count,
          blockHashes: hashes
        });
      })
      .catch((error) => {
        return res.status(500).json({
          status: 'error',
          message: error && error.message ? error.message : String(error)
        });
      });
  }

  _handleBitcoinPeersListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) {
        return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      }
      const peers = await bitcoin._makeRPCRequest('getpeerinfo', []).catch(() => []);
      return res.json(Array.isArray(peers) ? peers : []);
    });
  }

  _handleBitcoinNetworkInfoRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) {
        return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      }
      const [networkInfo, blockchain, deployments] = await Promise.all([
        bitcoin._makeRPCRequest('getnetworkinfo', []).catch(() => null),
        bitcoin._makeRPCRequest('getblockchaininfo', []).catch(() => null),
        bitcoin._makeRPCRequest('getdeploymentinfo', []).catch(() => null)
      ]);
      return res.json({ networkInfo, blockchain, deployments });
    });
  }

  _handleBitcoinBroadcastRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({ status: 'error', message: 'Admin token required to broadcast raw transactions.' });
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const hex = String(body.hex || body.txhex || body.transaction || '').replace(/\s+/g, '');
    if (!hex) return res.status(400).json({ status: 'error', message: 'hex (raw transaction) is required.' });
    return Promise.resolve()
      .then(async () => {
        const txid = await bitcoin._makeRPCRequest('sendrawtransaction', [hex]);
        await this._collectBitcoinStatus({ force: true });
        return res.json({ status: 'success', txid });
      })
      .catch((error) => {
        return res.status(400).json({
          status: 'error',
          message: error && error.message ? error.message : String(error)
        });
      });
  }

  _loadCrowdfundingCampaignsIfNeeded () {
    if (this._crowdfundingLoaded) return;
    this._crowdfundingLoaded = true;
    try {
      if (!this.fs || typeof this.fs.readFile !== 'function') return;
      const raw = this.fs.readFile('bitcoin/crowdfunding.json');
      if (!raw) return;
      const j = JSON.parse(raw);
      const c = j && j.campaigns && typeof j.campaigns === 'object' ? j.campaigns : {};
      for (const [k, v] of Object.entries(c)) {
        if (v && typeof v === 'object') this._crowdfundingCampaigns.set(k, v);
      }
    } catch (_) {
      /* missing or invalid file */
    }
  }

  _persistCrowdfundingCampaigns () {
    try {
      if (!this.fs || typeof this.fs.publish !== 'function') return;
      const campaigns = Object.fromEntries(this._crowdfundingCampaigns);
      this.fs.publish('bitcoin/crowdfunding.json', { campaigns, updatedAt: Date.now() });
    } catch (e) {
      console.warn('[HUB] bitcoin/crowdfunding.json persist failed:', e && e.message ? e.message : e);
    }
  }

  _hubIdentityPriv32 () {
    const key = this.agent && this.agent.key;
    const priv = key && key.keypair && typeof key.keypair.getPrivate === 'function'
      ? key.keypair.getPrivate('bytes')
      : null;
    if (!priv || !Buffer.isBuffer(priv) || priv.length !== 32) return null;
    return priv;
  }

  _publicCrowdfundingView (c) {
    if (!c || typeof c !== 'object') return null;
    return {
      campaignId: c.campaignId,
      title: c.title || '',
      address: c.address,
      networkName: c.networkName,
      goalSats: c.goalSats,
      minContributionSats: c.minContributionSats,
      refundLocktimeHeight: c.refundLocktimeHeight,
      beneficiaryPubkeyHex: c.beneficiaryPubkeyHex,
      arbiterPubkeyHex: c.arbiterPubkeyHex,
      payoutScriptHex: c.payoutScriptHex,
      refundScriptHex: c.refundScriptHex,
      outputScriptHex: c.outputScriptHex,
      createdAt: c.createdAt,
      scheme: 'taproot-crowdfund-v1',
      notes: 'Payout requires beneficiary + Hub arbiter Schnorr signatures (2-of-2). Goal/min are committed in the payout tapleaf; aggregate ≥ goal is enforced before unsigned PSBT is returned. Each UTXO must be ≥ minContributionSats. Bitcoin cannot sum separate UTXOs inside Script; refund path is arbiter-only after CLTV.'
    };
  }

  async _crowdfundingScanInputs (bitcoin, campaign) {
    const scanObj = `addr(${campaign.address})`;
    const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
    const unspents = (result && Array.isArray(result.unspents)) ? result.unspents : [];
    const inputs = [];
    let totalSats = 0;
    for (const u of unspents) {
      const sats = Math.round(Number(u.amount || 0) * 100000000);
      if (!Number.isFinite(sats) || sats <= 0) continue;
      if (sats < Number(campaign.minContributionSats || 0)) {
        const err = new Error(
          `UTXO ${u.txid}:${u.vout} pays ${sats} sats; minContributionSats is ${campaign.minContributionSats}.`
        );
        err.code = 'MIN_CONTRIBUTION';
        throw err;
      }
      totalSats += sats;
      const rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [u.txid, false]);
      inputs.push({ txHex: rawHex, vout: u.vout });
    }
    return { inputs, totalSats, unspents };
  }

  _handleBitcoinCrowdfundingListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      this._loadCrowdfundingCampaignsIfNeeded();
      const rows = Array.from(this._crowdfundingCampaigns.values())
        .map((c) => this._publicCrowdfundingView(c))
        .filter(Boolean);
      return res.json({ campaigns: rows, count: rows.length });
    });
  }

  _handleBitcoinCrowdfundingCreateRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({ status: 'error', message: 'Admin token required to create crowdfunding campaigns.' });
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const beneficiaryHex = String(body.beneficiaryPubkeyHex || body.beneficiaryPubkey || '').trim().toLowerCase();
    const title = String(body.title || 'Crowdfund').trim().slice(0, 200);
    const goalSats = Math.round(Number(body.goalSats || 0));
    const minContributionSats = Math.round(Number(body.minContributionSats || body.minSats || 0));
    let refundAfterBlocks = Math.round(Number(body.refundAfterBlocks || 1008));
    if (!Number.isFinite(refundAfterBlocks) || refundAfterBlocks < 48) refundAfterBlocks = 1008;
    if (!Number.isFinite(goalSats) || goalSats < 1000) {
      return res.status(400).json({ status: 'error', message: 'goalSats must be at least 1000.' });
    }
    if (!Number.isFinite(minContributionSats) || minContributionSats < 546) {
      return res.status(400).json({ status: 'error', message: 'minContributionSats must be at least 546 (dust).' });
    }
    if (minContributionSats > goalSats) {
      return res.status(400).json({ status: 'error', message: 'minContributionSats cannot exceed goalSats.' });
    }
    const arbBuf = this._sellerHtlcPubkeyCompressed();
    if (!arbBuf) {
      return res.status(503).json({ status: 'error', message: 'Hub identity pubkey unavailable for arbiter role.' });
    }
    let benBuf;
    try {
      benBuf = crowdfundingTaproot.parseCompressedPubkey33(beneficiaryHex);
    } catch (e) {
      return res.status(400).json({ status: 'error', message: e && e.message ? e.message : 'Invalid beneficiary pubkey.' });
    }
    return Promise.resolve()
      .then(async () => {
        const height = await bitcoin._makeRPCRequest('getblockcount', []);
        const refundLocktimeHeight = height + refundAfterBlocks;
        const built = crowdfundingTaproot.buildCrowdfundP2tr({
          networkName: bitcoin.network || 'regtest',
          beneficiaryPubkeyCompressed: benBuf,
          arbiterPubkeyCompressed: arbBuf,
          goalSats,
          minContributionSats,
          refundLocktimeHeight
        });
        const campaignId = crypto.randomBytes(12).toString('hex');
        const campaign = {
          campaignId,
          title,
          address: built.address,
          networkName: bitcoin.network || 'regtest',
          goalSats: built.goalSats,
          minContributionSats: built.minContributionSats,
          refundLocktimeHeight: built.refundLocktimeHeight,
          beneficiaryPubkeyHex: benBuf.toString('hex'),
          arbiterPubkeyHex: arbBuf.toString('hex'),
          payoutScriptHex: built.payoutScript.toString('hex'),
          refundScriptHex: built.refundScript.toString('hex'),
          outputScriptHex: built.output.toString('hex'),
          createdAt: Date.now()
        };
        this._loadCrowdfundingCampaignsIfNeeded();
        this._crowdfundingCampaigns.set(campaignId, campaign);
        this._persistCrowdfundingCampaigns();
        return res.json({ status: 'success', campaign: this._publicCrowdfundingView(campaign) });
      })
      .catch((err) => res.status(400).json({
        status: 'error',
        message: err && err.message ? err.message : String(err)
      }));
  }

  /**
   * GET .../campaigns/:id/acp-donation-psbt?amountSats=
   * Outputs-only PSBT: one output to the campaign vault; donors add inputs with SIGHASH_ALL|ANYONECANPAY.
   */
  _handleBitcoinCrowdfundingAcpDonationPsbtRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      this._loadCrowdfundingCampaignsIfNeeded();
      const id = String((req.params && req.params.campaignId) || '').trim();
      const c = this._crowdfundingCampaigns.get(id);
      if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
      const amountSats = Math.round(Number((req.query && req.query.amountSats) || 0));
      const minC = Math.round(Number(c.minContributionSats || 546));
      if (!Number.isFinite(amountSats) || amountSats < minC) {
        return res.status(400).json({
          status: 'error',
          message: `amountSats must be >= campaign minContributionSats (${minC}).`
        });
      }
      const crowdfundingAcp = require('../functions/crowdfundingAcpTemplate');
      let built;
      try {
        built = crowdfundingAcp.buildAcpCrowdfundDonationPsbt({
          networkName: c.networkName || 'regtest',
          campaignAddress: c.address,
          donationOutputSats: amountSats
        });
      } catch (e) {
        return res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) });
      }
      return res.json({
        status: 'success',
        campaignId: id,
        psbtBase64: built.psbtBase64,
        donationOutputSats: built.donationOutputSats,
        campaignAddress: built.campaignAddress,
        note: 'Add donor inputs and sign each with SIGHASH_ALL|ANYONECANPAY (0x81); merge PSBTs until fee is covered, then finalize and broadcast.'
      });
    });
  }

  _handleBitcoinCrowdfundingGetRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      this._loadCrowdfundingCampaignsIfNeeded();
      const id = String((req.params && req.params.campaignId) || '').trim();
      const c = this._crowdfundingCampaigns.get(id);
      if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
      const bitcoin = this._getBitcoinService();
      let balanceSats = 0;
      let unspentCount = 0;
      let vaultUtxos = [];
      if (bitcoin) {
        try {
          const scanObj = `addr(${c.address})`;
          const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
          const unspents = (result && Array.isArray(result.unspents)) ? result.unspents : [];
          unspentCount = unspents.length;
          for (const u of unspents) {
            const amt = Math.round(Number(u.amount || 0) * 100000000);
            balanceSats += Number.isFinite(amt) ? amt : 0;
            if (u && u.txid) {
              vaultUtxos.push({
                txid: String(u.txid),
                vout: u.vout != null ? Number(u.vout) : 0,
                amountSats: Number.isFinite(amt) ? amt : 0
              });
            }
          }
        } catch (_) { /* optional */ }
      }
      const view = this._publicCrowdfundingView(c);
      return res.json({
        ...view,
        balanceSats,
        unspentCount,
        vaultUtxos,
        goalMet: balanceSats >= Number(c.goalSats || 0)
      });
    });
  }

  _handleBitcoinCrowdfundingPayoutPsbtRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      this._loadCrowdfundingCampaignsIfNeeded();
      const id = String((req.params && req.params.campaignId) || '').trim();
      const c = this._crowdfundingCampaigns.get(id);
      if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
      const dest = String((req.query && req.query.destination) || (req.query && req.query.to) || '').trim();
      const feeSats = Math.max(1, Math.round(Number((req.query && req.query.feeSats) || 1000)));
      if (!dest) return res.status(400).json({ status: 'error', message: 'Query destination (or to) — bech32 payout address — is required.' });
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      let scan;
      try {
        scan = await this._crowdfundingScanInputs(bitcoin, c);
      } catch (e) {
        const status = e && e.code === 'MIN_CONTRIBUTION' ? 400 : 500;
        return res.status(status).json({ status: 'error', message: e && e.message ? e.message : String(e) });
      }
      if (scan.totalSats < c.goalSats) {
        return res.status(400).json({
          status: 'error',
          message: `Raised ${scan.totalSats} sats; goal is ${c.goalSats} sats.`,
          balanceSats: scan.totalSats,
          goalSats: c.goalSats
        });
      }
      if (scan.inputs.length === 0) {
        return res.status(400).json({ status: 'error', message: 'No UTXOs at campaign address.' });
      }
      let prep;
      try {
        prep = crowdfundingTaproot.prepareCrowdfundPayoutPsbt({
          networkName: c.networkName || bitcoin.network || 'regtest',
          inputs: scan.inputs,
          paymentAddress: c.address,
          payoutScript: Buffer.from(c.payoutScriptHex, 'hex'),
          refundScript: Buffer.from(c.refundScriptHex, 'hex'),
          destinationAddress: dest,
          feeSats,
          goalSats: c.goalSats
        });
      } catch (e) {
        return res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) });
      }
      return res.json({
        status: 'success',
        campaignId: c.campaignId,
        psbtBase64: prep.psbtBase64,
        totalInputSats: prep.totalInputSats,
        destSats: prep.destSats,
        feeSats: prep.feeSats,
        inputCount: prep.inputCount,
        next: 'Beneficiary signs the PSBT, then POST .../payout-sign-arbiter with adminToken, or merge signatures offline and POST .../payout-broadcast.'
      });
    });
  }

  /**
   * POST body: `{ psbtBase64 }` — PSBT after beneficiary signed all inputs (tapscript path).
   * Hub adds arbiter Schnorr sigs via `crowdfundingTaproot.signAllInputsWithKey` (same order as finalize).
   */
  _handleBitcoinCrowdfundingPayoutSignArbiterRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({ status: 'error', message: 'Admin token required.' });
    }
    this._loadCrowdfundingCampaignsIfNeeded();
    const id = String((req.params && req.params.campaignId) || '').trim();
    const c = this._crowdfundingCampaigns.get(id);
    if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const psbtB64 = String(body.psbtBase64 || body.psbt || '').trim();
    if (!psbtB64) return res.status(400).json({ status: 'error', message: 'psbtBase64 is required.' });
    const priv = this._hubIdentityPriv32();
    if (!priv) return res.status(503).json({ status: 'error', message: 'Hub cannot sign (no identity private key).' });
    const arb = this._sellerHtlcPubkeyCompressed();
    if (!arb || arb.toString('hex') !== c.arbiterPubkeyHex) {
      return res.status(503).json({ status: 'error', message: 'Hub key does not match campaign arbiter.' });
    }
    try {
      const bitcoin = require('bitcoinjs-lib');
      const { Psbt } = bitcoin;
      const psbt = Psbt.fromBase64(psbtB64, { network: crowdfundingTaproot.networkForFabricName(c.networkName) });
      crowdfundingTaproot.signAllInputsWithKey(psbt, priv);
      return res.json({ status: 'success', campaignId: id, psbtBase64: psbt.toBase64() });
    } catch (e) {
      return res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }

  /**
   * POST body: `{ psbtBase64 }` — fully signed payout PSBT (beneficiary + arbiter).
   * Validates inputs pay the campaign vault, `crowdfundingTaproot.finalizeCrowdfundPayoutPsbt`, then `sendrawtransaction`.
   */
  _handleBitcoinCrowdfundingPayoutBroadcastRequest (req, res) {
    this._loadCrowdfundingCampaignsIfNeeded();
    const id = String((req.params && req.params.campaignId) || '').trim();
    const c = this._crowdfundingCampaigns.get(id);
    if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const psbtB64 = String(body.psbtBase64 || body.psbt || '').trim();
    if (!psbtB64) return res.status(400).json({ status: 'error', message: 'psbtBase64 is required.' });
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
    const wantOut = Buffer.from(c.outputScriptHex, 'hex');
    let psbt;
    try {
      const bitcoinjs = require('bitcoinjs-lib');
      const { Psbt } = bitcoinjs;
      psbt = Psbt.fromBase64(psbtB64, { network: crowdfundingTaproot.networkForFabricName(c.networkName) });
      for (let i = 0; i < psbt.inputCount; i++) {
        const inp = psbt.data.inputs[i];
        const wu = inp && inp.witnessUtxo;
        if (!wu || !Buffer.isBuffer(wu.script) || !wu.script.equals(wantOut)) {
          return res.status(400).json({ status: 'error', message: `Input ${i} is not a UTXO for this campaign address.` });
        }
      }
      crowdfundingTaproot.finalizeCrowdfundPayoutPsbt(psbt);
    } catch (e) {
      return res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
    const { txHex } = crowdfundingTaproot.extractPsbtTransaction(psbt);
    return Promise.resolve()
      .then(() => bitcoin._makeRPCRequest('sendrawtransaction', [txHex]))
      .then((sent) => {
        try {
          this._mergePersistedTxLabel(sent, 'crowdfunding_payout', { campaignId: id });
        } catch (_) {}
        return res.json({ status: 'success', txid: sent, campaignId: id });
      })
      .catch((e) => res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) }));
  }

  _handleBitcoinCrowdfundingRefundPrepareRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({ status: 'error', message: 'Admin token required.' });
    }
    this._loadCrowdfundingCampaignsIfNeeded();
    const id = String((req.params && req.params.campaignId) || '').trim();
    const c = this._crowdfundingCampaigns.get(id);
    if (!c) return res.status(404).json({ status: 'error', message: 'Unknown campaign.' });
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const dest = String(body.destinationAddress || body.toAddress || '').trim();
    const fundedTxid = String(body.fundedTxid || body.txid || '').trim();
    const feeSats = Math.max(1, Math.round(Number(body.feeSats || 1000)));
    let vout = body.vout != null ? Number(body.vout) : null;
    if (!dest || !fundedTxid) {
      return res.status(400).json({ status: 'error', message: 'destinationAddress and fundedTxid are required.' });
    }
    const bitcoin = this._getBitcoinService();
    if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
    return Promise.resolve()
      .then(async () => {
        const height = await bitcoin._makeRPCRequest('getblockcount', []);
        if (height < c.refundLocktimeHeight) {
          const wait = c.refundLocktimeHeight - height;
          return res.status(400).json({
            status: 'error',
            message: `Refund path unlocks at block height ${c.refundLocktimeHeight}; current tip is ${height}. Wait ${wait} more block${wait === 1 ? '' : 's'}.`
          });
        }
        const rawHex = await bitcoin._makeRPCRequest('getrawtransaction', [fundedTxid, false]);
        const tx = require('bitcoinjs-lib').Transaction.fromHex(rawHex);
        if (vout == null || !Number.isFinite(vout)) {
          vout = crowdfundingTaproot.findP2trVoutForAddress(tx, c.address, crowdfundingTaproot.networkForFabricName(c.networkName));
        }
        if (vout < 0) {
          return res.status(400).json({ status: 'error', message: 'Funding tx has no output paying the campaign P2TR address.' });
        }
        const prep = crowdfundingTaproot.prepareCrowdfundRefundPsbt({
          networkName: c.networkName || bitcoin.network || 'regtest',
          fundedTxHex: rawHex,
          paymentAddress: c.address,
          payoutScript: Buffer.from(c.payoutScriptHex, 'hex'),
          refundScript: Buffer.from(c.refundScriptHex, 'hex'),
          refundLocktimeHeight: c.refundLocktimeHeight,
          destinationAddress: dest,
          feeSats
        });
        const priv = this._hubIdentityPriv32();
        if (!priv) return res.status(503).json({ status: 'error', message: 'Hub cannot sign refund.' });
        crowdfundingTaproot.signAllInputsWithKey(prep.psbt, priv);
        crowdfundingTaproot.finalizeCrowdfundRefundPsbt(prep.psbt);
        const { txHex, txid } = crowdfundingTaproot.extractPsbtTransaction(prep.psbt);
        return res.json({
          status: 'success',
          campaignId: id,
          txHex,
          txid,
          locktime: prep.locktime,
          message: 'Signed refund tx (arbiter). Broadcast via POST /services/bitcoin/broadcast with admin token or sendrawtransaction.'
        });
      })
      .catch((e) => res.status(400).json({ status: 'error', message: e && e.message ? e.message : String(e) }));
  }

  _handleBitcoinBlockByHeightRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const heightParam = req && req.params ? req.params.height : null;
      const height = parseInt(heightParam, 10);
      if (isNaN(height) || height < 0) return res.status(400).json({ status: 'error', message: 'Valid block height is required.' });
      const hash = await bitcoin._makeRPCRequest('getblockhash', [height]);
      const block = await bitcoin._makeRPCRequest('getblock', [hash, 2]);
      return res.json(block);
    });
  }

  _handleBitcoinBlockViewRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const hash = req && req.params ? req.params.blockhash : null;
      if (!hash) return res.status(400).json({ status: 'error', message: 'Block hash is required.' });
      const block = await bitcoin._makeRPCRequest('getblock', [hash, 2]);
      return res.json(block);
    });
  }

  _handleBitcoinTransactionsListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
      const verbose = await bitcoin._makeRPCRequest('getrawmempool', [true]).catch(() => ({}));
      const txids = Object.keys(verbose || {})
        .sort((a, b) => Number((verbose[b] && verbose[b].time) || 0) - Number((verbose[a] && verbose[a].time) || 0))
        .slice(0, limit);

      const transactions = await Promise.all(txids.map(async (txid) => {
        try {
          const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
          return {
            ...tx,
            confirmations: 0,
            blockhash: null,
            height: null,
            time: (verbose[txid] && verbose[txid].time) || tx.time || null
          };
        } catch (e) {
          return null;
        }
      }));

      return res.json(transactions.filter(Boolean));
    });
  }

  _handleBitcoinTransactionViewRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const txhash = req && req.params ? req.params.txhash : null;
      if (!txhash) return res.status(400).json({ status: 'error', message: 'Transaction hash is required.' });

      const q = req.query || {};
      const payAddr = String(q.address || q.to || '').trim();
      const paySats = Number(q.amountSats != null ? q.amountSats : 0);
      if (payAddr && Number.isFinite(paySats) && paySats > 0) {
        const detail = await this._l1PaymentVerificationDetail(bitcoin, String(txhash).trim(), payAddr, paySats);
        return res.json({
          verified: !!detail.verified,
          confirmations: detail.confirmations,
          inMempool: !!detail.inMempool,
          matchedSats: detail.matchedSats,
          network: bitcoin.network,
          txid: String(txhash).trim(),
          address: payAddr,
          amountSats: Math.round(paySats)
        });
      }

      try {
        const [tx, hex] = await Promise.all([
          bitcoin._makeRPCRequest('getrawtransaction', [txhash, true]),
          bitcoin._makeRPCRequest('getrawtransaction', [txhash, false])
        ]);
        return res.json({ ...tx, hex: hex || null });
      } catch (error) {
        if (error && error.code === -5) {
          return res.status(404).json({
            status: 'error',
            message: 'Transaction not found or txindex is disabled.',
            details: error.message
          });
        }
        throw error;
      }
    });
  }

  /**
   * Normalize xpub version bytes for the given network (regtest/testnet use testnet bytes).
   */
  _normalizeXpubForNetwork (xpub, network = 'mainnet') {
    if (!xpub || typeof xpub !== 'string') return xpub;
    try {
      const decoded = bs58check.decode(xpub);
      const bytes = Buffer.from(decoded);
      if (bytes.length < 4) return xpub;
      const MAINNET_XPUB = Buffer.from([0x04, 0x88, 0xB2, 0x1E]);
      const TESTNET_XPUB = Buffer.from([0x04, 0x35, 0x87, 0xCF]);
      const net = String(network || 'mainnet').toLowerCase();
      const target = (net === 'regtest' || net === 'testnet' || net === 'signet') ? TESTNET_XPUB : MAINNET_XPUB;
      const current = bytes.subarray(0, 4);
      if (current.equals(target)) return xpub;
      const remapped = Buffer.concat([target, bytes.subarray(4)]);
      return bs58check.encode(remapped);
    } catch (_) {
      return xpub;
    }
  }

  async _scanWalletDescriptors (bitcoin, xpub, network = 'mainnet') {
    const normalizedXpub = this._normalizeXpubForNetwork(xpub, network);
    const receiveDesc = `wpkh(${normalizedXpub}/0/*)`;
    const changeDesc = `wpkh(${normalizedXpub}/1/*)`;
    const scanKey = `${network}:${normalizedXpub}`;

    const existing = this._bitcoinScanInflight.get(scanKey);
    if (existing) return existing;

    const task = (async () => {
      const [receiveInfo, changeInfo] = await Promise.all([
        bitcoin._makeRPCRequest('getdescriptorinfo', [receiveDesc]).catch(() => ({ descriptor: receiveDesc })),
        bitcoin._makeRPCRequest('getdescriptorinfo', [changeDesc]).catch(() => ({ descriptor: changeDesc }))
      ]);

      const scanObjects = [
        { desc: receiveInfo.descriptor || receiveDesc, range: [0, 999] },
        { desc: changeInfo.descriptor || changeDesc, range: [0, 999] }
      ];

      return bitcoin._makeRPCRequest('scantxoutset', ['start', scanObjects]);
    })();

    this._bitcoinScanInflight.set(scanKey, task);

    try {
      return await task;
    } finally {
      this._bitcoinScanInflight.delete(scanKey);
    }
  }

  _handleBitcoinWalletSummaryRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const walletId = (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName;
      const xpub = (req.query && req.query.xpub) ? String(req.query.xpub).trim() : '';

      const isHubWallet = walletId && String(walletId) === String(bitcoin.walletName);
      const isClientWallet = !isHubWallet && xpub;

      if (isClientWallet) {
        try {
          const network = bitcoin.network || 'regtest';
          const result = await this._scanWalletDescriptors(bitcoin, xpub, network);
          const totalBTC = result && typeof result.total_amount === 'number' ? result.total_amount : 0;
          const confirmedSats = Math.round(totalBTC * 100000000);

          let unconfirmedSats = 0;
          const addressesParam = (req.query && req.query.addresses) ? String(req.query.addresses).trim() : '';
          if (addressesParam) {
            const watchAddrs = new Set(addressesParam.split(',').map((a) => String(a).trim()).filter(Boolean));
            if (watchAddrs.size > 0) {
              const mempoolTxids = await bitcoin._makeRPCRequest('getrawmempool', []).catch(() => []);
              for (const txid of (Array.isArray(mempoolTxids) ? mempoolTxids : []).slice(0, 100)) {
                try {
                  const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]).catch(() => null);
                  if (!tx || !Array.isArray(tx.vout)) continue;
                  for (const v of tx.vout) {
                    const addr = v.scriptPubKey && v.scriptPubKey.address ? String(v.scriptPubKey.address) : '';
                    if (addr && watchAddrs.has(addr)) {
                      unconfirmedSats += Math.round(Number(v.value || 0) * 100000000);
                    }
                  }
                } catch (_) {}
              }
            }
          }

          const totalSats = confirmedSats + unconfirmedSats;

          return res.json({
            walletId,
            network,
            balanceSats: totalSats,
            confirmedSats,
            unconfirmedSats,
            summary: {
              trusted: confirmedSats / 100000000,
              untrustedPending: unconfirmedSats / 100000000,
              immature: 0
            },
            balance: totalSats / 100000000,
            unspents: (result && Array.isArray(result.unspents)) ? result.unspents : [],
            keysHeldByServer: false
          });
        } catch (err) {
          if (this.settings.debug) console.error('[HUB] scantxoutset for client wallet:', err && err.message);
          return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch address-based balance. Ensure txindex is enabled if needed.',
            details: err && err.message ? err.message : String(err)
          });
        }
      }

      if (!isHubWallet && !xpub) {
        return res.status(400).json({
          status: 'error',
          message: 'xpub required for non-Hub wallet lookup. Provide ?xpub=... for watch-only balance.'
        });
      }

      const balances = await bitcoin.getBalances().catch(() => ({}));
      const trustedBTC = balances && balances.trusted != null ? balances.trusted : 0;
      const untrustedBTC = balances && balances.untrusted_pending != null ? balances.untrusted_pending : 0;
      const trustedSats = Math.round(trustedBTC * 100000000);
      const untrustedSats = Math.round(untrustedBTC * 100000000);
      const summary = {
        walletId: String(walletId || bitcoin.walletName),
        network: bitcoin.network,
        balances: balances || {},
        balanceSats: trustedSats,
        confirmedSats: trustedSats,
        unconfirmedSats: untrustedSats,
        summary: {
          trusted: trustedBTC,
          untrustedPending: untrustedBTC,
          immature: balances && balances.immature != null ? balances.immature : 0
        }
      };
      return res.json(summary);
    });
  }

  _handleBitcoinWalletAddressRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const address = await bitcoin.getUnusedAddress();
      return res.json({
        walletId: (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName,
        network: bitcoin.network,
        address
      });
    });
  }

  /**
   * Full address info for explorer: balance, unspents, recent txids.
   * Compatible with Fabric CLI and Blockstream-style chain_stats/mempool_stats.
   */
  _handleBitcoinAddressInfoRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const address = (req.params && req.params.address) || '';
      const raw = String(address || '').trim();
      if (!raw) return res.status(400).json({ status: 'error', message: 'Address is required.' });

      try {
        const scanObj = `addr(${raw})`;
        const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
        const totalBTC = result && typeof result.total_amount === 'number' ? result.total_amount : 0;
        const totalSats = Math.round(totalBTC * 100000000);
        const unspents = (result && Array.isArray(result.unspents)) ? result.unspents : [];
        const fundedTxoSum = unspents.reduce((s, u) => s + (u.amount || 0), 0);
        const fundedTxoSats = Math.round(fundedTxoSum * 100000000);

        const recentTxids = [...new Set(unspents.map(u => u.txid).filter(Boolean))].slice(0, 25);
        const recentTxs = await Promise.all(recentTxids.map(async (txid) => {
          try {
            const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
            return tx ? { txid: tx.txid || txid, status: { confirmed: (tx.confirmations || 0) > 0 } } : null;
          } catch (_) {
            return { txid, status: { confirmed: false } };
          }
        }));

        return res.json({
          address: raw,
          network: bitcoin.network || 'regtest',
          chain_stats: {
            funded_txo_sum: fundedTxoSats,
            funded_txo_count: unspents.length,
            spent_txo_sum: 0,
            spent_txo_count: 0,
            tx_count: recentTxids.length
          },
          mempool_stats: {
            funded_txo_sum: 0,
            funded_txo_count: 0,
            spent_txo_sum: 0,
            spent_txo_count: 0,
            tx_count: 0
          },
          balance: totalBTC,
          balanceSats: totalSats,
          unspents,
          recent_txs: recentTxs.filter(Boolean)
        });
      } catch (err) {
        if (this.settings.debug) console.error('[HUB] address info:', err && err.message);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch address info. Ensure txindex is enabled.',
          details: err && err.message ? err.message : String(err)
        });
      }
    });
  }

  /**
   * Look up balance for a single address. Server does not hold keys; uses scantxoutset.
   * Requires txindex. Works for any on-chain address.
   */
  _handleBitcoinAddressBalanceRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const address = (req.params && req.params.address) || (req.query && req.query.address) || '';
      const raw = String(address || '').trim();
      if (!raw) return res.status(400).json({ status: 'error', message: 'Address is required.' });

      try {
        const scanObj = `addr(${raw})`;
        const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
        const totalBTC = result && typeof result.total_amount === 'number' ? result.total_amount : 0;
        const totalSats = Math.round(totalBTC * 100000000);

        return res.json({
          address: raw,
          network: bitcoin.network || 'regtest',
          balanceSats: totalSats,
          confirmedSats: totalSats,
          unconfirmedSats: 0,
          balance: totalBTC,
          unspents: (result && Array.isArray(result.unspents)) ? result.unspents : [],
          keysHeldByServer: false
        });
      } catch (err) {
        if (this.settings.debug) console.error('[HUB] scantxoutset for address:', err && err.message);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch address balance. Ensure txindex is enabled.',
          details: err && err.message ? err.message : String(err)
        });
      }
    });
  }

  _handleBitcoinWalletUtxosRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const walletId = (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName;
      const xpub = (req.query && req.query.xpub) ? String(req.query.xpub).trim() : '';
      const isHubWallet = walletId && String(walletId) === String(bitcoin.walletName);
      const isClientWallet = !isHubWallet && xpub;

      if (isClientWallet) {
        try {
          const network = bitcoin.network || 'regtest';
          const result = await this._scanWalletDescriptors(bitcoin, xpub, network);
          const raw = (result && Array.isArray(result.unspents)) ? result.unspents : [];
          const utxos = raw.map((u) => ({
            txid: u.txid,
            vout: u.vout,
            amount: u.amount,
            amountSats: Math.round(Number(u.amount || 0) * 100000000),
            desc: u.desc,
            scriptPubKey: u.scriptPubKey,
            height: u.height
          }));

          return res.json({
            walletId,
            network,
            utxos,
            keysHeldByServer: false
          });
        } catch (err) {
          if (this.settings.debug) console.error('[HUB] scantxoutset for client wallet UTXOs:', err && err.message);
          return res.status(500).json({
            status: 'error',
            message: 'Failed to list UTXOs for xpub. Ensure txindex is enabled.',
            details: err && err.message ? err.message : String(err)
          });
        }
      }

      if (!isHubWallet && !xpub) {
        return res.status(400).json({
          status: 'error',
          message: 'xpub required for non-Hub wallet UTXOs. The Hub does not hold your keys; pass ?xpub= for watch-only scan.'
        });
      }

      const utxos = await bitcoin._listUnspent();
      return res.json({
        walletId: String(walletId || bitcoin.walletName),
        network: bitcoin.network,
        utxos: Array.isArray(utxos) ? utxos : []
      });
    });
  }

  /**
   * List transactions for a wallet. For client wallet (xpub), uses scantxoutset to find
   * UTXOs, extracts txids, fetches full tx data. Returns receive transactions (txs that
   * created our UTXOs). Requires txindex for getrawtransaction.
   */
  _handleBitcoinWalletTransactionsRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const walletId = (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName;
      const xpub = (req.query && req.query.xpub) ? String(req.query.xpub).trim() : '';
      const isHubWallet = walletId && String(walletId) === String(bitcoin.walletName);
      const isClientWallet = !isHubWallet && xpub;
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));

      if (isClientWallet) {
        try {
          const network = bitcoin.network || 'regtest';
          const result = await this._scanWalletDescriptors(bitcoin, xpub, network);
          const unspents = (result && Array.isArray(result.unspents)) ? result.unspents : [];
          const confirmedTxids = new Set(unspents.map((u) => u.txid).filter(Boolean));

          const mempoolTxids = new Set();
          const addressesParam = (req.query && req.query.addresses) ? String(req.query.addresses).trim() : '';
          if (addressesParam) {
            const watchAddrs = new Set(addressesParam.split(',').map((a) => String(a).trim()).filter(Boolean));
            if (watchAddrs.size > 0) {
              const mempool = await bitcoin._makeRPCRequest('getrawmempool', []).catch(() => []);
              for (const txid of (Array.isArray(mempool) ? mempool : []).slice(0, 100)) {
                if (confirmedTxids.has(txid)) continue;
                try {
                  const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]).catch(() => null);
                  if (!tx || !Array.isArray(tx.vout)) continue;
                  for (const v of tx.vout) {
                    const addr = v.scriptPubKey && v.scriptPubKey.address ? String(v.scriptPubKey.address) : '';
                    if (addr && watchAddrs.has(addr)) {
                      mempoolTxids.add(txid);
                      break;
                    }
                  }
                } catch (_) {}
              }
            }
          }

          const allTxids = [...new Set([...confirmedTxids, ...mempoolTxids])].slice(0, limit);
          const watchAddrsForOurAmount = addressesParam ? new Set(addressesParam.split(',').map((a) => String(a).trim()).filter(Boolean)) : new Set();

          const transactions = await Promise.all(allTxids.map(async (txid) => {
            try {
              const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
              const totalOut = Array.isArray(tx.vout) ? tx.vout.reduce((acc, v) => acc + Number(v.value || 0), 0) : 0;
              let ourAmount = (unspents.filter((u) => u.txid === txid) || []).reduce((acc, u) => acc + Number(u.amount || 0), 0);
              if (ourAmount === 0 && watchAddrsForOurAmount.size > 0 && Array.isArray(tx.vout)) {
                for (const v of tx.vout) {
                  const addr = v.scriptPubKey && v.scriptPubKey.address ? String(v.scriptPubKey.address) : '';
                  if (addr && watchAddrsForOurAmount.has(addr)) ourAmount += Number(v.value || 0);
                }
              }
              return {
                txid,
                confirmations: tx.confirmations != null ? tx.confirmations : 0,
                blockhash: tx.blockhash || null,
                blocktime: tx.blocktime || null,
                time: tx.time || tx.blocktime || null,
                value: totalOut,
                ourAmount,
                vin: tx.vin || [],
                vout: tx.vout || []
              };
            } catch (e) {
              return null;
            }
          }));

          const sorted = transactions.filter(Boolean).sort((a, b) => {
            const at = Number(a.blocktime || a.time || 0);
            const bt = Number(b.blocktime || b.time || 0);
            return bt - at;
          });

          return res.json({
            walletId,
            network,
            transactions: this._decorateTransactionsWithFabricLabels(sorted),
            keysHeldByServer: false
          });
        } catch (err) {
          if (this.settings.debug) console.error('[HUB] wallet transactions for xpub:', err && err.message);
          return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch wallet transactions. Ensure txindex is enabled.',
            details: err && err.message ? err.message : String(err)
          });
        }
      }

      if (!isHubWallet && !xpub) {
        return res.status(400).json({
          status: 'error',
          message: 'xpub required for non-Hub wallet. Provide ?xpub=... for watch-only transaction list.'
        });
      }

      const listTx = await bitcoin._makeRPCRequest('listtransactions', ['*', 100]).catch(() => []);
      const txids = [...new Set((listTx || []).map((t) => t.txid).filter(Boolean))].slice(0, limit);
      const transactions = await Promise.all(txids.map(async (txid) => {
        try {
          const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
          return {
            txid,
            confirmations: tx.confirmations != null ? tx.confirmations : 0,
            blockhash: tx.blockhash || null,
            blocktime: tx.blocktime || null,
            time: tx.time || tx.blocktime || null,
            value: Array.isArray(tx.vout) ? tx.vout.reduce((acc, v) => acc + Number(v.value || 0), 0) : 0,
            vin: tx.vin || [],
            vout: tx.vout || []
          };
        } catch (e) {
          return null;
        }
      }));

      return res.json({
        walletId,
        network: bitcoin.network,
        transactions: this._decorateTransactionsWithFabricLabels(transactions.filter(Boolean))
      });
    });
  }

  _handleBitcoinWalletSendRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const body = req.body || {};
      const rpcToken = body.adminToken || body.token;
      if (!this.setup || typeof this.setup.verifyAdminToken !== 'function' || !this.setup.verifyAdminToken(rpcToken)) {
        return res.status(403).json({
          status: 'error',
          message: 'Admin token required to spend from the Hub wallet (same as sendpayment RPC).'
        });
      }

      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const to = String(body.to || body.address || '').trim();
      const amountSats = Number(body.amountSats || 0);
      const amountBTC = Number((amountSats / 100000000).toFixed(8));
      const memo = String(body.memo || '');

      if (!to) return res.status(400).json({ status: 'error', message: 'Destination address is required.' });
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        return res.status(400).json({ status: 'error', message: 'amountSats must be a positive integer.' });
      }

      const txid = await bitcoin._processSpendMessage({
        destination: to,
        amount: amountBTC,
        comment: memo
      });

      try {
        if (txid) this._mergePersistedTxLabel(String(txid), 'bridge_payment', { destination: to, memo: memo || undefined });
      } catch (_) {}

      const walletId = String((req.params && req.params.walletId) || body.walletId || bitcoin.walletName);
      return res.json({
        walletId,
        network: bitcoin.network,
        payment: {
          txid,
          destination: to,
          amountSats: Math.round(amountSats),
          amountBTC
        }
      });
    });
  }

  _handleBitcoinFaucetRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      try {
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
        if (bitcoin.network !== 'regtest') {
          return res.status(400).json({ status: 'error', message: 'Faucet is only available on regtest.' });
        }

        const FAUCET_MAX_SATS = 1000000; // 0.01 BTC cap per request
        const body = req.body || {};
        const to = String(body.address || body.to || '').trim();
        let amountSats = Number(body.amountSats || 10000);
        if (!Number.isFinite(amountSats) || amountSats <= 0) amountSats = 10000;
        amountSats = Math.min(Math.round(amountSats), FAUCET_MAX_SATS);
        const amountBTC = Number((amountSats / 100000000).toFixed(8));

        if (!to) return res.status(400).json({ status: 'error', message: 'Destination address is required.' });

        const valid = bitcoin.validateAddress && typeof bitcoin.validateAddress === 'function'
          ? bitcoin.validateAddress(to)
          : true;
        if (!valid) {
          const net = (bitcoin.network || '').toLowerCase();
          let hint = 'Use a valid regtest address (e.g. bcrt1...).';
          const addr = String(to).toLowerCase();
          if (net === 'regtest' && (addr.startsWith('bc1') && !addr.startsWith('bcrt1'))) {
            hint = 'You entered a mainnet address (bc1...). For regtest, use a bcrt1... address instead.';
          } else if (net === 'testnet' && addr.startsWith('bc1') && !addr.startsWith('tb1')) {
            hint = 'You entered a mainnet address (bc1...). For testnet, use a tb1... address instead.';
          } else if (net === 'mainnet' && (addr.startsWith('bcrt1') || addr.startsWith('tb1'))) {
            hint = 'You entered a regtest/testnet address. For mainnet, use a bc1... address.';
          }
          return res.status(400).json({ status: 'error', message: `Invalid Bitcoin address for this network. ${hint}` });
        }

        // Regtest/playnet often has no smart-fee data (estimatesmartfee empty). Fabric's
        // _processSpendMessage uses conf_target=1 + "conservative", which then fails coin
        // selection with a misleading [-6] Insufficient funds. Use explicit fee_rate instead.
        await bitcoin._loadWallet(bitcoin.walletName);
        const txid = await bitcoin._makeWalletRequest('sendtoaddress', [
          to,
          amountBTC,
          'faucet',
          'faucet',
          false,
          true,
          null,
          'unset',
          false,
          1
        ], bitcoin.walletName);

        try {
          if (txid) this._mergePersistedTxLabel(String(txid), 'faucet_payment', { destination: to });
        } catch (_) {}

        return res.json({
          status: 'success',
          network: bitcoin.network,
          source: 'beacon',
          faucet: {
            txid,
            destination: to,
            amountSats,
            amountBTC
          }
        });
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return res.status(500).json({ status: 'error', error: message, message });
      }
    });
  }

  _handleBitcoinPaymentsListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
      const verbose = await bitcoin._makeRPCRequest('getrawmempool', [true]).catch(() => ({}));
      const txids = Object.keys(verbose || {})
        .sort((a, b) => Number((verbose[b] && verbose[b].time) || 0) - Number((verbose[a] && verbose[a].time) || 0))
        .slice(0, limit);

      const payments = await Promise.all(txids.map(async (txid) => {
        try {
          const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
          return {
            txid,
            time: (verbose[txid] && verbose[txid].time) || tx.time || null,
            fee: verbose[txid] && verbose[txid].fee != null ? verbose[txid].fee : null,
            vsize: verbose[txid] && verbose[txid].vsize != null ? verbose[txid].vsize : null,
            value: Array.isArray(tx.vout) ? tx.vout.reduce((acc, v) => acc + Number(v.value || 0), 0) : null
          };
        } catch (e) {
          return null;
        }
      }));

      return res.json(payments.filter(Boolean));
    });
  }

  _handlePayjoinStatusRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) {
        return res.status(503).json({
          available: false,
          status: 'UNAVAILABLE',
          service: 'payjoin',
          message: 'Payjoin service is disabled on this Hub node.'
        });
      }

      const capabilities = payjoin.getCapabilities();
      this._state.content.services.payjoin = {
        available: !!capabilities.available,
        sessions: Number(capabilities.counts && capabilities.counts.sessions ? capabilities.counts.sessions : 0)
      };
      return res.json(capabilities);
    });
  }

  _handlePeeringServiceRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const peering = this._getPeeringService();
      if (!peering) {
        return res.status(503).json({
          available: false,
          service: 'peering',
          message: 'Peering service is disabled on this Hub node.'
        });
      }
      const capabilities = peering.getCapabilities();
      if (this._state && this._state.content && this._state.content.services) {
        this._state.content.services.peering = {
          available: !!capabilities.available,
          kind: capabilities.kind || null
        };
      }
      return res.json(capabilities);
    });
  }

  _handlePeeringAttestationRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const peering = this._getPeeringService();
      if (!peering) {
        return res.status(503).json({ status: 'error', message: 'Peering service is disabled on this Hub node.' });
      }
      try {
        return res.json(peering.buildOracleAttestation());
      } catch (e) {
        return res.status(503).json({
          status: 'error',
          message: e && e.message ? e.message : 'Unable to build attestation'
        });
      }
    });
  }

  _handleChallengeServiceRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const challenge = this._getChallengeService();
      if (!challenge) {
        return res.status(503).json({
          available: false,
          service: 'challenge',
          message: 'Challenge service is disabled on this Hub node.'
        });
      }
      const caps = challenge.getCapabilities();
      const body = {
        ...caps,
        challenges: challenge.list()
      };
      if (this._state && this._state.content && this._state.content.services) {
        this._state.content.services.challenge = {
          available: !!caps.available,
          count: Number(caps.count) || 0
        };
      }
      return res.json(body);
    });
  }

  _handlePayjoinDepositRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });

      const bitcoin = this._getBitcoinService();
      const body = req.body || {};
      const walletId = String(body.walletId || '').trim() || (bitcoin ? bitcoin.walletName : 'default');
      const amountSats = Number(body.amountSats || 0);
      const label = String(body.label || body.memo || '').trim();
      const memo = String(body.memo || '').trim();
      const expiresInSeconds = Number(body.expiresInSeconds || 0) || undefined;
      const receiveTemplate = String(body.receiveTemplate || '').trim();
      const federationXOnlyHex = String(body.federationXOnlyHex || '').trim();
      let address = String(body.address || '').trim();
      if (!receiveTemplate) {
        address = address || (bitcoin ? await bitcoin.getUnusedAddress() : '');
      }
      if (!receiveTemplate && !address) {
        return res.status(400).json({ status: 'error', message: 'Deposit address is required.' });
      }

      const session = await payjoin.createDepositSession({
        walletId,
        amountSats,
        label,
        memo,
        expiresInSeconds,
        address,
        receiveTemplate,
        federationXOnlyHex: federationXOnlyHex || undefined
      });

      this._state.content.services.payjoin = this._state.content.services.payjoin || {};
      this._state.content.services.payjoin.available = true;
      this._state.content.services.payjoin.sessions = Number((payjoin.state && payjoin.state.counts && payjoin.state.counts.sessions) || 0);

      return res.json({
        service: 'payjoin',
        bip: 'BIP78',
        asyncPayjoinRoadmap: 'BIP77',
        status: 'success',
        session
      });
    });
  }

  _handlePayjoinSessionsListRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 25)));
      const includeExpired = String(req.query.includeExpired || '').toLowerCase() !== 'false';
      const sessions = payjoin.listSessions({ limit, includeExpired }).map((session) => payjoin.getSession(session.id, {
        includeProposals: true,
        proposalSummariesOnly: true
      }));
      return res.json({
        service: 'payjoin',
        sessions
      });
    });
  }

  _handlePayjoinSessionViewRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const sessionId = req && req.params ? req.params.sessionId : null;
      if (!sessionId) return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
      const session = payjoin.getSession(sessionId, { includeProposals: true });
      if (!session) return res.status(404).json({ status: 'error', message: 'Payjoin session not found.' });
      return res.json({
        service: 'payjoin',
        session
      });
    });
  }

  _handlePayjoinProposalSubmitRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const sessionId = req && req.params ? req.params.sessionId : null;
      if (!sessionId) return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
      const body = req.body || {};
      const result = await payjoin.submitProposal(sessionId, {
        psbt: body.psbt,
        txhex: body.txhex
      });
      try {
        const prop = result && result.proposal;
        const tid = prop && payjoin.extractProposalTxid(prop);
        if (tid) {
          this._mergePersistedTxLabel(tid, 'payjoin', {
            sessionId: String(sessionId),
            proposalId: prop.id
          });
        }
      } catch (_) {}
      return res.json(result);
    });
  }

  /**
   * POST /services/payjoin/sessions/:sessionId/acp-hub-boost (mirrors: /payments/payjoin/…, /services/bitcoin/payjoin/…)
   * Payer PSBT must use SIGHASH_ALL|ANYONECANPAY on their input(s) so Hub can append + sign a wallet UTXO
   * without changing outputs (extra sats increase miner fee). Admin token required.
   */
  _handlePayjoinAcpHubBoostRequest (req, res) {
    const token = SetupService.extractBearerToken(req);
    if (!this.setup.verifyAdminToken(token)) {
      return res.status(401).json({
        status: 'error',
        message: 'Admin token required. The Hub wallet co-signs an additional input (regtest / ops).'
      });
    }
    return this.http.jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const sessionId = req && req.params ? req.params.sessionId : null;
      if (!sessionId) return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
      const psbtOverride = String(body.psbt || body.psbtBase64 || '').trim();
      const id = String(sessionId).trim();
      const session = payjoin._payjoinState && payjoin._payjoinState.sessions
        ? payjoin._payjoinState.sessions[id]
        : null;
      if (!session) return res.status(404).json({ status: 'error', message: 'Payjoin session not found.' });
      const proposals = Object.values(session.proposals || {})
        .filter((p) => p && p.psbt)
        .sort((a, b) => new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime());
      const last = proposals.length ? proposals[proposals.length - 1] : null;
      const sourcePsbt = psbtOverride || (last && last.psbt) || '';
      if (!sourcePsbt) {
        return res.status(400).json({ status: 'error', message: 'No PSBT on session; submit a proposal first or pass psbt in the body.' });
      }
      const payjoinAcpBoost = require('../functions/payjoinAcpBoost');
      let out;
      try {
        out = await payjoinAcpBoost.addHubWalletInputAndSign({
          psbtBase64: sourcePsbt,
          bitcoin,
          networkName: bitcoin.network || 'regtest'
        });
      } catch (e) {
        return res.status(400).json({
          status: 'error',
          message: e && e.message ? e.message : String(e)
        });
      }
      return res.json({
        status: 'success',
        type: 'PayjoinAcpHubBoost',
        sessionId: id,
        proposalId: last ? last.id : null,
        psbtBase64: out.psbtBase64,
        addedOutpoint: out.addedOutpoint,
        addedValueSats: out.addedValueSats,
        walletProcessPsbtComplete: out.complete,
        note: 'Outputs were not modified; payer ANYONECANPAY signatures remain valid. Finalize + broadcast when all inputs are signed.'
      });
    });
  }

  async _executeBitcoinServiceMethod (method, params = {}) {
    const action = String(method || '').trim().toLowerCase();
    const bitcoin = this._getBitcoinService();
    const doesNotRequireBitcoin = [
      'getbitcoinstatus',
      'status',
      'getpayjoinstatus',
      'payjoinstatus',
      'createpayjoindeposit',
      'listpayjoinsessions',
      'getpayjoinsession',
      'submitpayjoinproposal'
    ];
    if (!bitcoin && !doesNotRequireBitcoin.includes(action)) {
      return { status: 'error', message: 'Bitcoin service unavailable' };
    }

    switch (action) {
      case 'status':
      case 'getbitcoinstatus': {
        const status = await this._collectBitcoinStatus({ force: true });
        return status;
      }
      case 'listblocks': {
        const status = await this._collectBitcoinStatus({ force: true });
        if (!status || !status.available) return status || { status: 'error', message: 'Bitcoin service unavailable' };
        const limit = Math.max(1, Math.min(100, Number(params.limit || 25)));
        return (status.recentBlocks || []).slice(0, limit);
      }
      case 'getblock': {
        const blockhash = String(params.blockhash || params.hash || '').trim();
        if (!blockhash) return { status: 'error', message: 'Block hash is required.' };
        return bitcoin._makeRPCRequest('getblock', [blockhash, 2]);
      }
      case 'listtransactions': {
        const limit = Math.max(1, Math.min(100, Number(params.limit || 25)));
        const verbose = await bitcoin._makeRPCRequest('getrawmempool', [true]).catch(() => ({}));
        const txids = Object.keys(verbose || {})
          .sort((a, b) => Number((verbose[b] && verbose[b].time) || 0) - Number((verbose[a] && verbose[a].time) || 0))
          .slice(0, limit);

        const transactions = await Promise.all(txids.map(async (txid) => {
          try {
            const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
            return {
              ...tx,
              confirmations: 0,
              blockhash: null,
              height: null,
              time: (verbose[txid] && verbose[txid].time) || tx.time || null
            };
          } catch (e) {
            return null;
          }
        }));

        return transactions.filter(Boolean);
      }
      case 'listpeers':
      case 'getpeerinfo': {
        const peers = await bitcoin._makeRPCRequest('getpeerinfo', []).catch(() => []);
        return Array.isArray(peers) ? peers : [];
      }
      case 'getnetworksummary': {
        const [networkInfo, blockchain, deployments] = await Promise.all([
          bitcoin._makeRPCRequest('getnetworkinfo', []).catch(() => null),
          bitcoin._makeRPCRequest('getblockchaininfo', []).catch(() => null),
          bitcoin._makeRPCRequest('getdeploymentinfo', []).catch(() => null)
        ]);
        return { networkInfo, blockchain, deployments };
      }
      case 'generateblock': {
        const rpcToken = params.adminToken || params.token;
        if (!this.setup.verifyAdminToken(rpcToken)) {
          return { status: 'error', message: 'Admin token required for block generation.' };
        }
        if (bitcoin.network !== 'regtest') {
          return { status: 'error', message: 'Block generation is only available on regtest.' };
        }

        const count = Math.max(1, Math.min(10, Number(params.count || 1)));
        // Always use Hub's wallet so coinbase rewards go to the Hub node.
        const address = await bitcoin.getUnusedAddress();
        const hashes = [];

        for (let i = 0; i < count; i++) {
          const generated = await bitcoin._makeRPCRequest('generatetoaddress', [1, address]);
          if (Array.isArray(generated)) hashes.push(...generated);
          else if (generated) hashes.push(generated);
        }

        await this._collectBitcoinStatus({ force: true });
        return {
          status: 'success',
          network: bitcoin.network,
          address,
          count,
          blockHashes: hashes
        };
      }
      case 'gettransaction': {
        const txhash = String(params.txhash || params.txid || '').trim();
        if (!txhash) return { status: 'error', message: 'Transaction hash is required.' };
        try {
          return await bitcoin._makeRPCRequest('getrawtransaction', [txhash, true]);
        } catch (error) {
          if (error && error.code === -5) {
            return {
              status: 'error',
              message: 'Transaction not found or txindex is disabled.',
              details: error.message
            };
          }
          throw error;
        }
      }
      case 'getwalletsummary': {
        const walletId = String(params.walletId || bitcoin.walletName || '');
        const balances = await bitcoin.getBalances().catch(() => ({}));
        return {
          walletId,
          network: bitcoin.network,
          balances: balances || {},
          summary: {
            trusted: balances && balances.trusted != null ? balances.trusted : 0,
            untrustedPending: balances && balances.untrusted_pending != null ? balances.untrusted_pending : 0,
            immature: balances && balances.immature != null ? balances.immature : 0
          }
        };
      }
      case 'getwalletaddress': {
        const walletId = String(params.walletId || bitcoin.walletName || '');
        const address = await bitcoin.getUnusedAddress();
        return { walletId, network: bitcoin.network, address };
      }
      case 'listwalletutxos': {
        const walletId = String(params.walletId || bitcoin.walletName || '');
        const utxos = await bitcoin._listUnspent();
        return {
          walletId,
          network: bitcoin.network,
          utxos: Array.isArray(utxos) ? utxos : []
        };
      }
      case 'sendpayment': {
        const rpcToken = params.adminToken || params.token;
        if (!this.setup.verifyAdminToken(rpcToken)) {
          return { status: 'error', message: 'Admin token required to spend from the Hub wallet (bridge payment).' };
        }
        const to = String(params.to || params.address || '').trim();
        const amountSats = Number(params.amountSats || 0);
        const amountBTC = Number((amountSats / 100000000).toFixed(8));
        const memo = String(params.memo || '');
        const walletId = String(params.walletId || bitcoin.walletName || '');

        if (!to) return { status: 'error', message: 'Destination address is required.' };
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'amountSats must be a positive integer.' };
        }

        const txid = await bitcoin._processSpendMessage({
          destination: to,
          amount: amountBTC,
          comment: memo
        });

        try {
          if (txid) this._mergePersistedTxLabel(String(txid), 'bridge_payment', { destination: to, memo: memo || undefined });
        } catch (_) {}

        return {
          walletId,
          network: bitcoin.network,
          payment: {
            txid,
            destination: to,
            amountSats: Math.round(amountSats),
            amountBTC
          }
        };
      }
      case 'verifyl1payment': {
        const txid = String(params.txid || '').trim();
        const addr = String(params.address || params.to || '').trim();
        const amountSats = Number(params.amountSats || 0);
        if (!txid) return { status: 'error', message: 'txid is required.' };
        if (!addr) return { status: 'error', message: 'address is required.' };
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'amountSats must be a positive integer.' };
        }
        const detail = await this._l1PaymentVerificationDetail(bitcoin, txid, addr, amountSats);
        return {
          verified: !!detail.verified,
          confirmations: detail.confirmations,
          inMempool: !!detail.inMempool,
          matchedSats: detail.matchedSats,
          network: bitcoin.network,
          txid,
          address: addr,
          amountSats: Math.round(amountSats)
        };
      }
      case 'getpayjoinstatus':
      case 'payjoinstatus': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        return payjoin.getCapabilities();
      }
      case 'createpayjoindeposit': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const receiveTemplate = String(params.receiveTemplate || '').trim();
        const federationXOnlyHex = String(params.federationXOnlyHex || '').trim();
        let address = String(params.address || '').trim();
        if (!receiveTemplate) {
          address = address || (bitcoin ? await bitcoin.getUnusedAddress() : '');
        }
        if (!receiveTemplate && !address) return { status: 'error', message: 'address is required' };
        return payjoin.createDepositSession({
          walletId: String(params.walletId || (bitcoin && bitcoin.walletName) || ''),
          amountSats: Number(params.amountSats || 0),
          label: String(params.label || params.memo || ''),
          memo: String(params.memo || ''),
          expiresInSeconds: Number(params.expiresInSeconds || 0) || undefined,
          address,
          receiveTemplate,
          federationXOnlyHex: federationXOnlyHex || undefined
        });
      }
      case 'listpayjoinsessions': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const limit = Math.max(1, Math.min(200, Number(params.limit || 25)));
        const includeExpired = !!params.includeExpired;
        return payjoin.listSessions({ limit, includeExpired }).map((session) => payjoin.getSession(session.id, { includeProposals: false }));
      }
      case 'getpayjoinsession': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const sessionId = String(params.sessionId || params.id || '').trim();
        if (!sessionId) return { status: 'error', message: 'sessionId is required.' };
        const session = payjoin.getSession(sessionId, { includeProposals: true });
        if (!session) return { status: 'error', message: 'Payjoin session not found.' };
        return session;
      }
      case 'submitpayjoinproposal': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const sessionId = String(params.sessionId || params.id || '').trim();
        if (!sessionId) return { status: 'error', message: 'sessionId is required.' };
        return payjoin.submitProposal(sessionId, {
          psbt: params.psbt,
          txhex: params.txhex
        });
      }
      default:
        return { status: 'error', message: `Unknown bitcoin method: ${method}` };
    }
  }

  _handleBitcoinRPCRequest (req, res) {
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    // Bitcoind-compatible JSON-RPC 2.0 (params array) — passthrough + local verifymessage.
    if (body.jsonrpc === '2.0' && typeof body.method === 'string') {
      return Promise.resolve()
        .then(() => this._hubBitcoindJsonRpc(body, res))
        .catch((error) => {
          const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;
          res.setHeader('Content-Type', 'application/json');
          return res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: error && error.message ? error.message : String(error) },
            id
          });
        });
    }
    const method = body.method || body.action || '';
    const params = (body.params && typeof body.params === 'object') ? body.params : body;
    return Promise.resolve()
      .then(() => this._executeBitcoinServiceMethod(method, params))
      .then((result) => {
        if (result && result.status === 'error') return res.status(400).json(result);
        return res.json(result);
      })
      .catch((error) => {
        return res.status(500).json({
          status: 'error',
          message: error && error.message ? error.message : String(error)
        });
      });
  }

  /**
   * POST /services/bitcoin with body { jsonrpc: '2.0', method, params: [], id }.
   * - verifymessage: implemented locally (no bitcoind) using tiny-secp256k1 + bitcoinjs-lib.
   * - other methods: forwarded to Fabric Bitcoin service RPC when available (passthrough to bitcoind).
   */
  async _hubBitcoindJsonRpc (body, res) {
    const method = String(body.method || '').trim();
    const params = Array.isArray(body.params) ? body.params : [];
    const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;
    const reply = (err, result) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        const msg = err && err.message ? err.message : String(err);
        return res.status(200).json({
          jsonrpc: '2.0',
          error: { code: typeof err.code === 'number' ? err.code : -1, message: msg },
          id
        });
      }
      return res.status(200).json({ jsonrpc: '2.0', result, id });
    };

    const bitcoin = this._getBitcoinService();
    const netName = (bitcoin && bitcoin.settings && bitcoin.settings.network) || 'regtest';

    if (method === 'verifymessage') {
      const [addr, sig, msg] = params;
      if (addr == null || sig == null || msg === undefined) {
        return reply(Object.assign(new Error('verifymessage requires address, signature, message'), { code: -32602 }));
      }
      try {
        const ok = bitcoinCoreMessage.verifyMessage(String(addr), String(sig), String(msg), netName);
        return reply(null, ok);
      } catch (e) {
        return reply(e);
      }
    }

    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') {
      return reply(new Error('Bitcoin RPC unavailable (Hub has no upstream bitcoind)'));
    }

    try {
      const result = await bitcoin._makeRPCRequest(method, params);
      return reply(null, result);
    } catch (e) {
      const err = e && (e.message || e.code) ? e : new Error(String(e));
      if (err && typeof err === 'object' && err.code !== undefined && !err.message) {
        return reply(Object.assign(new Error(JSON.stringify(err)), { code: err.code }));
      }
      return reply(err);
    }
  }

  _serializedLightningRpc (fn) {
    const p = this._lightningRpcQueue.then(() => fn());
    this._lightningRpcQueue = p.catch(() => {});
    return p;
  }

  _handleLightningStatusRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const stub = this.settings.lightning && this.settings.lightning.stub === true;
      if (stub) {
        return res.status(200).json({
          available: true,
          status: 'STUB',
          service: 'lightning',
          message: 'Lightning stub enabled for UI testing. Invoices and payments are simulated.'
        });
      }
      if (this.lightning) {
        try {
          // Serialize RPC to avoid CLN connection contention (concurrent listfunds can timeout)
          const info = await this._serializedLightningRpc(() => this.lightning._makeRPCRequest('getinfo', []));
          const funds = await this._serializedLightningRpc(() =>
            this.lightning._makeRPCRequest('listfunds', [], 60000)
          ).catch(() => ({ outputs: [], channels: [] }));
          const addresses = Array.isArray(info.address) ? info.address : [];
          const bindings = Array.isArray(info.binding) ? info.binding : [];
          const addr = addresses.find((a) => a && (a.type === 'ipv4' || a.type === 'ipv6')) || addresses[0];
          const bind = bindings.find((b) => b && (b.type === 'ipv4' || b.type === 'ipv6')) || bindings[0];
          const hostPort = (addr && addr.address && addr.port ? `${addr.address}:${addr.port}` : null) ||
            (bind && bind.address && bind.port ? `${bind.address}:${bind.port}` : null);
          let depositAddress = null;
          let balanceSats = 0;
          try {
            const newaddr = await this._serializedLightningRpc(() => this.lightning._makeRPCRequest('newaddr', ['p2tr']));
            depositAddress = newaddr.p2tr || newaddr.bech32 || null;
          } catch (_) {}
          const outputs = Array.isArray(funds.outputs) ? funds.outputs : [];
          let balanceUnconfirmedSats = 0;
          let balanceImmatureSats = 0;
          for (const o of outputs) {
            const amt = o.amount_msat != null ? Math.floor(Number(o.amount_msat) / 1000) : (o.amount_sat != null ? Number(o.amount_sat) : 0);
            const status = String(o.status || '').toLowerCase();
            if (status === 'confirmed') balanceSats += amt;
            else if (status === 'unconfirmed') balanceUnconfirmedSats += amt;
            else if (status === 'immature') balanceImmatureSats += amt;
          }
          // Fallback: if outputs exist but all sums are 0, sum non-spent (handles unexpected status values)
          if (outputs.length > 0 && balanceSats === 0 && balanceUnconfirmedSats === 0 && balanceImmatureSats === 0) {
            for (const o of outputs) {
              if (String(o.status || '').toLowerCase() !== 'spent') {
                const amt = o.amount_msat != null ? Math.floor(Number(o.amount_msat) / 1000) : (o.amount_sat != null ? Number(o.amount_sat) : 0);
                balanceUnconfirmedSats += amt;
              }
            }
          }
          return res.status(200).json({
            available: true,
            status: 'RUNNING',
            service: 'lightning',
            node: {
              id: info.id,
              alias: info.alias,
              color: info.color,
              address: hostPort,
              addresses,
              binding: bind ? `${bind.address}:${bind.port}` : null,
              depositAddress,
              balanceSats,
              balanceUnconfirmedSats: balanceUnconfirmedSats > 0 ? balanceUnconfirmedSats : undefined,
              balanceImmatureSats: balanceImmatureSats > 0 ? balanceImmatureSats : undefined
            },
            message: 'Lightning node is running.'
          });
        } catch (err) {
          return res.status(200).json({
            available: false,
            status: 'ERROR',
            service: 'lightning',
            message: err && err.message ? err.message : 'Lightning node error.'
          });
        }
      }
      return res.status(200).json({
        available: false,
        status: 'NOT_CONFIGURED',
        service: 'lightning',
        message: 'Lightning runs automatically with regtest. Use regtest for local development.'
      });
    });
  }

  _handleLightningCollectionRequest (req, res) {
    return this.http.jsonOrShell(req, res, async () => {
      const stub = this.settings.lightning && this.settings.lightning.stub === true;
      const pathName = req && req.path ? req.path : '/services/lightning';
      if (stub) {
        if (pathName.includes('/channels')) {
          return res.status(200).json({ channels: [], outputs: [] });
        }
        if (pathName.includes('/invoices')) {
          return res.status(200).json({ invoices: [] });
        }
        if (pathName.includes('/payments')) {
          return res.status(200).json({ payments: [] });
        }
        if (pathName.includes('/decodes')) {
          return res.status(200).json({ decodes: [] });
        }
        return res.status(200).json({ invoices: [], payments: [], decodes: [] });
      }
      if (this.lightning) {
        try {
          if (pathName.includes('/channels')) {
            const funds = await this._serializedLightningRpc(() =>
              this.lightning._makeRPCRequest('listfunds', [], 60000)
            ).catch(() => ({ outputs: [], channels: [] }));
            return res.status(200).json({ channels: funds.channels || [], outputs: funds.outputs || [] });
          }
          if (pathName.includes('/invoices')) {
            const list = await this.lightning._makeRPCRequest('listinvoices', []);
            return res.status(200).json({ invoices: list.invoices || [] });
          }
          if (pathName.includes('/payments')) {
            const list = await this.lightning._makeRPCRequest('listpays', []);
            return res.status(200).json({ payments: list.pays || [] });
          }
          return res.status(200).json({ invoices: [], payments: [], decodes: [], channels: [] });
        } catch (err) {
          return res.status(503).json({
            available: false,
            status: 'ERROR',
            service: 'lightning',
            message: err && err.message ? err.message : 'Lightning request failed.'
          });
        }
      }
      return res.status(503).json({
        available: false,
        status: 'UNAVAILABLE',
        service: 'lightning',
        path: pathName,
        message: 'Lightning runs automatically with regtest. Use regtest for local development.'
      });
    });
  }

  /** Close a Lightning channel (REST: DELETE …/channels/:channelId). */
  _handleLightningChannelDeleteRequest (req, res) {
    const stub = this.settings.lightning && this.settings.lightning.stub === true;
    const raw = req && req.params && req.params.channelId != null ? String(req.params.channelId) : '';
    let channelId = raw.trim();
    try {
      channelId = decodeURIComponent(channelId);
    } catch (_) {}
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }
    if (stub) {
      return res.status(200).json({ closed: true, stub: true, channelId });
    }
    if (!this.lightning) {
      return res.status(503).json({
        available: false,
        status: 'UNAVAILABLE',
        service: 'lightning',
        message: 'Lightning runs automatically with regtest. Use regtest for local development.'
      });
    }
    return this.http.jsonOrShell(req, res, async () => {
      try {
        const result = await this._serializedLightningRpc(() =>
          this.lightning._makeRPCRequest('close', [channelId])
        );
        return res.status(200).json({ closed: true, result, channelId });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        return res.status(500).json({ error: msg, channelId });
      }
    });
  }

  _handleLightningMutationRequest (req, res) {
    const pathName = (req && req.path ? req.path : '').toLowerCase();
    const stub = this.settings.lightning && this.settings.lightning.stub === true;
    const body = req && req.body ? req.body : {};

    if (stub) {
      if (pathName.endsWith('/invoices') || pathName.includes('/invoice')) {
        const amountSats = Number(body.amountSats || 0);
        const memo = String(body.memo || '').trim() || 'stub invoice';
        return res.status(200).json({
          invoice: `lnbc${amountSats}n1stub${Buffer.from(memo).toString('base64').slice(0, 40)}`,
          paymentHash: 'stub_' + Date.now(),
          amountSats,
          memo,
          stub: true
        });
      }
      if (pathName.endsWith('/decodes') || pathName.includes('/decode')) {
        const invoice = String(body.invoice || '').trim();
        return res.status(200).json({
          decoded: {
            paymentHash: invoice ? 'stub_decode_' + invoice.slice(0, 20) : 'stub',
            numSatoshis: invoice.match(/\d+/) ? parseInt(invoice.match(/\d+/)[0], 10) : 0,
            description: 'Stub decoded invoice'
          },
          stub: true
        });
      }
      if (pathName.endsWith('/payments') || pathName.includes('/pay')) {
        return res.status(200).json({
          payment: { preimage: 'stub_preimage', paymentHash: 'stub_pay_' + Date.now() },
          stub: true
        });
      }
    }

    if (this.lightning) {
      return this.http.jsonOrShell(req, res, async () => {
        try {
          if (pathName.endsWith('/invoices') || pathName.includes('/invoice')) {
            const amountSats = Number(body.amountSats || 0);
            const memo = String(body.memo || '').trim() || 'Hub invoice';
            const msat = Math.max(1000, amountSats * 1000);
            const inv = await this.lightning.createInvoice(String(msat), memo, memo);
            return res.status(200).json({
              invoice: inv.bolt11,
              paymentHash: inv.paymentHash,
              amountSats,
              memo
            });
          }
          if (pathName.endsWith('/decodes') || pathName.includes('/decode')) {
            const invoice = String(body.invoice || '').trim();
            if (!invoice) return res.status(400).json({ error: 'invoice required' });
            const decoded = await this.lightning._makeRPCRequest('decodepay', [invoice]);
            return res.status(200).json({
              decoded: {
                paymentHash: decoded.payment_hash,
                numSatoshis: decoded.amount_msat ? Math.floor(Number(decoded.amount_msat) / 1000) : 0,
                description: decoded.description || ''
              }
            });
          }
          if (pathName.endsWith('/payments') || pathName.includes('/pay')) {
            const invoice = String(body.invoice || '').trim();
            if (!invoice) return res.status(400).json({ error: 'invoice required' });
            const pay = await this.lightning._makeRPCRequest('pay', [invoice]);
            return res.status(200).json({
              payment: { preimage: pay.payment_preimage, paymentHash: pay.payment_hash }
            });
          }
          if (pathName.endsWith('/channels') || pathName.includes('/channel')) {
            const peerId = String(body.peerId || body.peer_id || '').trim();
            const remote = String(body.remote || '').trim();
            const amountSats = Number(body.amountSats || body.amount_sats || 0);
            const pushMsat = body.pushMsat != null ? Number(body.pushMsat) : (body.push_msat != null ? Number(body.push_msat) : null);
            let connectString = remote;
            if (connectString && peerId && !connectString.includes('@')) {
              connectString = `${peerId}@${connectString}`;
            }
            const resolvedPeerId = connectString && connectString.includes('@')
              ? connectString.split('@')[0].trim()
              : peerId;
            if (!resolvedPeerId) return res.status(400).json({ error: 'peerId or remote (id@ip:port) required' });
            if (amountSats < 10000) return res.status(400).json({ error: 'amountSats must be at least 10000' });
            if (connectString) {
              const maxConnectAttempts = 3;
              let lastConnectErr = null;
              for (let attempt = 1; attempt <= maxConnectAttempts; attempt++) {
                try {
                  await this.lightning.connectTo(connectString);
                  lastConnectErr = null;
                  break;
                } catch (err) {
                  lastConnectErr = err;
                  const msg = err && err.message ? err.message : String(err);
                  if (msg.includes('already connected')) {
                    lastConnectErr = null;
                    break;
                  }
                  if (msg.includes('Bad file descriptor') && attempt < maxConnectAttempts) {
                    await new Promise(r => setTimeout(r, 1500 * attempt));
                    continue;
                  }
                  if (msg.includes('Bad file descriptor') && attempt === maxConnectAttempts) {
                    let status = {};
                    try {
                      const [info, peersResp] = await Promise.all([
                        this.lightning._makeRPCRequest('getinfo', []).catch(() => ({})),
                        this.lightning._makeRPCRequest('listpeers', []).catch(() => ({ peers: [] }))
                      ]);
                      const peers = peersResp.peers || [];
                      const idlePeers = peers.filter(p => p.connected && p.num_channels === 0 && p.id !== resolvedPeerId);
                      let idleDisconnected = 0;
                      for (const p of idlePeers) {
                        try {
                          await this.lightning._makeRPCRequest('disconnect', [p.id]);
                          idleDisconnected++;
                        } catch (_) {}
                      }
                      status = { getinfo: info, peerCount: peers.length, idleDisconnected };
                      if (idlePeers.length > 0) {
                        await new Promise(r => setTimeout(r, 2000));
                        try {
                          await this.lightning.connectTo(connectString);
                          lastConnectErr = null;
                          break;
                        } catch (retryErr) {
                          lastConnectErr = retryErr;
                        }
                      }
                    } catch (diagErr) {
                      status.diagnosticError = diagErr && diagErr.message ? diagErr.message : String(diagErr);
                    }
                    if (lastConnectErr) {
                      const detail = lastConnectErr && lastConnectErr.message ? lastConnectErr.message : String(lastConnectErr);
                      let hint = 'Disconnected idle peers and retried. Restart the Lightning node or check ulimit -n if this persists.';
                      if (/Unsupported feature|feature 44|WIRE_WARNING|peer_disconnected/i.test(detail)) {
                        hint = 'The remote node does not support BOLT 9 feature 44 (channel_type). Upgrade the remote Lightning node (e.g. LND, CLN, Eclair) to a version that supports it (2021+).';
                      }
                      return res.status(400).json({
                        error: 'Failed to connect to peer',
                        detail,
                        status,
                        hint
                      });
                    }
                    break;
                  }
                  let hint;
                  if (/Unsupported feature|feature 44|WIRE_WARNING|peer_disconnected/i.test(msg)) {
                    hint = 'The remote node does not support BOLT 9 feature 44 (channel_type). Upgrade the remote Lightning node to a version that supports it (2021+).';
                  }
                  return res.status(400).json({
                    error: 'Failed to connect to peer',
                    detail: msg,
                    ...(hint ? { hint } : {})
                  });
                }
              }
            }
            const bitcoin = this._getBitcoinService();
            const isRegtest = bitcoin && (bitcoin.settings && bitcoin.settings.network) === 'regtest';
            const channelOptions = isRegtest ? { minconf: 0, feerate: '253perkw' } : {};
            // Fetch listfunds and pass explicit utxos to fundchannel; bypasses "0 available UTXOs" when
            // CLN's internal UTXO selection fails (e.g. bitcoind view mismatch on regtest).
            try {
              const funds = await this._serializedLightningRpc(() =>
                this.lightning._makeRPCRequest('listfunds', [], 60000)
              ).catch(() => ({ outputs: [], channels: [] }));
              const outputs = Array.isArray(funds.outputs) ? funds.outputs : [];
              const spendable = outputs.filter(
                (o) => String(o.status || '').toLowerCase() !== 'spent' && !o.reserved
              );
              if (spendable.length > 0) {
                channelOptions.utxos = spendable.map((o) => `${o.txid}:${o.output}`);
              }
            } catch (_) {}
            const result = await this._serializedLightningRpc(() =>
              this.lightning.createChannel(resolvedPeerId, String(amountSats), pushMsat, channelOptions)
            );
            return res.status(200).json({ channel: result });
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          let hint;
          if (/Unsupported feature|feature 44|WIRE_WARNING|peer_disconnected/i.test(msg)) {
            hint = 'The remote node does not support BOLT 9 feature 44 (channel_type). Upgrade the remote Lightning node to a version that supports it (2021+).';
          }
          return res.status(500).json({
            error: msg,
            ...(hint ? { hint } : {})
          });
        }
        return res.status(400).json({ error: 'Unknown Lightning mutation path' });
      });
    }

    return res.status(503).json({
      available: false,
      status: 'UNAVAILABLE',
      service: 'lightning',
      path: pathName,
      message: 'Lightning runs automatically with regtest.'
    });
  }

  async startBeacon () {
    const beaconConfig = this.settings.beacon || {};
    if (beaconConfig.enable === false) return this;

    const bitcoin = this._getBitcoinService();
    if (!bitcoin) {
      console.warn('[HUB:BEACON] Skipping beacon start: Bitcoin service unavailable.');
      return this;
    }

    if (beaconConfig.regtestOnly === true && bitcoin.network !== 'regtest') {
      console.log(`[HUB:BEACON] Skipping beacon start for non-regtest network: ${bitcoin.network}`);
      return this;
    }

    if (typeof bitcoin._isBitcoindOnline === 'function') {
      const online = await bitcoin._isBitcoindOnline().catch(() => false);
      if (!online) {
        console.log('[HUB:BEACON] Bitcoin RPC not ready yet; deferring beacon start.');
        return this;
      }
    }

    const isRegtest = bitcoin.network === 'regtest';
    const interval = isRegtest ? Number(beaconConfig.interval || 600000) : 0;

    if (!this.beacon) {
      this.beacon = new Beacon({
        name: 'HUB:BEACON',
        debug: !!this.settings.debug,
        interval,
        regtest: isRegtest
      });
    } else {
      this.beacon.settings.interval = interval;
      this.beacon.settings.regtest = isRegtest;
    }

    this.beacon.bitcoin = bitcoin;
    const _fedVals = this._distributedFederationValidatorsFromEnv();
    const _fedThrRaw = this._distributedFederationThresholdEffective();
    this.beacon.attach({
      fs: this.fs,
      key: this._rootKey,
      federationValidators: _fedVals,
      federationThreshold: _fedVals.length ? _fedThrRaw : Math.max(1, _fedThrRaw),
      getSidechainSnapshotForEpoch: () => this._getSidechainSnapshotForBeacon()
    });

    this.beacon.on('epoch', (epochPayload) => {
      try {
        // Store beacon in private state only (not in global state) — balance/blockHash are sensitive.
        this._beaconEpochState = {
          status: 'RUNNING',
          interval: this.beacon.settings.regtest !== false ? Number(beaconConfig.interval || 600000) : 0,
          clock: Number(epochPayload && epochPayload.clock ? epochPayload.clock : 0),
          lastBlockHash: epochPayload && epochPayload.blockHash ? epochPayload.blockHash : null,
          height: epochPayload && Number.isFinite(epochPayload.height) ? epochPayload.height : null,
          balance: epochPayload && Number.isFinite(epochPayload.balance) ? epochPayload.balance : 0,
          balanceSats: epochPayload && Number.isFinite(epochPayload.balanceSats) ? epochPayload.balanceSats : 0,
          updatedAt: new Date().toISOString()
        };
        const bc = epochPayload && epochPayload.clock != null ? Number(epochPayload.clock) : NaN;
        if (Number.isFinite(bc) && this._sidechainState) {
          const dig = sidechainState.stateDigest(this._sidechainState);
          const want = epochPayload.sidechain && epochPayload.sidechain.stateDigest;
          if (want && want !== dig) {
            console.warn('[HUB:SIDECHAIN] Epoch sidechain digest mismatch vs hub state; snapshot uses in-memory STATE');
          }
          sidechainState.saveSnapshotForBeaconClockSync(this.fs, bc, this._sidechainState);
          if (this.fs && typeof this.fs.synchronize === 'function') {
            this.fs.synchronize().catch((e) => {
              console.warn('[HUB:SIDECHAIN] Filesystem synchronize after snapshot failed:', e && e.message ? e.message : e);
            });
          }
        }
      } catch (e) {
        console.warn('[HUB:BEACON] Failed to store epoch metadata:', e && e.message ? e.message : e);
      }
    });

    this.beacon.on('error', (err) => {
      console.error('[HUB:BEACON] Error:', err && err.message ? err.message : err);
    });

    this.beacon.on('reorg', (info) => {
      this._beaconReorgChain = this._beaconReorgChain
        .then(() => this._handleBeaconReorgForSidechain(info))
        .then(() => {
          try {
            this._refreshChainState('beacon-reorg');
          } catch (e) {
            console.warn('[HUB:BEACON] Failed to refresh chain after reorg:', e && e.message ? e.message : e);
          }
        })
        .catch((e) => {
          console.warn('[HUB:SIDECHAIN] Reorg handling failed:', e && e.message ? e.message : e);
        });
    });

    await this.beacon.start();
    await this._reconcileSidechainToBeaconTip();
    const modeDesc = isRegtest ? `${this.beacon.settings.interval}ms interval` : '1 event per block';
    console.log(`[HUB:BEACON] Started (${modeDesc}) on ${bitcoin.network}.`);
    return this;
  }

  async _startBitcoinServiceWithTimeout () {
    if (!this.bitcoin) return { started: false, reason: 'disabled' };

    const timeoutMs = Math.max(3000, Math.min(60000, Number(this.settings.bitcoin.startTimeoutMs || 10000)));
    let settled = false;

    const startPromise = (async () => {
      try {
        await this.bitcoin.start();
        await this._collectBitcoinStatus({ force: true });
        settled = true;
        return { started: true };
      } catch (bitcoinStartError) {
        settled = true;
        const msg = bitcoinStartError && bitcoinStartError.message ? bitcoinStartError.message : String(bitcoinStartError);
        console.warn('[HUB] Bitcoin service failed to start:', msg);
          this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic({ available: false, status: 'ERROR', message: msg });
          return { started: false, reason: msg };
      }
    })();

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ started: false, timedOut: true }), timeoutMs);
    });

    const result = await Promise.race([startPromise, timeoutPromise]);
    if (result && result.timedOut && !settled) {
      console.warn(`[HUB] Bitcoin did not become ready within ${timeoutMs}ms.`);
    }
    return result;
  }

  /**
   * Managed regtest bitcoind can refuse to boot if `regtest/settings.json` is malformed
   * after an unclean shutdown. Detect and quarantine the file before startup so the node
   * can recreate defaults.
   * @returns {void}
   */
  _repairManagedRegtestSettingsJsonIfCorrupt () {
    try {
      if (!this.bitcoin || !this.settings || !this.settings.bitcoin) return;
      if (this.settings.bitcoin.managed !== true) return;
      if (this.settings.bitcoin.network !== 'regtest') return;

      const datadirRaw = this.settings.bitcoin.datadir || './stores/bitcoin-regtest';
      const datadir = resolveStorePath(datadirRaw);
      const settingsPath = path.join(datadir, 'regtest', 'settings.json');
      if (!fs.existsSync(settingsPath)) return;

      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (!raw || !raw.trim()) {
        fs.unlinkSync(settingsPath);
        console.warn('[HUB] Removed empty Bitcoin settings file:', settingsPath);
        return;
      }

      try {
        JSON.parse(raw);
      } catch (parseError) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${settingsPath}.corrupt-${stamp}.bak`;
        fs.renameSync(settingsPath, backupPath);
        console.warn('[HUB] Quarantined corrupt Bitcoin settings JSON:', settingsPath, '->', backupPath);
      }
    } catch (repairError) {
      console.warn(
        '[HUB] Could not preflight-repair managed regtest settings.json:',
        repairError && repairError.message ? repairError.message : repairError
      );
    }
  }

  async _startLightningServiceIfEnabled () {
    const bitcoin = this._getBitcoinService();
    if (!bitcoin || (bitcoin.settings && bitcoin.settings.network) !== 'regtest') {
      console.log('[HUB:LIGHTNING] Skipping Lightning: requires regtest Bitcoin.');
      return;
    }

    const lightningManaged = this.settings.lightning && this.settings.lightning.managed !== false;

    try {
      if (lightningManaged) {
        const btcSettings = bitcoin.settings || {};
        const btcDatadirRaw = btcSettings.datadir || './stores/bitcoin-regtest';
        const btcDatadir = path.isAbsolute(btcDatadirRaw)
          ? btcDatadirRaw
          : path.resolve(hubStoreRoot(), btcDatadirRaw);
        const rpcport = Number(btcSettings.rpcport || 18443);
        const username = btcSettings.username || '';
        const password = btcSettings.password || '';

        if (!username || !password) {
          console.warn('[HUB:LIGHTNING] Bitcoin RPC credentials not available; Lightning not started.');
          return;
        }

        const lnDatadir = (this.settings.lightning && this.settings.lightning.datadir)
          ? this.settings.lightning.datadir
          : path.resolve(hubStoreRoot(), './stores/lightning/hub');

        const lnPortRaw = this.settings.lightning && this.settings.lightning.port;
        const lnPort = lnPortRaw != null && String(lnPortRaw).trim() !== '' ? Number(lnPortRaw) : null;

        this.lightning = new Lightning({
          managed: true,
          network: 'regtest',
          datadir: lnDatadir,
          hostname: '0.0.0.0',
          ...(Number.isFinite(lnPort) ? { port: lnPort } : {}),
          debug: !!this.settings.debug,
          bitcoin: {
            host: btcSettings.host || '127.0.0.1',
            rpcport,
            rpcuser: username,
            rpcpassword: password,
            datadir: btcDatadir
          },
          disablePlugins: ['cln-grpc']
        });
      } else {
        const socketPath = this.settings.lightning && this.settings.lightning.socketPath;
        if (!socketPath || typeof socketPath !== 'string' || !socketPath.trim()) {
          console.warn('[HUB:LIGHTNING] External Lightning socket path not configured; Lightning not started.');
          return;
        }
        const fullPath = path.resolve(socketPath.trim());
        this.lightning = new Lightning({
          managed: false,
          network: 'regtest',
          datadir: path.dirname(fullPath),
          socket: path.basename(fullPath),
          debug: !!this.settings.debug
        });
      }

      this.lightning.on('debug', (...args) => console.log('[LIGHTNING]', '[DEBUG]', ...args));
      this.lightning.on('error', (err) => console.error('[LIGHTNING]', '[ERROR]', err && err.message ? err.message : err));

      await this.lightning.start();
      console.log('[HUB:LIGHTNING] Lightning node started.', lightningManaged ? '(managed)' : '(external)');
    } catch (err) {
      console.warn('[HUB:LIGHTNING] Failed to start Lightning:', err && err.message ? err.message : err);
      this.lightning = null;
    }
  }

  /**
   * Start the instance.
   * @returns {Hub} Instance of the {@link Hub}.
   */
  async start () {
    try {
      // Listen for agent errors
      this.agent.on('error', (err) => {
        const msg = err && err.message ? err.message : String(err || '');
        if (msg.includes('Failed to save peer registry: Database is not open')) {
          // Recover quietly: this can happen during edge close/open races.
          // Re-open/refresh the registry handle for subsequent writes.
          if (this.agent && typeof this.agent._loadPeerRegistry === 'function') {
            this.agent._loadPeerRegistry().catch(() => {});
          }
          if (this.settings.debug) {
            console.debug('[HUB:AGENT:DEBUG] Peer registry transiently unavailable; reloading handle.');
          }
          return;
        }
        console.error('[HUB:AGENT:ERROR]', err && err.stack ? err.stack : err);
      });

      this.agent.on('debug', (err) => {
        console.debug('[HUB:AGENT:DEBUG]', err && err.stack ? err.stack : err);
      });

      // Listen for HTTP server errors
      this.http.on('error', (err) => {
        console.error('[HUB:HTTP:ERROR]', err && err.stack ? err.stack : err);
      });
      await this.fs.start();
      await this._bootstrapFederationFilesystem();
      if (this.chain && typeof this.chain.start === 'function') {
        await this.chain.start();
      }

      if (this.bitcoin) {
        this.bitcoin.on('debug', (...args) => console.log('[BITCOIN]', '[DEBUG]', ...args));
        this.bitcoin.on('error', (...error) => console.error('[BITCOIN]', '[ERROR]', ...error));
        this.bitcoin.on('log', (...log) => console.log('[BITCOIN]', ...log));
        this.bitcoin.on('warning', (...warning) => console.warn('[BITCOIN]', '[WARNING]', ...warning));
        this.bitcoin.on('block', this._handleBitcoinBlockUpdate.bind(this));
        this.bitcoin.on('transaction', this._handleBitcoinTransactionUpdate.bind(this));
        this._state.content.services.bitcoin = this._state.content.services.bitcoin || {};
        this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic({ available: false, status: 'STARTING', message: 'Starting Bitcoin...' });
        // Enable debug so bitcoind stdout and RPC wait progress are visible while startup takes time
        this.bitcoin.settings.debug = true;
        this._repairManagedRegtestSettingsJsonIfCorrupt();
        console.log('[HUB] Starting Bitcoin (blocking until ready or timeout)...');
        const result = await this._startBitcoinServiceWithTimeout();
        if (result && result.started) {
          console.log('[HUB] Bitcoin service ready.');
          await this.startBeacon();
          await this._startLightningServiceIfEnabled();
        } else {
          const msg = result && result.timedOut
            ? `Bitcoin did not become ready within ${this.settings.bitcoin.startTimeoutMs || 15000}ms.`
            : (result && result.reason ? result.reason : 'Bitcoin failed to start.');
          this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic({ available: false, status: 'ERROR', message: msg });
          throw new Error(`[HUB] Bitcoin startup required but failed: ${msg}`);
        }
      }

      if (this.payjoin && this.settings.payjoin && this.settings.payjoin.enable !== false) {
        this.payjoin.attach({
          fs: this.fs,
          bitcoin: this._getBitcoinService(),
          key: this._rootKey
        });
        await this.payjoin.start();
      }

      if (this.email) {
        await this.email.start();
      }

      if (this.peering && this.settings.peering && this.settings.peering.enable !== false) {
        this.peering.attach({
          key: this._rootKey,
          hub: this
        });
      }

      // Load prior state
      const file = this.fs.readFile('STATE');
      const state = (file) ? JSON.parse(file) : this.state;

      // Assign properties
      Object.assign(this._state.content, state);
      this._ensureResourceCollections();

      // Migrate to Fabric chain shape: chain.tree, chain.genesis. Messages stay at top level (collections.messages).
      this._state.content.chain = this._state.content.chain || {};
      if (this._state.content.fabricMessageTree && !this._state.content.chain.tree) {
        this._state.content.chain.tree = this._state.content.fabricMessageTree;
        delete this._state.content.fabricMessageTree;
      }
      if (this._state.content.genesisMessage != null && this._state.content.chain.genesis == null) {
        this._state.content.chain.genesis = this._state.content.genesisMessage;
        delete this._state.content.genesisMessage;
      }
      // Migrate chain.messages (object of full messages) -> collections.messages. chain.messages stays as array of IDs.
      if (this._state.content.chain?.messages && typeof this._state.content.chain.messages === 'object' && !Array.isArray(this._state.content.chain.messages)) {
        if (!this._state.content.collections) this._state.content.collections = {};
        if (!this._state.content.collections.messages || Object.keys(this._state.content.collections.messages).length === 0) {
          this._state.content.collections.messages = this._state.content.chain.messages;
        }
        this._state.content.chain.messages = Object.values(this._state.content.collections.messages)
          .filter((m) => m && m.id)
          .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
          .map((m) => m.id);
      }
      // Migrate merkle -> chain (legacy)
      if (this._state.content.merkle && !this._state.content.chain.id) {
        this._state.content.chain = Object.assign({}, this._state.content.chain, this._state.content.merkle);
        if (this._state.content.chain.fabricMessageTree) {
          this._state.content.chain.tree = this._state.content.chain.tree || this._state.content.chain.fabricMessageTree;
          delete this._state.content.chain.fabricMessageTree;
        }
        delete this._state.content.merkle;
      }
      if (this._state.content.collections?.merkle && !this._state.content.collections.chain) {
        const tree = this._state.content.chain?.tree || { leaves: 0, root: null };
        this._state.content.collections.chain = {};
        for (const [k, v] of Object.entries(this._state.content.collections.merkle)) {
          this._state.content.collections.chain[k] = v && typeof v === 'object'
            ? Object.assign({}, v, { tree: v.tree || v.fabricMessageTree || tree })
            : v;
        }
        if (this._state.content.collections.chain) {
          for (const entry of Object.values(this._state.content.collections.chain)) {
            if (entry && entry.fabricMessageTree) delete entry.fabricMessageTree;
          }
        }
        delete this._state.content.collections.merkle;
      }

      // Sanitize services on restore — only public info in global state
      this._state.content.services = this._state.content.services || {};
      if (this._state.content.services.bitcoin && this._state.content.services.bitcoin.status) {
        this._state.content.services.bitcoin.status = this._sanitizeBitcoinStatusForPublic(this._state.content.services.bitcoin.status);
      }
      if (this._state.content.services.bitcoin) {
        delete this._state.content.services.bitcoin.balance;
        delete this._state.content.services.bitcoin.beacon;
      }
      if (this._state.content.services.payjoin && this._state.content.services.payjoin.merkle !== undefined) {
        delete this._state.content.services.payjoin.merkle;
      }

      if (this._state.content.collections && this._state.content.collections.chain) {
        for (const entry of Object.values(this._state.content.collections.chain)) {
          if (entry && entry.roots && Object.prototype.hasOwnProperty.call(entry.roots, 'bundles')) {
            delete entry.roots.bundles;
          }
        }
      }

      this._state.content.services = this._state.content.services || {};
      this._state.content.services.payjoin = this._state.content.services.payjoin || { available: false, sessions: 0 };
      if (this.email) {
        const mode = typeof this.email.getTransportMode === 'function' ? this.email.getTransportMode() : null;
        this._state.content.services.email = {
          enabled: true,
          configured: !!mode,
          transport: mode
        };
      } else {
        this._state.content.services.email = { enabled: false, configured: false, transport: null };
      }

      // Seed _state.documents from restored collections so ListDocuments has the index
      try {
        this._state.documents = this._state.documents || {};
        const collections = this._state && this._state.content && this._state.content.collections;
        const publishedDocs = collections && collections.documents;
        if (publishedDocs && typeof publishedDocs === 'object') {
          for (const id of Object.keys(publishedDocs)) {
            const entry = publishedDocs[id];
            if (!entry || typeof entry !== 'object') continue;
            if (!this._state.documents[id]) {
              this._state.documents[id] = {
                id: entry.id || id,
                sha256: entry.sha256 || id,
                name: entry.name,
                mime: entry.mime,
                size: entry.size,
                created: entry.created,
                published: entry.published,
                lineage: entry.lineage || entry.id || id,
                parent: entry.parent || null,
                revision: entry.revision || 1,
                edited: entry.edited || entry.created || null,
                ...(entry.bitcoinHeight != null && Number.isFinite(Number(entry.bitcoinHeight))
                  ? { bitcoinHeight: Math.round(Number(entry.bitcoinHeight)) }
                  : {}),
                ...(entry.bitcoinBlockHash ? { bitcoinBlockHash: String(entry.bitcoinBlockHash) } : {}),
                ...(entry.bitcoinTxid ? { bitcoinTxid: String(entry.bitcoinTxid) } : {})
              };
            }
          }
        }
      } catch (err) {
        console.error('[HUB] Failed to seed documents index from content store:', err);
      }

      if (this.challenge && this.settings.challenge && this.settings.challenge.enable !== false) {
        this.challenge.attach({ hub: this, fs: this.fs });
        await this.challenge.start();
        if (this._state.content.services) {
          const caps = this.challenge.getCapabilities();
          this._state.content.services.challenge = {
            available: !!caps.available,
            count: Number(caps.count) || 0
          };
        }
      }

      await this._ensureGenesisMessage();

      // Contract deploy
      console.debug('[HUB]', 'Contract ID:', this.contract.id);
      console.debug('[HUB]', 'Contract State:', this.contract.state);

      // TODO: retrieve contract ID, add to local state
      this.contract.deploy();
      this.commit();

      if (this.bitcoin) {
        try {
          const st = await this._collectBitcoinStatus({ force: true });
          await this._syncPrunedBitcoinIndexDocuments(st);
        } catch (e) {
          console.warn('[HUB:BITCOIN] startup prune inventory sync:', e && e.message ? e.message : e);
        }
      }

      // Load HTML document from disk to serve from memory
      try {
        this.applicationString = fs.readFileSync(path.join(hubAssetsDir(), 'index.html')).toString('utf8');
      } catch (err) {
        console.error('[HUB]', 'Failed to load assets/index.html:', err && err.message ? err.message : err);
        this.applicationString = '<html><body><h1>hub.fabric.pub</h1><p>Application shell unavailable.</p></body></html>';
      }

      // Dev-only: embed hub mnemonic into the HTML shell so the browser can mirror node FABRIC_SEED / FABRIC_MNEMONIC.
      // Requires explicit FABRIC_DEV_PUSH_BROWSER_IDENTITY=1|true|force — never enable on an exposed host.
      const pushBrowserId = process.env.FABRIC_DEV_PUSH_BROWSER_IDENTITY;
      if (pushBrowserId === '1' || pushBrowserId === 'true' || pushBrowserId === 'force') {
        const envPhrase = process.env.FABRIC_SEED || process.env.FABRIC_MNEMONIC || '';
        const keyCfg = this.settings && this.settings.key ? this.settings.key : {};
        const settingsPhrase = keyCfg.seed || keyCfg.mnemonic || '';
        const phrase = String(envPhrase || settingsPhrase || '').trim();
        const passRaw = process.env.FABRIC_PASSPHRASE || process.env.FABRIC_DEV_BROWSER_PASSPHRASE || keyCfg.passphrase || '';
        const pass = String(passRaw || '').trim();
        if (phrase) {
          const forceFlag = pushBrowserId === 'force' ? 'window.FABRIC_DEV_BROWSER_IDENTITY="force";' : '';
          const passJs = pass
            ? `window.FABRIC_DEV_BROWSER_PASSPHRASE=${JSON.stringify(pass)};`
            : '';
          const inj = `<script>(function(){window.FABRIC_DEV_BROWSER_SEED=${JSON.stringify(phrase)};${passJs}${forceFlag}})();</script>`;
          const needle = '<script src="/bundles/browser.min.js"></script>';
          if (this.applicationString.includes(needle)) {
            this.applicationString = this.applicationString.replace(needle, `${inj}${needle}`);
            console.warn(
              '[HUB] FABRIC_DEV_PUSH_BROWSER_IDENTITY: mnemonic embedded in HTML shell. ' +
              'Local development only — do not expose this process to untrusted networks; prefer config.local.js or Identity import.'
            );
          }
        } else {
          console.warn('[HUB] FABRIC_DEV_PUSH_BROWSER_IDENTITY set but no FABRIC_SEED / FABRIC_MNEMONIC / settings.key mnemonic.');
        }
      }

      if (this.http && typeof this.http.setApplicationHtml === 'function') {
        this.http.setApplicationHtml(this.applicationString);
      } else if (this.http && this.http.settings && typeof this.http.settings === 'object') {
        this.http.settings.applicationString = this.applicationString;
      }

      // Load DEVELOPERS.md into buffer
      const devMdPath = path.resolve(__dirname, '../DEVELOPERS.md');
      try {
        this.buffers.DEVELOPERS = fs.readFileSync(devMdPath, 'utf8');
        console.log('[HUB] Loaded DEVELOPERS.md into buffer.');
      } catch (err) {
        this.buffers.DEVELOPERS = '# Not found';
        console.warn('[HUB] DEVELOPERS.md not found:', devMdPath);
      }

      // Add API route for /api/developers
      this.http._addRoute('GET', '/api/developers', (req, res) => {
        const accept = req.headers['accept'] || '';
        if (accept.includes('text/html')) {
          res.setHeader('Content-Type', 'text/html');
          res.send(`<html><body><pre>${this.buffers.DEVELOPERS.replace(/</g, '&lt;')}</pre></body></html>`);
        } else if (accept.includes('application/json')) {
          res.setHeader('Content-Type', 'application/json');
          res.send({ content: this.buffers.DEVELOPERS });
        } else {
          res.setHeader('Content-Type', 'text/plain');
          res.send(this.buffers.DEVELOPERS);
        }
      });

      this.http._addRoute('POST', '/services/rpc', this._handleHttpJsonRpcRequest.bind(this));
      this.http._addRoute('GET', '/services/operator/health', this._handleOperatorHealthRequest.bind(this));
      this.http._addRoute('GET', '/services/ui-config', this._handleHubUiConfigRequest.bind(this));

      // Bitcoin service surface:
      // - GET routes are browser-friendly (HTML shell or JSON by Accept header)
      // - POST /services/bitcoin is the compact JSON-RPC style endpoint
      // - resource paths use plural nouns
      this.http._addRoute('GET', '/services/bitcoin', this._handleBitcoinStatusRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin', this._handleBitcoinRPCRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/peers', this._handleBitcoinPeersListRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/network', this._handleBitcoinNetworkInfoRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/broadcast', this._handleBitcoinBroadcastRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/blocks', this._handleBitcoinBlocksListRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/blocks', this._handleBitcoinGenerateBlockRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/blocks/height/:height', this._handleBitcoinBlockByHeightRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/blocks/:blockhash', this._handleBitcoinBlockViewRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/transactions', this._handleBitcoinTransactionsListRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/transactions/:txhash', this._handleBitcoinTransactionViewRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets', this._handleBitcoinWalletSummaryRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId', this._handleBitcoinWalletSummaryRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/addresses', this._handleBitcoinWalletAddressRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/addresses/:address/balance', this._handleBitcoinAddressBalanceRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/addresses/:address', this._handleBitcoinAddressInfoRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId/utxos', this._handleBitcoinWalletUtxosRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId/transactions', this._handleBitcoinWalletTransactionsRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/payments', this._handleBitcoinPaymentsListRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/payments', this._handleBitcoinWalletSendRequest.bind(this));
      this.http._addRoute('GET', '/payments', this._handleBitcoinPaymentsListRequest.bind(this));
      this.http._addRoute('POST', '/payments', this._handleBitcoinWalletSendRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/faucet', this._handleBitcoinFaucetRequest.bind(this));
      /* Taproot crowdfunding (2-of-2 payout + CLTV arbiter refund); see functions/crowdfundingTaproot.js */
      this.http._addRoute('GET', '/services/bitcoin/crowdfunding/campaigns/:campaignId/acp-donation-psbt', this._handleBitcoinCrowdfundingAcpDonationPsbtRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/crowdfunding/campaigns/:campaignId/payout-psbt', this._handleBitcoinCrowdfundingPayoutPsbtRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/crowdfunding/campaigns/:campaignId/payout-sign-arbiter', this._handleBitcoinCrowdfundingPayoutSignArbiterRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/crowdfunding/campaigns/:campaignId/payout-broadcast', this._handleBitcoinCrowdfundingPayoutBroadcastRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/crowdfunding/campaigns/:campaignId/refund-prepare', this._handleBitcoinCrowdfundingRefundPrepareRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/crowdfunding/campaigns/:campaignId', this._handleBitcoinCrowdfundingGetRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/crowdfunding/campaigns', this._handleBitcoinCrowdfundingListRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/crowdfunding/campaigns', this._handleBitcoinCrowdfundingCreateRequest.bind(this));
      /* Payjoin: GET capabilities; sessions collection (GET list, POST create); session item GET; proposals sub-collection POST */
      const payjoinRoutes = [
        ['GET', '/services/payjoin', this._handlePayjoinStatusRequest.bind(this)],
        ['GET', '/services/payjoin/sessions', this._handlePayjoinSessionsListRequest.bind(this)],
        ['POST', '/services/payjoin/sessions', this._handlePayjoinDepositRequest.bind(this)],
        ['GET', '/services/payjoin/sessions/:sessionId', this._handlePayjoinSessionViewRequest.bind(this)],
        ['POST', '/services/payjoin/sessions/:sessionId/proposals', this._handlePayjoinProposalSubmitRequest.bind(this)],
        ['POST', '/services/payjoin/sessions/:sessionId/acp-hub-boost', this._handlePayjoinAcpHubBoostRequest.bind(this)]
      ];
      for (const [method, route, handler] of payjoinRoutes) {
        this.http._addRoute(method, route, handler);
      }
      // Alternate path (same handlers) for older clients / stored BIP21 `pj=` URLs.
      for (const [method, route, handler] of payjoinRoutes) {
        const paymentsMirror = route.replace(/^\/services\/payjoin/, '/payments/payjoin');
        if (paymentsMirror !== route) this.http._addRoute(method, paymentsMirror, handler);
      }
      // Legacy paths (same handlers) — persisted proposalURL values may still reference these.
      for (const [method, route, handler] of payjoinRoutes) {
        const legacy = route.replace(/^\/services\/payjoin/, '/services/bitcoin/payjoin');
        if (legacy !== route) this.http._addRoute(method, legacy, handler);
      }
      /* Peering: Fabric P2P + WebRTC discovery; OracleAttestation over Hub identity key */
      this.http._addRoute('GET', '/services/peering', this._handlePeeringServiceRequest.bind(this));
      this.http._addRoute('GET', '/services/peering/attestation', this._handlePeeringAttestationRequest.bind(this));
      this.http._addRoute('GET', '/services/challenges', this._handleChallengeServiceRequest.bind(this));
      /* Collaboration: contacts, email invitations, multisig-oriented groups (see functions/hubCollaboration.js) */
      hubCollaboration.registerHttp(this);
      /* Distributed execution: manifest + beacon epoch status (@fabric/core + @fabric/http) */
      if (this.settings.distributed && this.settings.distributed.enable !== false && this.distributedHttp) {
        this.distributedHttp.bind(this.http);
        this.http._addRoute('GET', '/services/distributed/vault', this._handleDistributedVaultRequest.bind(this));
        this.http._addRoute('GET', '/services/distributed/vault/utxos', this._handleDistributedVaultUtxosRequest.bind(this));
      }
      this.http._addRoute('GET', '/services/distributed/federation-registry', this._handleDistributedFederationRegistryRequest.bind(this));
      /* Lightning: GET status / collections; POST create; DELETE channel by id */
      this.http._addRoute('GET', '/services/lightning', this._handleLightningStatusRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning/channels', this._handleLightningCollectionRequest.bind(this));
      this.http._addRoute('DELETE', '/services/lightning/channels/:channelId', this._handleLightningChannelDeleteRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning/invoices', this._handleLightningCollectionRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning/payments', this._handleLightningCollectionRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning/decodes', this._handleLightningCollectionRequest.bind(this));
      this.http._addRoute('POST', '/services/lightning', this._handleLightningMutationRequest.bind(this));
      this.http._addRoute('POST', '/services/lightning/channels', this._handleLightningMutationRequest.bind(this));
      this.http._addRoute('POST', '/services/lightning/invoices', this._handleLightningMutationRequest.bind(this));
      this.http._addRoute('POST', '/services/lightning/payments', this._handleLightningMutationRequest.bind(this));
      this.http._addRoute('POST', '/services/lightning/decodes', this._handleLightningMutationRequest.bind(this));

      // Settings API: GET /settings (list + setup status), POST /settings (bootstrap when not configured)
      this.http._addRoute('GET', '/settings', this._handleSettingsListRequest.bind(this));
      this.http._addRoute('POST', '/settings', this._handleSettingsBootstrapRequest.bind(this));
      this.http._addRoute('POST', '/settings/refresh', this._handleSettingsRefreshRequest.bind(this));
      this.http._addRoute('GET', '/settings/:name', this._handleSettingsGetRequest.bind(this));
      this.http._addRoute('PUT', '/settings/:name', this._handleSettingsPutRequest.bind(this));

      mountFabricDelegationHttp(this);
      mountFabricDesktopAuthHttp(this);

      // Configure routes
      this._addAllRoutes();

      // Bind event listeners
      // this.trust(this.spa, 'FABRIC:SPA');
      this.trust(this.http, 'FABRIC:HTTP');
      this.trust(this.agent, 'FABRIC:AGENT');

      if (typeof this.http._registerBitcoin === 'function') {
        this.http._registerBitcoin(this.bitcoin || null);
      }

      this.http._registerMethod('getUnusedAddress', async () => {
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) throw new Error('Bitcoin service is unavailable.');
        const address = await bitcoin.getUnusedAddress();
        return { address, network: bitcoin.network };
      });

      this.http._registerMethod('GetBitcoinStatus', async () => {
        return this._collectBitcoinStatus({ force: true });
      });

      this.http._registerMethod('GetAddressBalance', async (...params) => {
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) throw new Error('Bitcoin service is unavailable.');
        const body = params[0] || {};
        const address = String(body.address || '').trim();
        if (!address) throw new Error('address is required');
        const scanObj = `addr(${address})`;
        const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', [scanObj]]);
        const totalBTC = result && typeof result.total_amount === 'number' ? result.total_amount : 0;
        const totalSats = Math.round(totalBTC * 100000000);
        return {
          address,
          network: bitcoin.network || 'regtest',
          balanceSats: totalSats,
          balance: totalBTC,
          keysHeldByServer: false
        };
      });

      this.http._registerMethod('VerifyBitcoinL1Payment', async (...params) => {
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) throw new Error('Bitcoin service is unavailable.');
        const body = params[0] || {};
        const txid = String(body.txid || '').trim();
        const address = String(body.address || body.to || '').trim();
        const amountSats = Number(body.amountSats || 0);
        if (!txid) throw new Error('txid is required.');
        if (!address) throw new Error('address is required.');
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          throw new Error('amountSats must be a positive integer.');
        }
        const detail = await this._l1PaymentVerificationDetail(bitcoin, txid, address, amountSats);
        return {
          verified: !!detail.verified,
          confirmations: detail.confirmations,
          inMempool: !!detail.inMempool,
          matchedSats: detail.matchedSats,
          network: bitcoin.network,
          txid,
          address,
          amountSats: Math.round(amountSats)
        };
      });

      this.http._registerMethod('ConfirmInventoryHtlcPayment', async (...params) => {
        const body = params[0] || {};
        return this._confirmInventoryHtlcPayment(body);
      });

      this.http._registerMethod('GetInventoryHtlcSellerReveal', (...params) => {
        const body = params[0] || {};
        return this._getInventoryHtlcSellerReveal(body);
      });

      this.http._registerMethod('ClaimInventoryHtlcOnChain', async (...params) => {
        const body = params[0] || {};
        return this._claimInventoryHtlcOnChain(body);
      });

      this.http._registerMethod('BuildDocumentOfferEscrow', (...params) => {
        const body = params[0] || {};
        return this._buildDocumentOfferEscrow(body);
      });

      this.http._registerMethod('VerifyDocumentOfferFunding', async (...params) => {
        const body = params[0] || {};
        return this._rpcVerifyDocumentOfferFunding(body);
      });

      this.http._registerMethod('PrepareDocumentOfferDelivererClaimPsbt', async (...params) => {
        const body = params[0] || {};
        return this._rpcPrepareDocumentOfferDelivererClaimPsbt(body);
      });

      this.http._registerMethod('PrepareDocumentOfferInitiatorRefundPsbt', async (...params) => {
        const body = params[0] || {};
        return this._rpcPrepareDocumentOfferInitiatorRefundPsbt(body);
      });

      this.http._registerMethod('BroadcastSignedTransaction', async (...params) => {
        const body = params[0] || {};
        return this._rpcBroadcastSignedTransaction(body);
      });

      this.http._registerMethod('GetPayjoinStatus', async () => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        return payjoin.getCapabilities();
      });

      this.http._registerMethod('GetPeeringStatus', async () => {
        const peering = this._getPeeringService();
        if (!peering) return { status: 'error', message: 'Peering service unavailable' };
        return peering.getCapabilities();
      });

      this.http._registerMethod('GetPeeringAttestation', async () => {
        const peering = this._getPeeringService();
        if (!peering) return { status: 'error', message: 'Peering service unavailable' };
        try {
          return peering.buildOracleAttestation();
        } catch (e) {
          return { status: 'error', message: e && e.message ? e.message : String(e) };
        }
      });

      this.http._registerMethod('GetChallengeStatus', async () => {
        const ch = this._getChallengeService();
        if (!ch) return { status: 'error', message: 'Challenge service unavailable' };
        return ch.getCapabilities();
      });

      hubCollaboration.registerRpc(this);

      this.http._registerMethod('CreatePayjoinDeposit', async (...params) => {
        const payjoin = this._getPayjoinService();
        const bitcoin = this._getBitcoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const walletId = String(body.walletId || (bitcoin && bitcoin.walletName) || '').trim();
        const receiveTemplate = String(body.receiveTemplate || '').trim();
        const federationXOnlyHex = String(body.federationXOnlyHex || '').trim();
        let address = String(body.address || '').trim();
        if (!receiveTemplate) {
          address = address || (bitcoin ? await bitcoin.getUnusedAddress() : '');
        }
        if (!receiveTemplate && !address) return { status: 'error', message: 'address is required' };
        return payjoin.createDepositSession({
          walletId,
          amountSats: Number(body.amountSats || 0),
          label: String(body.label || body.memo || ''),
          memo: String(body.memo || ''),
          expiresInSeconds: Number(body.expiresInSeconds || 0) || undefined,
          address,
          receiveTemplate,
          federationXOnlyHex: federationXOnlyHex || undefined
        });
      });

      this.http._registerMethod('ListPayjoinSessions', (...params) => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const limit = Math.max(1, Math.min(200, Number(body.limit || 25)));
        const includeExpired = body.includeExpired !== false;
        return payjoin.listSessions({ limit, includeExpired }).map((session) => payjoin.getSession(session.id, {
          includeProposals: true,
          proposalSummariesOnly: true
        }));
      });

      this.http._registerMethod('GetPayjoinSession', (...params) => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const sessionId = String(body.sessionId || body.id || body || '').trim();
        if (!sessionId) return { status: 'error', message: 'sessionId is required' };
        const session = payjoin.getSession(sessionId, { includeProposals: true });
        if (!session) return { status: 'error', message: 'Payjoin session not found' };
        return session;
      });

      this.http._registerMethod('SubmitPayjoinProposal', async (...params) => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const sessionId = String(body.sessionId || body.id || '').trim();
        if (!sessionId) return { status: 'error', message: 'sessionId is required' };
        const result = await payjoin.submitProposal(sessionId, {
          psbt: body.psbt,
          txhex: body.txhex
        });
        try {
          const prop = result && result.proposal;
          const tid = prop && payjoin.extractProposalTxid(prop);
          if (tid) {
            this._mergePersistedTxLabel(tid, 'payjoin', { sessionId, proposalId: prop.id });
          }
        } catch (_) {}
        return result;
      });

      // Relay a CONTRACT_PROPOSAL (batched messages + Merkle + JSON Patch + optional PSBT). Params: ({ payload, verify?, txid? })
      this.http._registerMethod('SubmitContractProposal', async (...params) => {
        const body = params[0] || {};
        let payload = body.payload;
        if (!payload && body.payloadJson) {
          try { payload = JSON.parse(String(body.payloadJson)); } catch (_) { payload = null; }
        }
        if (!payload || typeof payload !== 'object') {
          return { status: 'error', message: 'payload (object) or payloadJson (string) is required' };
        }
        const verify = body.verify !== false;
        if (verify) {
          const v = contractProposalExchange.verifyContractProposalPayload(payload);
          if (!v.ok) return { status: 'error', message: v.error || 'ContractProposal verification failed' };
        }
        const json = JSON.stringify(payload);
        try {
          const msg = Message.fromVector(['ContractProposal', json]);
          if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') this.http.broadcast(msg);
          const p2pMsg = Message.fromVector(['ContractProposal', json]).signWithKey(this.agent.key);
          this.agent.relayFrom('_client', p2pMsg);
        } catch (err) {
          console.error('[HUB] SubmitContractProposal relay error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'relay failed' };
        }
        let txid = body.txid ? String(body.txid).trim() : '';
        if (!txid && payload.psbt && payload.psbt.proposalBase64) {
          try {
            txid = psbtFabric.extractTransactionId(payload.psbt.proposalBase64);
          } catch (_) {}
        }
        if (txid && /^[a-fA-F0-9]{64}$/.test(txid)) {
          try {
            this._mergePersistedTxLabel(txid, 'contract_proposal', {
              contractId: payload.contractId || undefined
            });
          } catch (_) {}
        }
        return { status: 'success', type: 'SubmitContractProposalResult', txid: txid || undefined };
      });

      this.http._registerMethod('AddPeer', (...params) => {
        const peer = params[0];
        try {
          const normalized = this._connectPeer(peer);
          console.debug('[HUB] AddPeer:', normalized);
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] AddPeer error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'connect failed' };
        }
      });

      this.http._registerMethod('RemovePeer', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        if (!idOrAddress) return { status: 'error', message: 'id or address required' };
        const ok = this._disconnectPeer(idOrAddress);
        return ok ? { status: 'success' } : { status: 'error', message: 'peer not connected' };
      });

      // Fabric P2P: send ChainSyncRequest so a compatible peer pushes inventory + replays BitcoinBlock log.
      this.http._registerMethod('RequestFabricPeerResync', (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const input = req.address || req.id || params[0];
        if (!input) return { status: 'error', message: 'id or address required' };
        const address = this._resolvePeerAddress(input);
        if (!address || !this.agent.connections[address]) {
          return { status: 'error', message: 'peer not connected' };
        }
        const myId = this.agent.identity && this.agent.identity.id ? String(this.agent.identity.id) : '';
        const body = JSON.stringify({
          v: 1,
          reason: 'hub-request-fabric-resync',
          requester: myId,
          at: new Date().toISOString()
        });
        try {
          this._sendVectorToPeer(address, ['ChainSyncRequest', body]);
          return { status: 'success', address };
        } catch (err) {
          console.error('[HUB] RequestFabricPeerResync error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'send failed' };
        }
      });

      // Federation / playnet: sign and send P2P_FLUSH_CHAIN to peers above registry score threshold.
      // Params: { snapshotBlockHash, network?, label?, adminToken|token }
      this.http._registerMethod('SendFlushChainToTrustedPeers', (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { status: 'error', message: 'adminToken required' };
        }
        const snapshotBlockHash = String(req.snapshotBlockHash || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(snapshotBlockHash)) {
          return { status: 'error', message: 'snapshotBlockHash must be 64 hex characters' };
        }
        const agent = this.agent;
        if (!agent || typeof agent.sendFlushChainToTrustedPeers !== 'function') {
          return { status: 'error', message: 'FlushChain not available on this hub Peer (upgrade @fabric/core)' };
        }
        const body = { snapshotBlockHash };
        const net = req.network != null ? String(req.network).trim() : '';
        const label = req.label != null ? String(req.label).trim() : '';
        if (net) body.network = net;
        if (label) body.label = label;
        try {
          const peersNotified = agent.sendFlushChainToTrustedPeers(body);
          console.debug('[HUB] SendFlushChainToTrustedPeers:', { peersNotified, snapshotBlockHash, network: body.network });
          return {
            status: 'success',
            type: 'SendFlushChainToTrustedPeersResult',
            peersNotified,
            snapshotBlockHash,
            network: body.network || null,
            label: body.label || null
          };
        } catch (err) {
          console.error('[HUB] SendFlushChainToTrustedPeers error:', err);
          return { status: 'error', message: err && err.message ? err.message : String(err) };
        }
      });

      this.http._registerMethod('SendPeerMessage', (...params) => {
        const raw = params[0];
        const idOrAddress = raw && (raw.address || raw.id || raw);
        const body = params[1] || raw;
        const text = typeof body === 'string' ? body : (body && (body.text || body.content)) || '';
        if (!idOrAddress || !text) return { status: 'error', message: 'id/address and message text required' };

        // Logical target used for ActivityStreams-style metadata (id or address as provided by caller)
        const targetValue = (typeof idOrAddress === 'object' && idOrAddress)
          ? (idOrAddress.id || idOrAddress.address || String(idOrAddress))
          : String(idOrAddress);

        // Resolved network address used for the actual wire connection
        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };
        try {
          const clientId = body && body.clientId ? String(body.clientId) : null;
          const actorId = (body && body.actor && body.actor.id)
            ? String(body.actor.id)
            : this.agent.identity.id;
          const chatPayload = {
            type: 'P2P_CHAT_MESSAGE',
            actor: { id: actorId },
            object: { content: text, created: Date.now() },
            // ActivityStreams-style: top-level target identifies the logical recipient (id or address),
            // independent of how we resolve the network connection.
            target: targetValue
          };

          if (clientId) chatPayload.object.clientId = clientId;

          const vector = ['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)];
          this._sendVectorToPeer(address, vector);

          // Locally echo the chat message so this hub's UI clients
          // also see messages it sends to peers.
          try {
            this.agent.emit('chat', chatPayload);
          } catch (echoErr) {
            console.warn('[HUB] Failed to locally echo peer chat message:', echoErr);
          }

          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] SendPeerMessage error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'send failed' };
        }
      });

      // Request a peer's inventory (e.g., list of documents) using INVENTORY_REQUEST.
      // Params: (idOrAddress, kind = 'documents', options?)
      // options: { buyerRefundPublicKey?, htlcLocktimeBlocks?, htlcAmountSats?, inventoryTarget?, inventoryRelayTtl? }
      // — `inventoryTarget` = Fabric id of the seller when `idOrAddress` is a relay (next hop) only.
      // — `inventoryRelayTtl` caps hops (default 6, max 16); each relay decrements.
      this.http._registerMethod('RequestPeerInventory', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        let kind = 'documents';
        let options = {};
        if (typeof params[1] === 'string') {
          kind = params[1] || 'documents';
          options = (params[2] && typeof params[2] === 'object') ? params[2] : {};
        } else if (params[1] && typeof params[1] === 'object') {
          options = params[1];
        }
        if (!idOrAddress) return { status: 'error', message: 'id/address required' };

        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };

        try {
          const hopTarget = (typeof idOrAddress === 'object' && idOrAddress)
            ? (idOrAddress.id || idOrAddress.address || String(idOrAddress))
            : String(idOrAddress);
          const inventoryTarget = options.inventoryTarget != null && String(options.inventoryTarget).trim()
            ? String(options.inventoryTarget).trim()
            : '';
          const payloadTarget = inventoryTarget || hopTarget;
          let relayTtl = 6;
          const optTtl = Number(options.inventoryRelayTtl);
          if (Number.isFinite(optTtl) && optTtl > 0) relayTtl = Math.min(16, Math.round(optTtl));

          const payload = {
            type: 'INVENTORY_REQUEST',
            actor: { id: this.agent.identity.id },
            object: {
              kind: kind || 'documents',
              created: Date.now(),
              inventoryRelayTtl: relayTtl,
              ...(options.buyerRefundPublicKey
                ? { buyerRefundPublicKey: String(options.buyerRefundPublicKey).trim() }
                : {}),
              ...(Number(options.htlcLocktimeBlocks) > 0
                ? { htlcLocktimeBlocks: Math.min(10000, Math.round(Number(options.htlcLocktimeBlocks))) }
                : {}),
              ...(Number(options.htlcAmountSats) > 0
                ? { htlcAmountSats: Math.round(Number(options.htlcAmountSats)) }
                : {})
            },
            target: payloadTarget
          };

          this._sendGenericFabricEnvelopeToPeer(address, payload);

          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] RequestPeerInventory error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'request failed' };
        }
      });

      // Send a file to a peer via P2P_FILE_SEND. Params: (idOrAddress, document)
      // document: { id, name, mime, size, contentBase64 } or { id } (hub fetches content)
      this.http._registerMethod('SendPeerFile', async (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        const docParam = params[1] || params[0];
        if (!idOrAddress) return { status: 'error', message: 'peer id/address required' };
        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };

        let doc = docParam && typeof docParam === 'object' ? docParam : null;
        const docId = doc && (doc.id || docParam);
        if (!docId) return { status: 'error', message: 'document id required' };

        try {
          if (!doc.contentBase64 && docId) {
            const raw = this.fs.readFile(`documents/${docId}.json`);
            if (!raw) return { status: 'error', message: 'document not found' };
            doc = JSON.parse(raw);
          }
          const sendRes = await this._sendDocumentToPeerAddress(address, doc);
          if (!sendRes || sendRes.status !== 'success') {
            return { status: 'error', message: (sendRes && sendRes.message) || 'send failed' };
          }
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] SendPeerFile error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'send failed' };
        }
      });

      // Submit a chat message for broadcast to all connected clients AND all Fabric nodes.
      // Params: (body: { text: string, clientId?: string, actor?: { id } })
      this.http._registerMethod('SubmitChatMessage', (...params) => {
        const body = params[0] || params;
        const text = typeof body === 'string' ? body : (body && (body.text || body.content)) || '';
        if (!text) return { status: 'error', message: 'message text required' };
        const clientId = body && body.clientId ? String(body.clientId) : null;
        const actorId = (body && body.actor && body.actor.id) ? body.actor.id : this.agent.identity.id;
        const created = Date.now();
        const chatPayload = {
          type: 'P2P_CHAT_MESSAGE',
          actor: { id: actorId },
          object: { content: text, created }
        };
        if (clientId) chatPayload.object.clientId = clientId;
        try {
          this._cacheChatMessage(chatPayload);
          const relay = Message.fromVector(['ChatMessage', JSON.stringify(chatPayload)]);
          if (this._rootKey && this._rootKey.private) relay.signWithKey(this._rootKey);
          // Broadcast to all WebSocket clients
          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(relay);
          }
          // Relay to all Fabric P2P peers (origin '_client' so we don't skip any connection)
          const p2pMsg = Message.fromVector(['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)]).signWithKey(this.agent.key);
          this.agent.relayFrom('_client', p2pMsg);
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] SubmitChatMessage error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'submit failed' };
        }
      });

      // Purge activity row and/or unpublish a document (Fabric `Tombstone` message + STATE commit).
      // Params: { messageId?: string, documentId?: string, adminToken|token } — at least one of messageId, documentId.
      this.http._registerMethod('EmitTombstone', async (...params) => {
        const body = params[0] || params;
        const messageId = body && typeof body.messageId === 'string' ? body.messageId.trim() : '';
        const documentId = body && body.documentId
          ? this._normalizeDocumentId(String(body.documentId).trim())
          : '';
        const rpcToken = body && (body.adminToken || body.token);
        if (!messageId && !documentId) return { status: 'error', message: 'messageId or documentId required' };
        if (!this.setup.verifyAdminToken(rpcToken)) {
          return { status: 'error', message: 'Admin token required to purge activity entries or unpublish.' };
        }
        return await this.recordTombstone({ messageId, documentId });
      });

      this._refreshChainState('startup-resource-sync');

      // Create a document from a locally-processed upload (content is sent from client).
      // Params: (doc: { name, mime, size, sha256, contentBase64 })
      this.http._registerMethod('CreateDocument', async (...params) => {
        const doc = params[0];
        if (!doc || typeof doc !== 'object') return { status: 'error', message: 'document payload required' };

        const name = doc.name ? String(doc.name) : 'upload';
        const mime = doc.mime ? String(doc.mime) : 'application/octet-stream';
        const size = doc.size != null ? Number(doc.size) : null;
        const contentBase64 = doc.contentBase64 ? String(doc.contentBase64) : '';
        if (!contentBase64) return { status: 'error', message: 'contentBase64 required' };

        const buffer = Buffer.from(contentBase64, 'base64');
        const sizeErr = this._validateDocumentSize(buffer);
        if (sizeErr) return sizeErr;
        const sha256 = doc.sha256 ? String(doc.sha256) : crypto.createHash('sha256').update(buffer).digest('hex');
        const id = sha256;
        const now = new Date().toISOString();

        const meta = {
          id,
          sha256,
          name,
          mime,
          size: size != null && !Number.isNaN(size) ? size : buffer.length,
          created: now,
          lineage: id,
          parent: null,
          revision: 1,
          edited: now
        };

        try {
          // Persist the document (metadata + base64) under the hub's filesystem store
          await this.fs.publish(`documents/${id}.json`, {
            ...meta,
            contentBase64
          });
        } catch (err) {
          // Persistence failures should not prevent the RPC from succeeding
          // in test/dev scenarios, but we log them for diagnosis.
          console.error('[HUB] CreateDocument persistence error (continuing with in-memory doc):', err);
        }

        // Keep a lightweight index in memory/state (no content)
        this._state.documents = this._state.documents || {};
        this._state.documents[id] = meta;
        // Local creation is not a major global state update; message log
        // updates occur when resource collections (public state) are changed.
        this._refreshChainState('create-document');

        // Push network status so document lists update
        if (typeof pushNetworkStatus === 'function') pushNetworkStatus();

        // Record activity for local document creation.
        this.recordActivity({
          type: 'Create',
          object: {
            type: 'Document',
            id,
            name,
            mime,
            size: meta.size,
            sha256
          }
        });

        return { type: 'CreateDocumentResult', document: meta };
      });

      // List documents (metadata only)
      this.http._registerMethod('ListDocuments', async (...params) => {
        try {
          const docs = this._state.documents || {};
          const collections = (this._state.content && this._state.content.collections && this._state.content.collections.documents) || {};
          const contracts = (this._state.content && this._state.content.collections && this._state.content.collections.contracts) || {};

          // Build quick index from backing document id (sha256 key) -> storageContractId (first match)
          const contractIndex = {};
          for (const [cid, c] of Object.entries(contracts)) {
            if (!c || !c.document) continue;
            if (!contractIndex[c.document]) {
              contractIndex[c.document] = cid;
            }
          }

          const unionIds = new Set(Object.keys(docs));
          for (const id of Object.keys(collections)) {
            const row = collections[id];
            if (row && row.published) unionIds.add(id);
          }

          const list = [...unionIds].map((id) => {
            const publishedMeta = collections[id];
            const meta = docs[id] || (publishedMeta
              ? {
                id: publishedMeta.id || id,
                sha256: publishedMeta.sha256 || id,
                name: publishedMeta.name,
                mime: publishedMeta.mime || 'application/octet-stream',
                size: publishedMeta.size != null ? publishedMeta.size : 0,
                created: publishedMeta.created,
                lineage: publishedMeta.lineage || publishedMeta.id || id,
                parent: publishedMeta.parent != null ? publishedMeta.parent : null,
                revision: publishedMeta.revision != null ? publishedMeta.revision : 1,
                edited: publishedMeta.edited || publishedMeta.created
              }
              : null);
            if (!meta || !meta.id) return null;
            const backingId = meta.sha256 || meta.id;
            const storageContractId = contractIndex[backingId];
            return Object.assign(
              {},
              meta,
              publishedMeta && publishedMeta.published ? { published: publishedMeta.published, purchasePriceSats: publishedMeta.purchasePriceSats } : null,
              storageContractId ? { storageContractId } : null
            );
          }).filter(Boolean).sort((a, b) => {
            const ta = a && a.created ? new Date(a.created).getTime() : 0;
            const tb = b && b.created ? new Date(b.created).getTime() : 0;
            return tb - ta;
          });

          const bitcoin = this._getBitcoinService();
          let txChainByTxid = {};
          if (bitcoin) {
            const fundTxids = [];
            for (const row of list) {
              if (!row || !row.storageContractId) continue;
              const c = contracts[row.storageContractId];
              if (c && c.txid) fundTxids.push(String(c.txid).trim());
            }
            txChainByTxid = await this._l1TxChainStatusBatch(bitcoin, fundTxids);
          }

          const listWithStorageL1 = list.map((row) => {
            if (!row || !row.storageContractId) return row;
            const c = contracts[row.storageContractId];
            const txid = c && c.txid ? String(c.txid).trim() : '';
            const st = txid ? txChainByTxid[txid] : null;
            if (!st) return row;
            return { ...row, storageL1Status: st };
          });

          return { type: 'ListDocumentsResult', documents: listWithStorageL1 };
        } catch (err) {
          console.error('[HUB] ListDocuments error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'list failed' };
        }
      });

      // Get a document (metadata + base64 content)
      this.http._registerMethod('GetDocument', async (...params) => {
        const id = this._normalizeDocumentId(params[0] && (params[0].id || params[0]));
        if (!id) {
          return { type: 'GetDocumentResult', document: null, documentId: null, message: 'id required' };
        }
        try {
          const raw = this.fs.readFile(`documents/${id}.json`);
          if (!raw) {
            return { type: 'GetDocumentResult', document: null, documentId: id, message: 'document not found' };
          }
          const parsed = JSON.parse(raw);

          // Decorate with published + storageContractId from hub state, if present
          const collections = (this._state.content && this._state.content.collections && this._state.content.collections.documents) || {};
          const publishedMeta = collections[id];
          if (publishedMeta && publishedMeta.published && !parsed.published) {
            parsed.published = publishedMeta.published;
          }
          if (publishedMeta && publishedMeta.purchasePriceSats != null) {
            parsed.purchasePriceSats = publishedMeta.purchasePriceSats;
          }

          const contracts = (this._state.content && this._state.content.collections && this._state.content.collections.contracts) || {};
          for (const [cid, c] of Object.entries(contracts)) {
            if (c && c.document === id) {
              parsed.storageContractId = cid;
              break;
            }
          }

          return { type: 'GetDocumentResult', document: parsed };
        } catch (err) {
          console.error('[HUB] GetDocument error:', err);
          return {
            type: 'GetDocumentResult',
            document: null,
            documentId: id,
            message: err && err.message ? err.message : 'get failed'
          };
        }
      });

      // Create a pay-to-distribute invoice: returns address + amount for L1 payment.
      // Params: ({ documentId, amountSats, durationYears?, challengeCadence?, responseDeadline? })
      this.http._registerMethod('CreateDistributeInvoice', async (...params) => {
        const config = params[0] || {};
        const documentId = this._normalizeDocumentId(config.documentId || config.id);
        if (!documentId) return { status: 'error', message: 'documentId required', documentId: null };

        const bitcoin = this._getBitcoinService();
        if (!bitcoin) {
          return { status: 'error', message: 'Bitcoin service unavailable for pay-to-distribute', documentId };
        }

        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found', documentId };

        const amountSats = Number(config.amountSats || 0);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'positive amountSats required', documentId };
        }

        const address = await bitcoin.getUnusedAddress();
        const now = new Date().toISOString();
        const distributeConfig = {
          amountSats,
          desiredCopies: Math.max(1, Number(config.desiredCopies || 1)),
          durationYears: Number(config.durationYears || 4),
          challengeCadence: config.challengeCadence || 'daily',
          responseDeadline: config.responseDeadline || '10s',
          actorId: config.actorId || null
        };

        this._distributeRequests[documentId] = { address, amountSats, config: distributeConfig, createdAt: now };

        return {
          type: 'CreateDistributeInvoiceResult',
          documentId,
          address,
          amountSats,
          config: distributeConfig,
          network: bitcoin.network || 'regtest',
          expiresAt: now
        };
      });

      // Send a distribute proposal to a peer (offer to pay them to host a file).
      // Params: (idOrAddress, { documentId, amountSats, config?, document?, documentName? })
      this.http._registerMethod('SendDistributeProposal', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        const body = params[1] || params[0];
        const proposal = typeof body === 'object' ? body : {};
        const documentId = this._normalizeDocumentId(proposal.documentId || proposal.document?.id);
        const amountSats = Number(proposal.amountSats || 0);
        if (!idOrAddress) {
          return { type: 'SendDistributeProposalResult', status: 'error', message: 'peer id/address required' };
        }
        if (!documentId || !Number.isFinite(amountSats) || amountSats <= 0) {
          return {
            type: 'SendDistributeProposalResult',
            status: 'error',
            message: 'documentId and positive amountSats required',
            ...(documentId ? { documentId } : {})
          };
        }
        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) {
          return {
            type: 'SendDistributeProposalResult',
            status: 'error',
            message: 'peer not connected',
            documentId
          };
        }
        try {
          const targetValue = (typeof idOrAddress === 'object' && idOrAddress)
            ? (idOrAddress.id || idOrAddress.address || String(idOrAddress))
            : String(idOrAddress);
          const payload = {
            type: 'DistributeProposal',
            documentId,
            amountSats,
            config: proposal.config || {},
            document: proposal.document || null,
            documentName: proposal.documentName || (proposal.document && proposal.document.name) || documentId
          };
          const text = JSON.stringify(payload);
          const chatPayload = {
            type: 'P2P_CHAT_MESSAGE',
            actor: { id: this.agent.identity.id },
            object: { content: text, created: Date.now() },
            target: targetValue
          };
          const vector = ['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)];
          this._sendVectorToPeer(address, vector);
          return {
            type: 'SendDistributeProposalResult',
            status: 'success',
            proposalId: `proposal:${Date.now()}:${this.agent.identity.id}`,
            documentId
          };
        } catch (err) {
          console.error('[HUB] SendDistributeProposal error:', err);
          return {
            type: 'SendDistributeProposalResult',
            status: 'error',
            message: err && err.message ? err.message : 'send failed',
            documentId
          };
        }
      });

      // Accept a distribute proposal: create invoice and send acceptance to proposer.
      // Params: ({ proposalId, documentId, amountSats, config, senderAddress })
      this.http._registerMethod('AcceptDistributeProposal', async (...params) => {
        const proposal = params[0] || {};
        const documentId = this._normalizeDocumentId(proposal.documentId);
        const amountSats = Number(proposal.amountSats || 0);
        const senderAddress = proposal.senderAddress || proposal.sender;
        if (!documentId || !Number.isFinite(amountSats) || amountSats <= 0) {
          const echoId = documentId || (proposal && proposal.documentId ? String(proposal.documentId) : '');
          return {
            status: 'error',
            message: 'documentId and positive amountSats required',
            ...(echoId ? { documentId: echoId } : {})
          };
        }
        if (!senderAddress) {
          return { status: 'error', message: 'senderAddress required to send acceptance', documentId };
        }
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) return { status: 'error', message: 'Bitcoin service unavailable', documentId };
        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found', documentId };
        try {
          const address = await bitcoin.getUnusedAddress();
          const now = new Date().toISOString();
          const distributeConfig = {
            amountSats,
            desiredCopies: Math.max(1, Number((proposal.config && proposal.config.desiredCopies) || 1)),
            durationYears: Number((proposal.config && proposal.config.durationYears) || 4),
            challengeCadence: (proposal.config && proposal.config.challengeCadence) || 'daily',
            responseDeadline: (proposal.config && proposal.config.responseDeadline) || '10s',
            actorId: (proposal.config && proposal.config.actorId) || null
          };
          this._distributeRequests[documentId] = { address, amountSats, config: distributeConfig, createdAt: now };
          const acceptancePayload = {
            type: 'DistributeProposalAccepted',
            documentId,
            address,
            amountSats,
            config: distributeConfig,
            network: bitcoin.network || 'regtest'
          };
          const text = JSON.stringify(acceptancePayload);
          const resolved = this._resolvePeerAddress(senderAddress);
          if (resolved && this.agent.connections[resolved]) {
            const chatPayload = {
              type: 'P2P_CHAT_MESSAGE',
              actor: { id: this.agent.identity.id },
              object: { content: text, created: Date.now() },
              target: senderAddress
            };
            const vector = ['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)];
            this._sendVectorToPeer(resolved, vector);
          }
          return {
            type: 'AcceptDistributeProposalResult',
            documentId,
            address,
            amountSats,
            config: distributeConfig,
            network: bitcoin.network || 'regtest',
            sentToProposer: !!(resolved && this.agent.connections[resolved])
          };
        } catch (err) {
          console.error('[HUB] AcceptDistributeProposal error:', err);
          return {
            status: 'error',
            message: err && err.message ? err.message : 'accept failed',
            documentId
          };
        }
      });

      // Publish a document ID into the global store (hub node state.collections.documents)
      // Params: (id: string | { id: string, purchasePriceSats?: number })
      this.http._registerMethod('PublishDocument', async (...params) => {
        const arg = params[0];
        const id = this._normalizeDocumentId(arg && (arg.id || arg));
        const purchasePriceSats = arg && typeof arg === 'object' && Number.isFinite(Number(arg.purchasePriceSats))
          ? Math.max(0, Number(arg.purchasePriceSats))
          : 0;
        if (!id) return { status: 'error', message: 'id required' };
        try {
          // Ensure the document exists locally
          const raw = this.fs.readFile(`documents/${id}.json`);
          if (!raw) return { status: 'error', message: 'document not found', documentId: id };
          const parsed = JSON.parse(raw);

          // Global store lives in this Service's state (this._state.content)
          this._state.content.collections = this._state.content.collections || {};
          this._state.content.collections.documents = this._state.content.collections.documents || {};
          this._state.content.counts = this._state.content.counts || {};

          const exists = !!this._state.content.collections.documents[id];
          const now = new Date().toISOString();
          this._state.content.collections.documents[id] = {
            id,
            document: id,
            name: parsed.name,
            mime: parsed.mime,
            size: parsed.size,
            sha256: parsed.sha256 || id,
            created: parsed.created || now,
            lineage: parsed.lineage || parsed.id || id,
            parent: parsed.parent || null,
            revision: parsed.revision || 1,
            edited: parsed.edited || parsed.created || now,
            published: now,
            ...(purchasePriceSats > 0 ? { purchasePriceSats } : {})
          };
          if (!exists) {
            this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
          }

          // Persist global state
          await this._appendFabricMessage('PublishDocument', {
            id,
            name: parsed.name,
            mime: parsed.mime
          });
          this._refreshChainState('publish-document');
          this.commit();

          // Update UI clients
          if (typeof pushNetworkStatus === 'function') pushNetworkStatus();

          // Record a public "Publish" activity reflecting the new global state.
          this.recordActivity({
            type: 'Add',
            object: {
              type: 'Document',
              id,
              name: parsed.name,
              mime: parsed.mime,
              size: parsed.size,
              sha256: parsed.sha256 || id,
              published: now
            },
            target: {
              type: 'Collection',
              name: 'documents'
            }
          });

          return { type: 'PublishDocumentResult', document: this._state.content.collections.documents[id] };
        } catch (err) {
          console.error('[HUB] PublishDocument error:', err);
          return {
            status: 'error',
            message: err && err.message ? err.message : 'publish failed',
            documentId: id
          };
        }
      });

      // Create an HTLC purchase invoice for a published document. Returns address + amount.
      // Params: ({ documentId, amountSats? }) — amountSats defaults to document's purchasePriceSats
      this.http._registerMethod('CreatePurchaseInvoice', async (...params) => {
        const config = params[0] || {};
        const documentId = this._normalizeDocumentId(config.documentId || config.id);
        if (!documentId) return { status: 'error', message: 'documentId required', documentId: null };

        const bitcoin = this._getBitcoinService();
        if (!bitcoin) {
          return { status: 'error', message: 'Bitcoin service unavailable for document purchase', documentId };
        }

        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found', documentId };

        const parsed = JSON.parse(raw);
        const collections = this._state.content && this._state.content.collections && this._state.content.collections.documents;
        const publishedMeta = collections && collections[documentId];
        if (!publishedMeta || !publishedMeta.published) {
          return { status: 'error', message: 'document is not published', documentId };
        }

        const contentBase64 = parsed.contentBase64;
        if (!contentBase64) return { status: 'error', message: 'document content not available', documentId };
        const contentBuffer = Buffer.from(contentBase64, 'base64');
        const contentSize = contentBuffer.length;
        const costPerByteSats = Math.max(0, Number(this.setup.getSetting('COST_PER_BYTE_SATS') || 0.01));
        const floorSats = costPerByteSats > 0 ? Math.ceil(contentSize * costPerByteSats) : 0;
        const docPrice = Number(publishedMeta.purchasePriceSats || 0);
        const amountSats = Math.max(Number(config.amountSats || 0) || docPrice, floorSats);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return {
            status: 'error',
            message: 'document has no purchase price. Set purchasePriceSats when publishing or configure COST_PER_BYTE_SATS.',
            documentId
          };
        }

        let contentHash;
        try {
          contentHash = publishedDocumentEnvelope.purchaseContentHashHex(documentId, parsed);
        } catch (e) {
          return {
            status: 'error',
            message: e && e.message ? e.message : 'document publish envelope hash failed',
            documentId
          };
        }

        const address = await bitcoin.getUnusedAddress();
        const now = new Date().toISOString();
        this._purchaseRequests[documentId] = { address, amountSats, contentHash, createdAt: now };

        return {
          type: 'CreatePurchaseInvoiceResult',
          documentId,
          address,
          amountSats,
          contentHash,
          network: bitcoin.network || 'regtest',
          expiresAt: now
        };
      });

      // Claim an HTLC purchase: verify payment, verify publish-envelope hash (see publishedDocumentEnvelope.js), return document.
      // Params: ({ documentId, txid })
      this.http._registerMethod('ClaimPurchase', async (...params) => {
        const config = params[0] || {};
        const documentId = this._normalizeDocumentId(config.documentId || config.id);
        const txid = config.txid ? String(config.txid).trim() : null;
        if (!documentId) return { status: 'error', message: 'documentId required', documentId: null };
        if (!txid) return { status: 'error', message: 'txid required (proof of payment)', documentId };

        const bitcoin = this._getBitcoinService();
        const pending = this._purchaseRequests[documentId];
        if (!bitcoin || !pending) {
          return { status: 'error', message: 'Purchase invoice required. Call CreatePurchaseInvoice first, pay, then pass txid.', documentId };
        }

        const verified = await this._verifyL1Payment(bitcoin, txid, pending.address, pending.amountSats);
        if (!verified) {
          return { status: 'error', message: 'Payment verification failed. Ensure the transaction pays to the invoice address with at least the required amount.', documentId };
        }

        try {
          this._mergePersistedTxLabel(txid, 'document_purchase', { documentId });
        } catch (_) {}

        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found', documentId };
        const parsed = JSON.parse(raw);
        const contentBase64 = parsed.contentBase64;
        if (!contentBase64) return { status: 'error', message: 'document content not available', documentId };

        let contentHash;
        try {
          contentHash = publishedDocumentEnvelope.purchaseContentHashHex(documentId, parsed);
        } catch (e) {
          return { status: 'error', message: 'Document publish envelope hash failed.', documentId };
        }
        if (contentHash !== pending.contentHash) {
          return { status: 'error', message: 'Content hash mismatch. HTLC unlock failed.', documentId };
        }

        delete this._purchaseRequests[documentId];

        return {
          type: 'ClaimPurchaseResult',
          documentId,
          document: {
            id: parsed.id,
            name: parsed.name,
            mime: parsed.mime,
            size: parsed.size,
            sha256: parsed.sha256,
            contentBase64,
            contentHash
          }
        };
      });

      // Set purchase price for a published document. Admin or document owner.
      this.http._registerMethod('SetDocumentPrice', async (...params) => {
        const config = params[0] || {};
        const documentId = this._normalizeDocumentId(config.documentId || config.id);
        const purchasePriceSats = Math.max(0, Number(config.purchasePriceSats || config.amountSats || 0));
        if (!documentId) return { status: 'error', message: 'documentId required' };

        this._ensureResourceCollections();
        const collections = this._state.content.collections.documents;
        const entry = collections && collections[documentId];
        if (!entry || !entry.published) {
          return { status: 'error', message: 'document not found or not published' };
        }

        entry.purchasePriceSats = purchasePriceSats > 0 ? purchasePriceSats : undefined;
        if (purchasePriceSats <= 0) delete entry.purchasePriceSats;
        this._refreshChainState('set-document-price');
        if (typeof pushNetworkStatus === 'function') pushNetworkStatus();
        return { type: 'SetDocumentPriceResult', documentId, purchasePriceSats: entry.purchasePriceSats };
      });

      // Edit an existing document and create a new revision.
      // Params: ({ id, contentBase64|content, mime?, name?, publish? })
      this.http._registerMethod('EditDocument', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const sourceId = this._normalizeDocumentId(req.id || params[0]);
        if (!sourceId) return { status: 'error', message: 'id required' };

        try {
          const sourceRaw = this.fs.readFile(`documents/${sourceId}.json`);
          if (!sourceRaw) return { status: 'error', message: 'document not found' };
          const source = JSON.parse(sourceRaw);

          const nextName = req.name ? String(req.name) : String(source.name || 'document');
          const nextMime = req.mime ? String(req.mime) : String(source.mime || 'application/octet-stream');

          let nextContentBase64 = source.contentBase64 || '';
          if (req.contentBase64 != null) {
            nextContentBase64 = String(req.contentBase64);
          } else if (req.content != null) {
            nextContentBase64 = Buffer.from(String(req.content), 'utf8').toString('base64');
          }

          if (!nextContentBase64) return { status: 'error', message: 'content required' };
          const buffer = Buffer.from(nextContentBase64, 'base64');
          const sizeErr = this._validateDocumentSize(buffer);
          if (sizeErr) return sizeErr;

          const now = new Date().toISOString();
          const nextId = crypto.createHash('sha256').update(buffer).digest('hex');
          const lineage = source.lineage || source.id || sourceId;
          const nextRevision = Number(source.revision || 1) + 1;

          const nextDocument = {
            id: nextId,
            sha256: nextId,
            name: nextName,
            mime: nextMime,
            size: buffer.length,
            created: now,
            edited: now,
            lineage,
            parent: source.id || sourceId,
            revision: nextRevision,
            contentBase64: nextContentBase64
          };

          await this.fs.publish(`documents/${nextId}.json`, nextDocument);

          this._state.documents = this._state.documents || {};
          this._state.documents[nextId] = {
            id: nextId,
            sha256: nextId,
            name: nextName,
            mime: nextMime,
            size: buffer.length,
            created: now,
            edited: now,
            lineage,
            parent: source.id || sourceId,
            revision: nextRevision
          };

          const shouldPublish = (req.publish !== false) || !!(this._state.content.collections.documents && this._state.content.collections.documents[sourceId]);
          if (shouldPublish) {
            this._ensureResourceCollections();
            this._state.content.counts = this._state.content.counts || {};
            const exists = !!this._state.content.collections.documents[nextId];
            this._state.content.collections.documents[nextId] = {
              id: nextId,
              document: nextId,
              name: nextName,
              mime: nextMime,
              size: buffer.length,
              sha256: nextId,
              created: now,
              edited: now,
              lineage,
              parent: source.id || sourceId,
              revision: nextRevision,
              published: now
            };
            if (!exists) {
              this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
            }
            await this._appendFabricMessage('EditDocument', {
              sourceId: source.id || sourceId,
              document: nextId,
              name: nextName,
              lineage,
              revision: nextRevision
            });
          }

          this._refreshChainState('edit-document');
          if (typeof pushNetworkStatus === 'function') pushNetworkStatus();

          return {
            type: 'EditDocumentResult',
            published: !!shouldPublish,
            document: this._state.documents[nextId]
          };
        } catch (err) {
          console.error('[HUB] EditDocument error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'edit failed' };
        }
      });

      // List all known revisions for a document lineage.
      // Params: ({ id } | id)
      this.http._registerMethod('ListDocumentRevisions', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const resolved = this._normalizeDocumentId(req.id || params[0]);
        if (!resolved) return { status: 'error', message: 'id required' };

        const docs = this._state.documents || {};
        const seed = docs[resolved] || null;
        const lineage = (seed && (seed.lineage || seed.id)) || resolved;
        const revisions = Object.values(docs)
          .filter((doc) => doc && (doc.lineage || doc.id) === lineage)
          .sort((a, b) => Number(a.revision || 0) - Number(b.revision || 0));

        return {
          type: 'ListDocumentRevisionsResult',
          lineage,
          revisions
        };
      });

      // Create a long-term storage contract for a document, funded with Bitcoin.
      // This is a skeletal implementation that records intent; actual contract
      // negotiation, proof-of-storage challenges, and payouts live in the
      // Bitcoin/escrow services.
      //
      // Params: (config: {
      //   documentId: string,
      //   amountSats: number,
      //   txid?: string,  // required when Bitcoin available: proof of L1 payment from CreateDistributeInvoice
      //   durationYears: number,
      //   challengeCadence: 'hourly'|'daily'|'weekly'|'monthly',
      //   responseDeadline: '1s'|'5s'|'10s'|'30s'|'60s'|'10m'|'60m'
      // })
      this.http._registerMethod('CreateStorageContract', async (...params) => {
        const config = params[0] || {};
        const documentId = config.documentId || config.id;
        const txid = config.txid ? String(config.txid).trim() : null;

        const fail = (message) => ({
          type: 'CreateStorageContractFailed',
          status: 'error',
          message,
          ...(documentId ? { documentId } : {})
        });

        if (!documentId) return fail('documentId required');

        const amountSats = Number(config.amountSats || 0);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return fail('positive amountSats required');
        }

        const bitcoin = this._getBitcoinService();
        const pending = this._distributeRequests[documentId];
        let verifiedInvoiceMeta = null;

        if (bitcoin && pending) {
          if (!txid) return fail('Payment required. Call CreateDistributeInvoice first, pay to the returned address, then pass txid to CreateStorageContract.');
          const verified = await this._verifyL1Payment(bitcoin, txid, pending.address, pending.amountSats);
          if (!verified) return fail('Payment verification failed. Ensure the transaction pays to the invoice address with at least the required amount.');
          verifiedInvoiceMeta = {
            invoiceAddress: pending.address,
            invoiceAmountSats: pending.amountSats
          };
          delete this._distributeRequests[documentId];
        } else if (bitcoin && !pending) {
          return fail('Payment required. Call CreateDistributeInvoice first with documentId and amountSats.');
        }

        const durationYears = Number(config.durationYears || 4);
        const challengeCadence = config.challengeCadence || 'daily';
        const responseDeadline = config.responseDeadline || '10s';
        const desiredCopies = Math.max(1, Number(pending ? pending.config?.desiredCopies : config.desiredCopies) || 1);
        const ownerId = config.actorId || (this.agent && this.agent.identity && this.agent.identity.id) || null;

        try {
          // Lightweight in-memory record for now; can later move to a dedicated
          // contracts collection and Bitcoin-backed escrow.
          this._ensureResourceCollections();

          const descriptor = {
            type: 'StorageContract',
            document: documentId,
            amountSats,
            durationYears,
            challengeCadence,
            responseDeadline,
            desiredCopies,
            created: new Date().toISOString(),
            ...(txid ? { txid } : {}),
            ...(verifiedInvoiceMeta && verifiedInvoiceMeta.invoiceAddress
              ? {
                invoiceAddress: verifiedInvoiceMeta.invoiceAddress,
                invoiceAmountSats: verifiedInvoiceMeta.invoiceAmountSats
              }
              : {})
          };

          const contract = new Actor({ content: descriptor });
          const contractId = contract.id;

          this._state.content.collections.contracts[contractId] = {
            id: contractId,
            ...descriptor,
            owner: ownerId || undefined
          };
          this._state.content.contracts = this._state.content.collections.contracts;

          if (txid) {
            try {
              this._mergePersistedTxLabel(txid, 'storage_contract', { documentId, contractId });
            } catch (_) {}
          }

          // Persist a minimal record alongside documents for durability
          try {
            await this.fs.publish(`contracts/${contractId}.json`, this._state.content.collections.contracts[contractId]);
            // Persist updated global state (includes contracts index)
            await this._appendFabricMessage('CreateStorageContract', {
              id: contractId,
              document: documentId,
              amountSats,
              durationYears,
              desiredCopies,
              ...(txid ? { txid } : {})
            });
            this._refreshChainState('create-storage-contract');
            this.commit();
            if (typeof pushNetworkStatus === 'function') pushNetworkStatus();
          } catch (e) {
            console.error('[HUB] Failed to persist storage contract:', e);
          }

          // Record activity describing the new storage contract.
          this.recordActivity({
            type: 'Create',
            actor: ownerId ? { id: ownerId } : undefined,
            object: {
              type: 'StorageContract',
              id: contractId,
              document: documentId,
              amountSats,
              durationYears,
              challengeCadence,
              responseDeadline
            }
          });

          try {
            const ch = this._getChallengeService();
            if (ch) await ch.registerFromStorageContract(this._state.content.collections.contracts[contractId]);
          } catch (e) {
            console.warn('[HUB] ChallengeService register failed:', e && e.message ? e.message : e);
          }

          return {
            type: 'CreateStorageContractResult',
            id: contractId,
            contract: this._state.content.collections.contracts[contractId]
          };
        } catch (err) {
          console.error('[HUB] CreateStorageContract error:', err);
          return fail(err && err.message ? err.message : 'create storage contract failed');
        }
      });

      // Proof-of-storage challenge index (one row per StorageContract; see ChallengeService).
      this.http._registerMethod('ListStorageChallenges', async () => {
        const ch = this._getChallengeService();
        if (!ch) {
          return { type: 'ListStorageChallengesResult', challenges: [], available: false };
        }
        return { type: 'ListStorageChallengesResult', challenges: ch.list(), available: true };
      });

      this.http._registerMethod('GetStorageChallenge', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const contractId = req.contractId || params[0];
        if (!contractId) return { status: 'error', message: 'contractId required' };
        const ch = this._getChallengeService();
        if (!ch) return { status: 'error', message: 'Challenge service unavailable' };
        const row = ch.getByContractId(contractId);
        if (!row) return { type: 'GetStorageChallengeResult', challenge: null };
        return { type: 'GetStorageChallengeResult', challenge: row };
      });

      // L1 pay-to-register for execution contracts (when Bitcoin service is enabled).
      // Params: ({ program, amountSats, name? }) — same program bytes must be submitted to CreateExecutionContract with txid.
      this.http._registerMethod('CreateExecutionRegistryInvoice', async (...params) => {
        const config = params[0] || {};
        const program = config.program;
        if (!program || typeof program !== 'object') {
          return { status: 'error', message: 'program object required' };
        }
        const validation = runExecutionProgram(program);
        if (!validation.ok) {
          return { status: 'error', message: validation.error || 'program validation failed' };
        }
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) {
          return { status: 'error', message: 'Bitcoin service unavailable; cannot create execution registry invoice.' };
        }
        const amountSats = Number(config.amountSats || 0);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'positive amountSats required' };
        }
        const safeProg = DistributedExecution.jsonSafe(program);
        const digest = crypto.createHash('sha256')
          .update(Buffer.from(DistributedExecution.stableStringify(safeProg), 'utf8'))
          .digest('hex');
        const name = config.name ? String(config.name).trim() : '';
        try {
          const address = await bitcoin.getUnusedAddress();
          const now = new Date().toISOString();
          this._executionRegistryRequests[digest] = {
            address,
            amountSats,
            program: safeProg,
            name: name || undefined,
            createdAt: now
          };
          const netRaw = bitcoin.network != null ? String(bitcoin.network) : 'regtest';
          return {
            type: 'CreateExecutionRegistryInvoiceResult',
            programDigest: digest,
            address,
            amountSats,
            network: netRaw.trim() || 'regtest',
            name: name || undefined,
            expiresAt: now
          };
        } catch (err) {
          console.error('[HUB] CreateExecutionRegistryInvoice error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'registry invoice failed' };
        }
      });

      // Execution contract registry: validated sandboxed program. When Bitcoin is enabled, requires
      // CreateExecutionRegistryInvoice + L1 txid; otherwise free create (dev / no bitcoind).
      // Params: ({ name?: string, program, txid?, programDigest?, actorId?: string })
      this.http._registerMethod('CreateExecutionContract', async (...params) => {
        const config = params[0] || {};
        const program = config.program;
        const name = config.name ? String(config.name).trim() : '';
        if (!program || typeof program !== 'object') {
          return { status: 'error', message: 'program object required' };
        }

        const validation = runExecutionProgram(program);
        if (!validation.ok) {
          return { status: 'error', message: validation.error || 'program validation failed' };
        }

        const bitcoin = this._getBitcoinService();
        const txid = config.txid ? String(config.txid).trim() : null;
        const clientDigest = config.programDigest ? String(config.programDigest).trim().toLowerCase() : '';

        const safeProg = DistributedExecution.jsonSafe(program);
        const computedDigest = crypto.createHash('sha256')
          .update(Buffer.from(DistributedExecution.stableStringify(safeProg), 'utf8'))
          .digest('hex');

        let verifiedInvoiceMeta = null;

        if (bitcoin) {
          if (!clientDigest || clientDigest !== computedDigest) {
            return {
              status: 'error',
              message: clientDigest && clientDigest !== computedDigest
                ? 'programDigest does not match canonical hash of program'
                : 'Bitcoin is enabled: call CreateExecutionRegistryInvoice, pay the invoice on-chain, then pass programDigest and txid with the same program.'
            };
          }
          const pending = this._executionRegistryRequests[clientDigest];
          if (!pending) {
            return { status: 'error', message: 'No pending registry invoice for this program digest. Call CreateExecutionRegistryInvoice first.' };
          }
          if (DistributedExecution.stableStringify(safeProg) !== DistributedExecution.stableStringify(pending.program)) {
            return { status: 'error', message: 'Program does not match pending registry invoice.' };
          }
          if (!txid) {
            return { status: 'error', message: 'txid required after paying the registry invoice.' };
          }
          const verified = await this._verifyL1Payment(bitcoin, txid, pending.address, pending.amountSats);
          if (!verified) {
            return { status: 'error', message: 'L1 payment verification failed for registry invoice.' };
          }
          verifiedInvoiceMeta = {
            invoiceAddress: pending.address,
            invoiceAmountSats: pending.amountSats
          };
          delete this._executionRegistryRequests[clientDigest];
        }

        const ownerId = config.actorId || (this.agent && this.agent.identity && this.agent.identity.id) || null;

        try {
          this._ensureResourceCollections();

          const descriptor = {
            type: 'ExecutionContract',
            version: 1,
            name: name || undefined,
            program: safeProg,
            programDigest: computedDigest,
            created: new Date().toISOString(),
            validatedSteps: validation.stepsExecuted,
            ...(txid ? { txid } : {}),
            ...(verifiedInvoiceMeta && verifiedInvoiceMeta.invoiceAddress
              ? {
                invoiceAddress: verifiedInvoiceMeta.invoiceAddress,
                invoiceAmountSats: verifiedInvoiceMeta.invoiceAmountSats
              }
              : {})
          };

          const contract = new Actor({ content: descriptor });
          const contractId = contract.id;

          this._state.content.collections.contracts[contractId] = {
            id: contractId,
            ...descriptor,
            owner: ownerId || undefined
          };
          this._state.content.contracts = this._state.content.collections.contracts;

          try {
            await this.fs.publish(`contracts/${contractId}.json`, this._state.content.collections.contracts[contractId]);
            if (txid) {
              try {
                this._mergePersistedTxLabel(txid, 'execution_registry', { contractId, programDigest: computedDigest });
              } catch (_) {}
            }
            await this._appendFabricMessage('CreateExecutionContract', {
              id: contractId,
              validatedSteps: validation.stepsExecuted,
              programDigest: computedDigest,
              ...(name ? { name } : {}),
              ...(txid ? { txid } : {})
            });
            this._refreshChainState('create-execution-contract');
            this.commit();
            if (typeof pushNetworkStatus === 'function') pushNetworkStatus();
          } catch (e) {
            console.error('[HUB] Failed to persist execution contract:', e);
          }

          this.recordActivity({
            type: 'Create',
            actor: ownerId ? { id: ownerId } : undefined,
            object: {
              type: 'ExecutionContract',
              id: contractId,
              name: name || undefined,
              validatedSteps: validation.stepsExecuted
            }
          });

          return {
            type: 'CreateExecutionContractResult',
            id: contractId,
            contract: this._state.content.collections.contracts[contractId]
          };
        } catch (err) {
          console.error('[HUB] CreateExecutionContract error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'create execution contract failed' };
        }
      });

      // Re-run a persisted execution contract on the hub (returns trace; does not mutate contract file).
      // Params: ({ contractId: string } | contractId)
      this.http._registerMethod('RunExecutionContract', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const id = String(req.contractId || req.id || params[0] || '').trim();
        if (!id) return { status: 'error', message: 'contractId required' };

        let contract = null;
        try {
          const raw = this.fs.readFile(`contracts/${id}.json`);
          if (raw) contract = JSON.parse(raw);
        } catch (e) {
          contract = null;
        }
        if (!contract) {
          const mem = this._state.content.collections.contracts && this._state.content.collections.contracts[id];
          contract = mem || null;
        }
        if (!contract || contract.type !== 'ExecutionContract') {
          return { status: 'error', message: 'execution contract not found' };
        }

        const result = runExecutionProgram(contract.program);
        let runCommitmentHex = null;
        try {
          runCommitmentHex = computeExecutionRunCommitmentHex(id, result);
        } catch (e) {
          runCommitmentHex = null;
        }
        const out = {
          type: 'RunExecutionContractResult',
          contractId: id,
          runCommitmentHex,
          ...result
        };
        const top = result.ok && result.stack && result.stack.length
          ? result.stack[result.stack.length - 1]
          : null;
        if (top && top.kind === 'DelegationSignRequest') {
          const validation = validateEnvelopeV1(top.envelope);
          if (validation.ok) {
            try {
              const msg = buildGenericMessageFromEnvelope(top.envelope);
              out.fabricMessageWireHex = msg.toBuffer().toString('hex');
              out.delegationSignRequest = {
                envelope: top.envelope,
                display: top.envelope.display || null
              };
            } catch (err) {
              out.delegationSignRequestError = err && err.message ? err.message : String(err);
            }
          } else {
            out.delegationSignRequestError = validation.error || 'invalid envelope';
          }
        }
        return out;
      });

      // Regtest only: OP_RETURN anchor for {@link computeExecutionRunCommitmentHex} (admin + funded wallet).
      // Params: { commitmentHex, adminToken }
      this.http._registerMethod('AnchorExecutionRunCommitment', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const token = String(req.adminToken || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { status: 'error', message: 'adminToken required' };
        }
        const commitmentHex = String(req.commitmentHex || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(commitmentHex)) {
          return { status: 'error', message: 'commitmentHex must be 64 hex characters' };
        }
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) {
          return { status: 'error', message: 'Bitcoin service unavailable' };
        }
        try {
          const { txid, hex } = await anchorExecutionCommitmentRegtest(bitcoin, commitmentHex);
          await this._collectBitcoinStatus({ force: true }).catch(() => {});
          return {
            type: 'AnchorExecutionRunCommitmentResult',
            commitmentHex,
            txid,
            txHex: hex
          };
        } catch (err) {
          return {
            status: 'error',
            message: err && err.message ? err.message : String(err)
          };
        }
      });

      // Sidechain global state (JSON Patch on `content`); epochs embed `payload.sidechain` from this head.
      this.http._registerMethod('GetSidechainState', async () => {
        const st = this._sidechainState || sidechainState.loadState(this.fs);
        this._sidechainState = st;
        return {
          type: 'SidechainState',
          version: st.version,
          clock: st.clock,
          stateDigest: sidechainState.stateDigest(st),
          content: st.content
        };
      });

      // Params: { patches, basisClock, federationWitness? } or adminToken when no federation validators.
      this.http._registerMethod('SubmitSidechainStatePatch', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        return this._submitSidechainStatePatch(req);
      });

      this.http._registerMethod('GetDistributedFederationPolicy', (...params) => {
        void params;
        const fp = this._getEffectiveFederationPolicyForDistributedHttp();
        const reg = federationRegistry.loadRegistry(this.fs);
        return {
          type: 'DistributedFederationPolicy',
          source: this._distributedFederationPolicySource(),
          validators: fp.validators,
          threshold: fp.threshold,
          filesystem: {
            registryDocument: federationRegistry.REGISTRY_PATH,
            policySnapshotDocument: federationRegistry.POLICY_SNAPSHOT_PATH,
            registryEntryCount: Array.isArray(reg.entries) ? reg.entries.length : 0,
            lastScannedHeight: reg.lastScannedHeight != null ? reg.lastScannedHeight : null
          }
        };
      });

      this.http._registerMethod('GetFederationRegistry', (...params) => {
        void params;
        const reg = federationRegistry.loadRegistry(this.fs);
        return {
          type: 'FederationRegistry',
          path: federationRegistry.REGISTRY_PATH,
          ...reg
        };
      });

      // Params: { fundedTxHex, destinationAddress|toAddress, feeSats?, vaultAddress?, adminToken|token }
      this.http._registerMethod('PrepareFederationVaultWithdrawalPsbt', async (...params) => {
        const body = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        return this._rpcPrepareFederationVaultWithdrawalPsbt(body);
      });

      // Params: { validators: string[], threshold?: number, adminToken|token } — blocked when env validators override.
      this.http._registerMethod('SetDistributedFederationPolicy', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { status: 'error', message: 'adminToken required' };
        }
        const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
        if (env && String(env).trim()) {
          return {
            status: 'error',
            message: 'Clear FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS on the Hub process to manage federation from the UI.'
          };
        }
        let validators = req.validators;
        if (!Array.isArray(validators)) {
          return { status: 'error', message: 'validators array required' };
        }
        validators = validators.map((v) => String(v || '').trim()).filter(Boolean);
        let threshold = req.threshold != null ? Number(req.threshold) : 1;
        if (!Number.isFinite(threshold) || threshold < 1) threshold = 1;
        if (validators.length && threshold > validators.length) threshold = validators.length;
        if (!this.settings.distributed) this.settings.distributed = {};
        if (!this.settings.distributed.federation) this.settings.distributed.federation = {};
        this.settings.distributed.federation.validators = validators.slice();
        this.settings.distributed.federation.threshold = threshold;
        try {
          await this.setup.setSetting('DISTRIBUTED_FEDERATION', {
            validators: validators.slice(),
            threshold
          });
        } catch (e) {
          return { status: 'error', message: e && e.message ? e.message : String(e) };
        }
        try {
          await federationRegistry.persistPolicySnapshot(this.fs, {
            validators: validators.slice(),
            threshold,
            source: 'persisted'
          });
        } catch (e) {
          console.warn('[HUB:FEDERATION] policy snapshot publish failed:', e && e.message ? e.message : e);
        }
        this._reapplyBeaconFederationPolicy();
        try {
          await this._appendFabricMessage('DistributedFederationPolicy', {
            validators: validators.slice(),
            threshold
          });
        } catch (e) {
          console.warn('[HUB:FEDERATION] log append failed:', e && e.message ? e.message : e);
        }
        return {
          type: 'SetDistributedFederationPolicyResult',
          status: 'success',
          validators: validators.slice(),
          threshold
        };
      });

      // Params: { pubkey|responderPubkey, adminToken|token }
      this.http._registerMethod('AddDistributedFederationMember', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { status: 'error', message: 'adminToken required' };
        }
        const env = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
        if (env && String(env).trim()) {
          return {
            status: 'error',
            message: 'Clear FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS on the Hub process to add members from the UI.'
          };
        }
        const pk = String(req.pubkey || req.responderPubkey || '').trim();
        if (!pk) return { status: 'error', message: 'pubkey required' };
        const cur = this._distributedFederationValidatorsFromEnv().slice();
        if (cur.includes(pk)) {
          return {
            type: 'AddDistributedFederationMemberResult',
            status: 'success',
            validators: cur,
            threshold: this._distributedFederationThresholdEffective(),
            alreadyMember: true
          };
        }
        cur.push(pk);
        let threshold = this._distributedFederationThresholdEffective();
        if (!Number.isFinite(threshold) || threshold < 1) threshold = 1;
        if (cur.length && threshold > cur.length) threshold = cur.length;
        if (!this.settings.distributed) this.settings.distributed = {};
        if (!this.settings.distributed.federation) this.settings.distributed.federation = {};
        this.settings.distributed.federation.validators = cur;
        this.settings.distributed.federation.threshold = threshold;
        try {
          await this.setup.setSetting('DISTRIBUTED_FEDERATION', { validators: cur, threshold });
        } catch (e) {
          return { status: 'error', message: e && e.message ? e.message : String(e) };
        }
        try {
          await federationRegistry.persistPolicySnapshot(this.fs, {
            validators: cur,
            threshold,
            source: 'persisted'
          });
        } catch (e) {
          console.warn('[HUB:FEDERATION] policy snapshot publish failed:', e && e.message ? e.message : e);
        }
        this._reapplyBeaconFederationPolicy();
        try {
          await this._appendFabricMessage('DistributedFederationMemberAdded', { pubkey: pk });
        } catch (e) {
          console.warn('[HUB:FEDERATION] log append failed:', e && e.message ? e.message : e);
        }
        return {
          type: 'AddDistributedFederationMemberResult',
          status: 'success',
          validators: cur,
          threshold
        };
      });

      // Params: { peerId|address|id, contractId?, note?, adminToken|token }
      this.http._registerMethod('InvitePeerToFederationContract', async (...params) => {
        const req = (params[0] && typeof params[0] === 'object') ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { status: 'error', message: 'adminToken required' };
        }
        const idOrAddress = req.peerId || req.address || req.id;
        if (!idOrAddress) return { status: 'error', message: 'peer id or address required' };
        const contractId = req.contractId != null ? String(req.contractId).trim() : '';
        const note = req.note != null ? String(req.note).trim().slice(0, 2000) : '';
        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) {
          return { status: 'error', message: 'peer not connected' };
        }
        const targetValue = String(idOrAddress);
        const inviteId = crypto.randomBytes(16).toString('hex');
        if (!this.agent || !this.agent.identity || !this.agent.identity.id) {
          return { status: 'error', message: 'hub identity unavailable' };
        }
        const inviterHubId = String(this.agent.identity.id);
        const content = federationContractInvite.buildFederationContractInviteJson({
          inviteId,
          inviterHubId,
          contractId: contractId || null,
          note: note || null,
          invitedAt: Date.now()
        });
        const actorId = this.agent.identity.id;
        const chatPayload = {
          type: 'P2P_CHAT_MESSAGE',
          actor: { id: actorId },
          object: { content, created: Date.now() },
          target: targetValue
        };
        try {
          this._sendVectorToPeer(address, ['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)]);
          try {
            this.agent.emit('chat', chatPayload);
          } catch (echoErr) {
            console.warn('[HUB] Failed to locally echo peer chat message:', echoErr);
          }
          try {
            await this._appendFabricMessage('FederationContractInvite', {
              inviteId,
              targetPeer: targetValue,
              contractId: contractId || null,
              note: note || null
            });
          } catch (logErr) {
            console.warn('[HUB:FEDERATION] log append failed:', logErr && logErr.message ? logErr.message : logErr);
          }
          return {
            type: 'InvitePeerToFederationContractResult',
            status: 'success',
            inviteId
          };
        } catch (err) {
          return { status: 'error', message: err && err.message ? err.message : String(err) };
        }
      });

      const buildNetworkStatus = () => {
        const chain = this._refreshChainState('network-status');
        const fabricMessages = this._getFabricMessages();
        const setupStatus = this.setup.getSetupStatus();
        const btcSvc = this._state.content && this._state.content.services && this._state.content.services.bitcoin;
        const bitcoinSnapshot = (btcSvc && btcSvc.status && typeof btcSvc.status === 'object')
          ? { ...btcSvc.status }
          : this._sanitizeBitcoinStatusForPublic(this._bitcoinStatusCache && this._bitcoinStatusCache.value);
        const emailSvc = this._state.content && this._state.content.services && this._state.content.services.email;
        const emailSnapshot = emailSvc && typeof emailSvc === 'object'
          ? {
            enabled: !!emailSvc.enabled,
            configured: !!emailSvc.configured,
            transport: emailSvc.transport || null
          }
          : { enabled: false, configured: false, transport: null };
        return {
          clock: this.http.clock,
          contract: this.contract.id,
          /** Stable Fabric P2P identity (secp256k1 pubkey hex) for sharing — does not change with contract state. */
          fabricPeerId: this.agent && this.agent.id ? String(this.agent.id) : null,
          documents: this._state.documents,
          setup: setupStatus,
          publishedDocuments: (this._state.content && this._state.content.collections && this._state.content.collections.documents) ? this._state.content.collections.documents : {},
          messages: this._state.messages || {},
          fabricMessages,
          chain,
          /** Wallet-safe Bitcoin head (height, tip hash, network, mempool counts) for operator UIs (e.g. Peers). */
          bitcoin: bitcoinSnapshot,
          /** Outbound email (invitations / alerts); no secrets in this snapshot. */
          email: emailSnapshot,
          network: {
            address: this.http.agent.listenAddress,
            listening: this.http.agent.listening
          },
          // TCP known peers plus browser WebRTC registrations (Fabric ids via metadata.fabricPeerId).
          peers: mergeFabricPeersWithWebRtcRegistry(this.agent.knownPeers, this.http.webrtcPeerList || []),
          // Browser WebRTC mesh peers (registered via RegisterWebRTCPeer / Bridge)
          webrtcPeers: this.http.webrtcPeerList || [],
          // settings: this.settings,
          state: this.http.state,
          xpub: this._rootKey.xpub
        };
      };

      this.http._registerMethod('GetNetworkStatus', async (...params) => {
        await this._collectBitcoinStatus({ force: false }).catch(() => {});
        return buildNetworkStatus();
      });

      this.http._registerMethod('GetSetupStatus', (...params) => {
        return this.setup.getSetupStatus();
      });

      this.http._registerMethod('GetMerkleState', (...params) => {
        const current = this._refreshChainState('rpc-get-chain-state');
        return {
          type: 'GetMerkleStateResult',
          current,
          history: (this._state.content && this._state.content.collections && this._state.content.collections.chain)
            ? this._state.content.collections.chain
            : {}
        };
      });

      this.http._registerMethod('ListFabricMessages', (...params) => {
        return {
          type: 'ListFabricMessagesResult',
          messages: this._getFabricMessages()
        };
      });

      // Delegation signing: Fabric message log (`DELEGATION_SIGNATURE_*`) + JSON-RPC (no HTTP “sign-request” resources).
      this.http._registerMethod('PostDelegationSignatureMessage', async (...params) => {
        const p = params[0] && typeof params[0] === 'object' ? params[0] : {};
        return postDelegationSignatureMessage(this, p);
      });
      this.http._registerMethod('GetDelegationSignatureMessage', (...params) => {
        const p = params[0] && typeof params[0] === 'object' ? params[0] : {};
        return getDelegationSignatureMessage(this, p);
      });
      this.http._registerMethod('ResolveDelegationSignatureMessage', async (...params) => {
        const p = params[0] && typeof params[0] === 'object' ? params[0] : {};
        return resolveDelegationSignatureMessage(this, p);
      });

      this.http._registerMethod('ListPeers', async (...params) => {
        // For the UI we return the same shape as GetNetworkStatus
        // so the bridge/networkStatus wiring can remain consistent.
        await this._collectBitcoinStatus({ force: false }).catch(() => {});
        return buildNetworkStatus();
      });

      this.http._registerMethod('GetWorkerStatus', (...params) => {
        const top = this._workQueue && this._workQueue.length ? this._workQueue[0] : null;
        return {
          type: 'GetWorkerStatusResult',
          status: 'success',
          strategy: this._normalizeWorkQueueStrategy(this._workQueueStrategy),
          strategies: Array.from(WORK_QUEUE_STRATEGIES),
          workerReady: !!this.worker,
          workers: Array.isArray(this.workers) ? this.workers.length : 0,
          queueLength: Array.isArray(this._workQueue) ? this._workQueue.length : 0,
          queueBusy: !!this._workQueueBusy,
          top: top
            ? {
                id: top.id,
                type: top.type,
                valueSats: Number(top.valueSats || 0),
                attempts: Number(top.attempts || 0),
                sourcePeer: top.sourcePeer || '',
                createdAt: top.createdAt || 0
              }
            : null
        };
      });

      this.http._registerMethod('GetNodeWealthSummary', async (...params) => {
        await this._collectBitcoinStatus({ force: false }).catch(() => {});
        const btc = this._state && this._state.content && this._state.content.services && this._state.content.services.bitcoin
          ? this._state.content.services.bitcoin.status || {}
          : {};
        const labelSummary = this._computeNodeWealthSummaryFromLabels();
        return {
          type: 'GetNodeWealthSummaryResult',
          status: 'success',
          wallet: {
            available: !!(btc && btc.available),
            network: btc && btc.network ? String(btc.network) : '',
            balanceBtc: Number(btc && btc.balance != null ? btc.balance : 0),
            balanceSats: Number.isFinite(Number(btc && btc.balanceSats)) ? Number(btc.balanceSats) : undefined,
            height: Number.isFinite(Number(btc && btc.height)) ? Number(btc.height) : undefined
          },
          labeledFlows: labelSummary
        };
      });

      this.http._registerMethod('ListWorkerQueue', (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const offset = Math.max(0, Number(req.offset || 0) || 0);
        const limit = Math.max(1, Math.min(200, Number(req.limit || 50) || 50));
        const queue = Array.isArray(this._workQueue) ? this._workQueue : [];
        const rows = queue
          .slice(offset, offset + limit)
          .map((item) => ({
            id: item.id,
            type: item.type,
            sourcePeer: item.sourcePeer || '',
            valueSats: Number(item.valueSats || 0),
            attempts: Number(item.attempts || 0),
            createdAt: item.createdAt || 0,
            payload: item.payload || {}
          }));
        return {
          type: 'ListWorkerQueueResult',
          status: 'success',
          strategy: this._normalizeWorkQueueStrategy(this._workQueueStrategy),
          total: queue.length,
          offset,
          limit,
          items: rows
        };
      });

      this.http._registerMethod('RunWorkerQueueNow', async (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { type: 'RunWorkerQueueNowResult', status: 'error', message: 'adminToken required' };
        }
        await this._drainWorkQueue().catch(() => {});
        return {
          type: 'RunWorkerQueueNowResult',
          status: 'success',
          queueLength: Array.isArray(this._workQueue) ? this._workQueue.length : 0,
          queueBusy: !!this._workQueueBusy
        };
      });

      this.http._registerMethod('SetWorkerQueueStrategy', async (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { type: 'SetWorkerQueueStrategyResult', status: 'error', message: 'adminToken required' };
        }
        const requested = this._normalizeWorkQueueStrategy(req.strategy);
        if (!WORK_QUEUE_STRATEGIES.has(requested)) {
          return {
            type: 'SetWorkerQueueStrategyResult',
            status: 'error',
            message: 'invalid strategy',
            allowed: Array.from(WORK_QUEUE_STRATEGIES)
          };
        }
        const strategy = await this._setWorkQueueStrategy(requested);
        return {
          type: 'SetWorkerQueueStrategyResult',
          status: 'success',
          strategy,
          queueLength: Array.isArray(this._workQueue) ? this._workQueue.length : 0
        };
      });

      this.http._registerMethod('ClearWorkerQueue', (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { type: 'ClearWorkerQueueResult', status: 'error', message: 'adminToken required' };
        }
        const before = Array.isArray(this._workQueue) ? this._workQueue.length : 0;
        this._workQueue = [];
        this._workQueueById = new Set();
        return { type: 'ClearWorkerQueueResult', status: 'success', cleared: before };
      });

      this.http._registerMethod('DropWorkerQueueItem', (...params) => {
        const req = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const token = String(req.adminToken || req.token || '').trim();
        if (!this.setup.verifyAdminToken(token)) {
          return { type: 'DropWorkerQueueItemResult', status: 'error', message: 'adminToken required' };
        }
        const id = String(req.id || '').trim();
        if (!id) return { type: 'DropWorkerQueueItemResult', status: 'error', message: 'id required' };
        const before = Array.isArray(this._workQueue) ? this._workQueue.length : 0;
        this._workQueue = (this._workQueue || []).filter((item) => item && item.id !== id);
        this._workQueueById.delete(id);
        return {
          type: 'DropWorkerQueueItemResult',
          status: 'success',
          removed: before !== this._workQueue.length,
          queueLength: this._workQueue.length
        };
      });

      // When Hub needs more Fabric P2P connections, publish peering offer (gossiped until fulfilled).
      // Called from pushNetworkStatus and from periodic timer.
      const maybeBroadcastFabricPeeringOffer = () => {
        try {
          const connCount = Object.keys(this.agent.connections || {}).length;
          const agentConstraints = this.agent && this.agent.settings && this.agent.settings.constraints
            ? this.agent.settings.constraints
            : null;
          const maxPeers = (agentConstraints && agentConstraints.peers && agentConstraints.peers.max) || MAX_PEERS;
          if (connCount >= maxPeers || connCount === 0) return;
          const now = Date.now();
          const last = this._lastFabricPeeringOfferAt || 0;
          if (now - last < FABRIC_PEERING_OFFER_INTERVAL_MS) return;
          this._lastFabricPeeringOfferAt = now;
          const host = (this.settings.http && this.settings.http.hostname) || 'localhost';
          const port = this.agent.port || this.settings.port || 7777;
          const payload = {
            type: P2P_PEERING_OFFER,
            actor: { id: this.agent.identity.id },
            object: { slots: maxPeers - connCount, transport: 'fabric', host, port }
          };
          const p2pMsg = Message.fromVector([P2P_PEERING_OFFER, JSON.stringify(payload)]).signWithKey(this.agent.key);
          this.agent.relayFrom('_hub', p2pMsg);
        } catch (err) {
          console.error('[HUB] maybeBroadcastFabricPeeringOffer error:', err);
        }
      };

      // Push network status to all WebSocket clients when peer connections change
      const pushNetworkStatus = () => {
        try {
          const status = buildNetworkStatus();
          const msg = Message.fromVector(['JSONCall', JSON.stringify({
            method: 'JSONCallResult',
            params: [null, status]
          })]);
          if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(msg);
          }
          maybeBroadcastFabricPeeringOffer();
        } catch (err) {
          console.error('[HUB] pushNetworkStatus error:', err);
        }
      };
      // Expose for lifecycle cleanup.
      this._pushNetworkStatus = pushNetworkStatus;

      this.agent.on('connections:open', (ev) => {
        pushNetworkStatus();
        this._maybeRequestFabricSeedResync(ev);
        const addr = ev && (ev.address || ev.id);
        this._requestMainchainInventoryFromPeer(addr, 'connection-open').catch(() => {});
      });
      this.agent.on('connections:close', pushNetworkStatus);

      // Push network status when WebRTC peers connect/disconnect
      this.http.on('webrtc:connection', pushNetworkStatus);
      this.http.on('webrtc:disconnect', pushNetworkStatus);

      // Periodic Fabric peering offer (when below max peers, even if connections don't change)
      this._fabricPeeringOfferIntervalId = setInterval(maybeBroadcastFabricPeeringOffer, FABRIC_PEERING_OFFER_INTERVAL_MS);

      // Set a node-local nickname for a peer (stored in this node's LevelDB peer registry).
      // Params: (idOrAddress: string, nickname: string|null) — id (public key) or address
      this.http._registerMethod('SetPeerNickname', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        const nickname = params[1] != null ? params[1] : (params[0] && params[0].nickname);
        if (!idOrAddress) return { status: 'error', message: 'id or address required' };
        try {
          const clean = nickname == null ? '' : String(nickname).trim();
          const registry = this.agent._state && this.agent._state.peers ? this.agent._state.peers : {};
          const addressToId = this.agent._addressToId || {};
          const key = registry[idOrAddress] ? idOrAddress : (addressToId[idOrAddress] || idOrAddress);
          this.agent._upsertPeerRegistry(key, { id: key, nickname: clean || null });
          pushNetworkStatus();
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] SetPeerNickname error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'failed' };
        }
      });

      // Get rich details for a peer (registry + live connection metadata).
      // Params: (idOrAddress: string | { id, address }) — id (public key) or address
      this.http._registerMethod('GetPeer', (...params) => {
        const input = params[0] && (params[0].address || params[0].id || params[0]);
        if (!input) return { status: 'error', message: 'id or address required' };

        const registry = this.agent && this.agent._state ? (this.agent._state.peers || {}) : {};
        const connections = this.agent ? (this.agent.connections || {}) : {};
        const known = this.agent && typeof this.agent.knownPeers !== 'undefined' ? this.agent.knownPeers : [];
        const addressToId = this.agent._addressToId || {};

        const entry = Array.isArray(known) && known.find((p) => p && (p.id === input || p.address === input));
        const id = entry ? entry.id : (registry[input] && registry[input].id) || input;
        const address = typeof this.agent._resolveToAddress === 'function'
          ? this.agent._resolveToAddress(input)
          : (entry && entry.address) || (registry[id] && registry[id].address) || input;
        const reg = registry[id] || registry[address] || null;
        const socket = connections[address] || null;

        const connection = socket ? {
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
          lastMessage: socket._lastMessage || null,
          alias: socket._alias || null,
          failureCount: socket._failureCount || 0
        } : null;

        const peer = {
          id,
          address: address || (reg && reg.address),
          status: socket ? 'connected' : ((entry && entry.status) || 'disconnected'),
          ...(entry || {}),
          registry: reg,
          connection
        };

        return {
          type: 'GetPeerResult',
          peer
        };
      });

      const bumpWebRtcMeshSession = (pid) => {
        const id = pid != null ? String(pid) : '';
        if (!id || !this.http.webrtcPeers.has(id)) return;
        const e = this.http.webrtcPeers.get(id);
        e.meshSessionCount = Math.max(0, (Number(e.meshSessionCount) || 0) + 1);
        e.meshLastAt = Date.now();
        this.http.webrtcPeers.set(id, e);
      };

      const decWebRtcMeshSession = (pid) => {
        const id = pid != null ? String(pid) : '';
        if (!id || !this.http.webrtcPeers.has(id)) return;
        const e = this.http.webrtcPeers.get(id);
        e.meshSessionCount = Math.max(0, (Number(e.meshSessionCount) || 0) - 1);
        e.meshLastAt = Date.now();
        this.http.webrtcPeers.set(id, e);
      };

      // Track when browsers establish direct WebRTC connections (updates GetNetworkStatus.peers mesh flags).
      this.http._registerMethod('WebRTCPeerConnected', (...params) => {
        const info = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const remote = info.remotePeerId != null ? String(info.remotePeerId) : (info.peerId != null ? String(info.peerId) : '');
        const selfId = info.selfPeerId != null ? String(info.selfPeerId) : (info.localPeerId != null ? String(info.localPeerId) : '');
        if (remote) bumpWebRtcMeshSession(remote);
        if (selfId) bumpWebRtcMeshSession(selfId);
        console.debug('[HUB] WebRTCPeerConnected:', { remote, selfId, direction: info.direction });
        pushNetworkStatus();
        return { status: 'success' };
      });

      // Track when browsers disconnect mesh data channels.
      this.http._registerMethod('WebRTCPeerDisconnected', (...params) => {
        const info = params[0] && typeof params[0] === 'object' ? params[0] : {};
        const remote = info.remotePeerId != null ? String(info.remotePeerId) : (info.peerId != null ? String(info.peerId) : '');
        const selfId = info.selfPeerId != null ? String(info.selfPeerId) : (info.localPeerId != null ? String(info.localPeerId) : '');
        if (remote) decWebRtcMeshSession(remote);
        if (selfId) decWebRtcMeshSession(selfId);
        console.debug('[HUB] WebRTCPeerDisconnected:', { remote, selfId });
        pushNetworkStatus();
        return { status: 'success' };
      });

      // Relay native WebRTC signaling messages between browser clients.
      this.http._registerMethod('SendWebRTCSignal', (...params) => {
        const options = params[0] || {};
        const fromPeerId = options.fromPeerId;
        const toPeerId = options.toPeerId;
        const signal = options.signal;

        if (!fromPeerId || !toPeerId || !signal) {
          return { status: 'error', message: 'fromPeerId, toPeerId, and signal are required' };
        }

        try {
          // Use webrtcPeers map as a registry of known browser peers; actual
          // WebSocket connections are managed by HTTPServer. We broadcast the
          // signal and let Bridge instances filter on toPeerId.
          const payload = {
            type: 'WebRTCSignal',
            fromPeerId,
            toPeerId,
            signal
          };

          const msg = Message.fromVector(['JSONCall', JSON.stringify({
            method: 'JSONCallResult',
            params: [null, payload]
          })]);

          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(msg);
          }

          return { status: 'success' };
        } catch (err) {
          console.error('[HUB]', 'Error relaying WebRTC signal:', err);
          return { status: 'error', message: err.message || String(err) };
        }
      });

      // Relay messages received via WebRTC data channel to WebSocket clients (and Fabric P2P).
      // Wraps in P2P_RELAY envelope to preserve original message + signature for onion routing.
      // Include BitcoinBlock so browser mesh can forward chain-head summaries to Fabric P2P via the hub (same shape as ZMQ-driven gossip).
      const RELAYABLE_ORIGINAL_TYPES = ['P2P_CHAT_MESSAGE', P2P_PEER_GOSSIP, P2P_PEERING_OFFER, 'fabric-message', 'BitcoinBlock'];
      this.http._registerMethod('RelayFromWebRTC', (...params) => {
        const body = params[0] || params;
        const fromPeerId = body && body.fromPeerId ? String(body.fromPeerId) : null;
        const envelope = body && body.envelope ? body.envelope : null;

        if (!fromPeerId || !envelope || typeof envelope !== 'object') {
          return { status: 'error', message: 'fromPeerId and envelope (object) are required' };
        }

        const original = envelope.original;
        const originalType = envelope.originalType || 'P2P_CHAT_MESSAGE';
        const hops = Array.isArray(envelope.hops) ? envelope.hops : [];

        if (hops.length >= WEBRTC_RELAY_MAX_HOPS) {
          return { status: 'error', message: `relay hop limit exceeded (max ${WEBRTC_RELAY_MAX_HOPS})` };
        }

        const now = Date.now();
        const windowMs = 1000;
        let rate = this._webrtcRelayRate.get(fromPeerId);
        if (!rate || now - rate.windowStart >= windowMs) {
          rate = { count: 0, windowStart: now };
        }
        rate.count += 1;
        this._webrtcRelayRate.set(fromPeerId, rate);
        if (rate.count > WEBRTC_RELAY_MAX_PER_SEC) {
          return { status: 'error', message: 'relay rate limit exceeded' };
        }

        if (!original || (typeof original !== 'string' && !Buffer.isBuffer(original))) {
          return { status: 'error', message: 'envelope.original (string or Buffer) required' };
        }
        if (!RELAYABLE_ORIGINAL_TYPES.includes(originalType)) {
          return { status: 'error', message: `originalType not relayable: ${originalType}` };
        }

        try {
          const relayPayload = {
            original: typeof original === 'string' ? original : original.toString('base64'),
            originalType,
            hops: [...hops, { from: fromPeerId, at: now }]
          };
          const relayMsg = Message.fromVector(['P2P_RELAY', JSON.stringify(relayPayload)]);
          if (this._rootKey && this._rootKey.private) relayMsg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(relayMsg);
          }
          const p2pRelay = Message.fromVector(['P2P_RELAY', JSON.stringify(relayPayload)]).signWithKey(this.agent.key);
          this.agent.relayFrom('_webrtc', p2pRelay);
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] RelayFromWebRTC error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'relay failed' };
        }
      });

      const inboundFileTransfers = new Map();

      const persistIncomingDocument = async (doc, origin) => {
        const incomingBuffer = Buffer.from(doc.contentBase64, 'base64');
        if (this._validateDocumentSize(incomingBuffer)) {
          console.warn('[HUB] Dropping incoming file (too large):', doc.id);
          return;
        }

        const normalized = {
          id: doc.id,
          name: doc.name || 'received',
          mime: doc.mime || 'application/octet-stream',
          size: doc.size,
          sha256: doc.sha256 || doc.id,
          contentBase64: doc.contentBase64,
          created: doc.created || new Date().toISOString(),
          receivedFrom: origin && origin.name
        };

        await this.fs.publish(`documents/${normalized.id}.json`, normalized);
        this._state.documents = this._state.documents || {};
        this._state.documents[normalized.id] = {
          id: normalized.id,
          sha256: normalized.sha256,
          name: normalized.name,
          mime: normalized.mime,
          size: normalized.size,
          created: normalized.created
        };
        if (typeof pushNetworkStatus === 'function') pushNetworkStatus();
        const payload = JSON.stringify({ type: 'P2P_FILE_SEND', object: normalized });
        const msg = Message.fromVector(['FileMessage', payload]);
        if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
        if (typeof this.http.broadcast === 'function') this.http.broadcast(msg);
        this.recordActivity({
          type: 'Receive',
          object: {
            type: 'Document',
            id: normalized.id,
            name: normalized.name,
            mime: normalized.mime || 'application/octet-stream',
            size: normalized.size,
            sha256: normalized.sha256 || normalized.id,
            receivedFrom: normalized.receivedFrom || (origin && origin.name)
          }
        });
      };

      // Broadcast chat messages received from the P2P network to UI clients.
      // The UI Bridge will parse `ChatMessage` and append it to client-side state.
      this.agent.on('chat', (chat) => {
        try {
          const originPeer = chat && chat._origin ? String(chat._origin) : '';
          this._ingestOfferFromChatMessage(chat, originPeer);
          this._cacheChatMessage(chat);
          if (this.settings && this.settings.debug) {
            try {
              console.log('[HUB:CHAT]', JSON.stringify(chat));
            } catch (e) {
              console.log('[HUB:CHAT]', chat);
            }
          }

          const payload = typeof chat === 'string' ? chat : JSON.stringify(chat);
          const msg = Message.fromVector(['ChatMessage', payload]);
          if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(msg);
          }
        } catch (err) {
          console.error('[HUB] Failed to broadcast chat message:', err);
        }
      });

      // BitcoinBlock gossip is relayed peer-to-peer in @fabric/core Peer; no WebSocket fan-out unless we add a subscription later.
      this.agent.on('bitcoinBlock', ({ message, origin }) => {
        const from = origin && origin.name ? origin.name : '';
        let parsed = null;
        try {
          const raw = message && message.data != null
            ? (typeof message.data === 'string' ? message.data : String(message.data))
            : '';
          parsed = raw ? JSON.parse(raw) : null;
        } catch (e) {
          parsed = null;
        }
        if (this.settings && this.settings.debug) {
          console.debug('[HUB:P2P] BitcoinBlock from', from || '?', parsed || (message && message.data));
        }
        if (parsed && typeof parsed === 'object' && parsed.tip) {
          this._ingestP2pBitcoinBlockForFabricLog(parsed, from).catch(() => {});
        }
      });

      // Fabric P2P ChainSyncRequest: inventory exchange + replay BitcoinBlock messages from this hub's log.
      this.agent.on('chainSyncRequest', (ev) => {
        const originConn = ev && ev.origin && ev.origin.name;
        const object = ev && ev.object && typeof ev.object === 'object' ? ev.object : {};
        if (!originConn) return;
        this._fabricPeerResyncRespondToRequest(originConn, object).catch((err) => {
          console.error('[HUB] chainSyncRequest handler error:', err && err.stack ? err.stack : err);
        });
      });

      // Broadcast P2P_PEER_GOSSIP and P2P_PEERING_OFFER from Fabric P2P to WebSocket clients.
      // Enables cross-cluster discovery for WebRTC and Fabric peers.
      const broadcastPeeringMessage = (ev) => {
        try {
          const message = ev && ev.message;
          if (!message || typeof message !== 'object') return;
          const payload = JSON.stringify(message);
          const msg = Message.fromVector(['GenericMessage', payload]);
          if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') {
            this.http.broadcast(msg);
          }
        } catch (err) {
          console.error('[HUB] Failed to broadcast peering message:', err);
        }
      };
      this.agent.on('peeringGossip', broadcastPeeringMessage);
      this.agent.on('peeringOffer', broadcastPeeringMessage);

      // Handle files received from peers via P2P_FILE_SEND. Store and broadcast to clients.
      this.agent.on('file', async ({ message, origin }) => {
        try {
          const obj = message && message.object;
          if (!obj || !obj.contentBase64 || !obj.id) return;

          const myFabricId = this.agent.identity && this.agent.identity.id ? String(this.agent.identity.id) : '';
          if (inventoryRelay.shouldForwardP2pFileChunk(obj, myFabricId)) {
            const deliveryFabricId = String(obj.deliveryFabricId).trim();
            const nextTtl = inventoryRelay.decrementedFileRelayTtl(obj, 16);
            if (nextTtl === null) {
              console.warn('[HUB] P2P_FILE_SEND relay: TTL exhausted or missing');
              return;
            }
            const nextAddr = this._resolvePeerAddress(deliveryFabricId);
            const originAddr = origin && origin.name;
            if (nextAddr && this.agent.connections[nextAddr] && String(nextAddr) !== String(originAddr)) {
              try {
                const fwdObj = { ...obj, fileRelayTtl: nextTtl };
                const fwd = { type: 'P2P_FILE_SEND', actor: message.actor, object: fwdObj };
                this._sendVectorToPeer(nextAddr, ['P2P_FILE_SEND', JSON.stringify(fwd)]);
              } catch (relayErr) {
                console.warn('[HUB] P2P_FILE_SEND relay failed:', relayErr && relayErr.message ? relayErr.message : relayErr);
              }
            } else {
              console.warn('[HUB] P2P_FILE_SEND relay: next hop unavailable for', deliveryFabricId);
            }
            return;
          }

          // Best-effort cleanup of stale/incomplete transfers.
          const now = Date.now();
          for (const [transferId, state] of inboundFileTransfers.entries()) {
            if (!state || !state.updatedAt || (now - state.updatedAt) > P2P_FILE_CHUNK_TTL_MS) {
              inboundFileTransfers.delete(transferId);
            }
          }

          const part = obj.part;
          const isChunked = part &&
            part.transferId &&
            Number.isInteger(part.index) &&
            Number.isInteger(part.total) &&
            part.total > 0;

          if (!isChunked) {
            await persistIncomingDocument(obj, origin);
            return;
          }

          const transferId = String(part.transferId);
          if (part.total > 65536 || part.index < 0 || part.index >= part.total) {
            console.warn('[HUB] Dropping invalid file chunk metadata:', transferId, part);
            return;
          }

          let transfer = inboundFileTransfers.get(transferId);
          if (!transfer) {
            transfer = {
              id: obj.id,
              name: obj.name,
              mime: obj.mime,
              size: obj.size,
              sha256: obj.sha256,
              created: obj.created,
              total: part.total,
              chunks: new Array(part.total),
              received: 0,
              updatedAt: now
            };
            inboundFileTransfers.set(transferId, transfer);
          }

          if (transfer.total !== part.total) {
            console.warn('[HUB] Dropping inconsistent file chunk transfer metadata:', transferId);
            inboundFileTransfers.delete(transferId);
            return;
          }

          transfer.updatedAt = now;
          if (typeof transfer.chunks[part.index] === 'undefined') {
            transfer.chunks[part.index] = String(obj.contentBase64);
            transfer.received += 1;
          }

          if (transfer.received < transfer.total) return;

          const completeBuffer = Buffer.concat(transfer.chunks.map((chunk) => Buffer.from(chunk, 'base64')));
          const completeContentBase64 = completeBuffer.toString('base64');
          inboundFileTransfers.delete(transferId);

          await persistIncomingDocument({
            id: transfer.id || obj.id,
            name: transfer.name || obj.name,
            mime: transfer.mime || obj.mime,
            size: transfer.size || obj.size,
            sha256: transfer.sha256 || obj.sha256 || obj.id,
            created: transfer.created || obj.created,
            contentBase64: completeContentBase64
          }, origin);
        } catch (err) {
          console.error('[HUB] Failed to handle received file:', err);
        }
      });

      // Handle inventory requests from peers and respond with local inventory.
      this.agent.on('inventory', async ({ message, origin }) => {
        try {
          if (!message || !message.object) return;
          const kind = String(message.object.kind || '').trim().toLowerCase();
          if (!kind) return;

          const logicalSeller = message.target != null ? String(message.target).trim() : '';
          const myId = this.agent.identity && this.agent.identity.id;
          if (logicalSeller && myId && logicalSeller !== myId) {
            let ttl = Number(message.object.inventoryRelayTtl);
            if (!Number.isFinite(ttl)) ttl = 6;
            if (ttl <= 0) {
              console.warn('[HUB] INVENTORY_REQUEST dropped: relay TTL exhausted');
              return;
            }
            const forwardAddr = this._resolvePeerAddress(logicalSeller);
            const originAddr = origin && (origin.name || origin.address || origin.id);
            if (
              forwardAddr && this.agent.connections[forwardAddr] &&
              String(forwardAddr) !== String(originAddr)
            ) {
              try {
                const fwd = {
                  type: message.type,
                  actor: message.actor,
                  target: message.target,
                  object: { ...message.object, inventoryRelayTtl: ttl - 1 }
                };
                this._sendGenericFabricEnvelopeToPeer(forwardAddr, fwd);
                if (this.settings && this.settings.debug) {
                  console.debug('[HUB] INVENTORY_REQUEST relayed toward', logicalSeller, 'via', forwardAddr);
                }
              } catch (relayErr) {
                console.warn('[HUB] INVENTORY_REQUEST relay failed:', relayErr && relayErr.message ? relayErr.message : relayErr);
              }
              return;
            }
            // Relay target not connected yet (common while multiple peers connect at once); drop quietly.
            return;
          }

          const targetId = message.actor && message.actor.id;
          let items = [];
          if (kind === 'documents') {
            items = this._collectLocalDocumentInventoryItems();
          } else if (kind === 'mainchain') {
            const summary = await this._collectLocalMainchainInventorySummary();
            if (summary) items = [summary];
          } else if (kind === 'mainchain-blocks') {
            const bitcoin = this._getBitcoinService();
            const requested = Array.isArray(message.object.hashes) ? message.object.hashes : [];
            const hashes = [...new Set(requested
              .map((h) => String(h || '').trim().toLowerCase())
              .filter((h) => this._isHex64(h)))].slice(0, 32);
            if (bitcoin && typeof bitcoin._makeRPCRequest === 'function') {
              for (const hash of hashes) {
                try {
                  const blockHex = await bitcoin._makeRPCRequest('getblock', [hash, 0]);
                  let height = undefined;
                  try {
                    const header = await bitcoin._makeRPCRequest('getblockheader', [hash]);
                    if (header && Number.isFinite(Number(header.height))) height = Number(header.height);
                  } catch (_) {}
                  if (typeof blockHex === 'string' && blockHex.trim()) {
                    items.push({
                      hash,
                      hex: blockHex.trim(),
                      ...(Number.isFinite(height) ? { height } : {})
                    });
                  }
                } catch (_) {}
              }
            }
          } else {
            return;
          }

          const originConn = origin && (origin.name || origin.address || origin.id);
          const requesterFabricId = message.actor && message.actor.id;
          let htlcDirectConn = null;
          let relayReturnHop = null;
          if (originConn && requesterFabricId && this._originConnectionIsFabricPeer(originConn, requesterFabricId)) {
            htlcDirectConn = originConn;
          } else if (originConn) {
            relayReturnHop = originConn;
          }
          if (kind === 'documents') {
            items = await this._attachHtlcToInventoryItems(items, message, htlcDirectConn, requesterFabricId, relayReturnHop);
          }

          const responsePayload = {
            type: 'INVENTORY_RESPONSE',
            actor: { id: this.agent.identity.id },
            object: {
              kind,
              items,
              created: Date.now()
            },
            target: targetId
          };

          const originAddress = originConn;
          if (originAddress && this.agent.connections[originAddress]) {
            this._sendGenericFabricEnvelopeToPeer(originAddress, responsePayload);
          } else if (typeof this.agent.relay === 'function') {
            // Fallback: relay to all peers (for older Peer implementations that support relay)
            const reply = Message.fromVector(['GenericMessage', JSON.stringify(responsePayload)]).signWithKey(this.agent.key);
            this.agent.relay(reply);
          } else {
            // As a last resort, iterate connections and write directly.
            try {
              const reply = Message.fromVector(['GenericMessage', JSON.stringify(responsePayload)]).signWithKey(this.agent.key);
              const buf = reply.toBuffer();
              for (const sock of Object.values(this.agent.connections || {})) {
                if (sock && typeof sock._writeFabric === 'function') {
                  sock._writeFabric(buf);
                }
              }
            } catch (e) {
              console.warn('[HUB] Could not broadcast inventory reply via fallback:', e);
            }
          }

          // Also broadcast the inventory response to all WebSocket clients so
          // browser Bridges can update their per-peer inventories.
          try {
            const payload = JSON.stringify(responsePayload);
            const wsMsg = Message.fromVector(['GenericMessage', payload]);
            if (this._rootKey && this._rootKey.private) wsMsg.signWithKey(this._rootKey);
            if (typeof this.http.broadcast === 'function') {
              this.http.broadcast(wsMsg);
            }
          } catch (broadcastErr) {
            console.error('[HUB] Failed to broadcast inventory response to clients:', broadcastErr);
          }
        } catch (err) {
          console.error('[HUB] Failed to handle inventory request:', err);
        }
      });

      // When this node requested a remote inventory (or relays a response), Fabric delivers INVENTORY_RESPONSE here.
      this.agent.on('inventoryResponse', async ({ message, origin }) => {
        try {
          if (!message || message.type !== 'INVENTORY_RESPONSE' || !message.object) return;
          const kind = String((message.object && message.object.kind) || '').trim().toLowerCase();
          if (!kind) return;
          if (!['documents', 'mainchain', 'mainchain-blocks'].includes(kind)) return;
          const obj = message.object && typeof message.object === 'object' ? message.object : null;
          const isFabricResync = !!(obj && obj.fabricResync);

          // ChainSync catalog sync: response is already on the correct TCP session — never treat `target`
          // as an HTLC relay hop. A strict buyerId !== myId check can drop the merge when id strings differ
          // (encoding/normalization) and hub 6 never lists the anchor's published doc.
          if (!isFabricResync) {
            const buyerId = message.target != null ? String(message.target).trim() : '';
            const rawMyId = this.agent.identity && this.agent.identity.id;
            const myId = rawMyId != null && String(rawMyId).trim() !== '' ? String(rawMyId).trim() : '';
            if (buyerId && myId && buyerId !== myId) {
              const nextAddr = this._resolvePeerAddress(buyerId);
              if (nextAddr && this.agent.connections[nextAddr]) {
                try {
                  this._sendGenericFabricEnvelopeToPeer(nextAddr, message);
                } catch (relayErr) {
                  console.warn('[HUB] INVENTORY_RESPONSE relay failed:', relayErr && relayErr.message ? relayErr.message : relayErr);
                }
              } else {
                console.warn('[HUB] INVENTORY_RESPONSE cannot relay to buyer', buyerId);
              }
              return;
            }
          }
          if (kind === 'documents' && obj && obj.fabricResync && Array.isArray(obj.items)) {
            try {
              this._mergeFabricResyncInventoryItems(obj.items);
            } catch (mergeErr) {
              console.error('[HUB] fabricResync inventory merge failed:', mergeErr && mergeErr.message ? mergeErr.message : mergeErr);
            }
          }
          if (kind === 'mainchain' && Array.isArray(obj && obj.items) && obj.items.length) {
            const summary = obj.items[0] && typeof obj.items[0] === 'object' ? obj.items[0] : null;
            const peerHeight = summary && Number.isFinite(Number(summary.height)) ? Number(summary.height) : -1;
            const peerHashes = summary && Array.isArray(summary.recentHashes) ? summary.recentHashes : [];
            if (peerHeight >= 0) {
              const local = await this._collectLocalMainchainInventorySummary();
              const localHeight = local && Number.isFinite(Number(local.height)) ? Number(local.height) : -1;
              if (localHeight >= 0 && peerHeight > localHeight) {
                const missing = [];
                for (const h of peerHashes) {
                  const hash = String(h || '').trim().toLowerCase();
                  if (!this._isHex64(hash)) continue;
                  try {
                    const bitcoin = this._getBitcoinService();
                    if (!bitcoin || typeof bitcoin._makeRPCRequest !== 'function') break;
                    await bitcoin._makeRPCRequest('getblockheader', [hash]);
                  } catch (_) {
                    missing.push(hash);
                  }
                }
                if (missing.length) {
                  const from = origin && (origin.name || origin.address || origin.id)
                    ? (origin.name || origin.address || origin.id)
                    : (message.actor && message.actor.id);
                  this._enqueueWorkItem({
                    id: `mainchain:missing:${(message.actor && message.actor.id) || from || 'peer'}:${missing.join(',')}`,
                    type: 'document-offer-block-download',
                    sourcePeer: from || '',
                    valueSats: Number(summary && summary.rewardSats) > 0 ? Number(summary.rewardSats) : 1,
                    payload: { blockHashes: missing }
                  });
                  await this._requestMainchainBlocksFromPeer(from, missing);
                }
              }
            }
          }
          if (kind === 'mainchain-blocks' && Array.isArray(obj && obj.items) && obj.items.length) {
            await this._applyMainchainBlocksFromInventoryItems(obj.items);
            this._bitcoinStatusCache = { value: null, updatedAt: 0 };
            await this._collectBitcoinStatus({ force: true }).catch(() => null);
          }
          const payload = JSON.stringify(message);
          const wsMsg = Message.fromVector(['GenericMessage', payload]);
          if (this._rootKey && this._rootKey.private) wsMsg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') this.http.broadcast(wsMsg);
        } catch (e) {
          console.error('[HUB] inventoryResponse fan-out failed:', e);
        }
      });

      await this.agent.start();
      await this.http.start();

      // @fabric/http `start()` registers default RegisterWebRTCPeer / ListWebRTCPeers (JSON-RPC).
      // Re-bind Hub's mesh registry + candidate logic so POST /services/rpc does not use the stock handlers.
      this.http._registerMethod('RegisterWebRTCPeer', (...params) => {
        const info = params[0] || {};
        const peerId = info.peerId;
        if (!peerId) return { status: 'error', message: 'peerId required' };

        console.debug('[HUB] RegisterWebRTCPeer:', peerId);

        // Ensures a registry entry for this peer id (Bridge registers on load);
        // augments metadata and lastSeen for ListWebRTCPeers / mesh discovery.
        const existing = this.http.webrtcPeers.get(peerId);
        const now = Date.now();
        if (existing) {
          existing.metadata = info.metadata || existing.metadata;
          existing.registeredAt = now;
          existing.lastSeen = now;
          this.http.webrtcPeers.set(peerId, existing);
        } else {
          this.http.webrtcPeers.set(peerId, {
            id: peerId,
            connectedAt: now,
            status: 'registered',
            metadata: info.metadata || {},
            registeredAt: now,
            lastSeen: now,
            meshSessionCount: 0
          });
        }
        const cur = this.http.webrtcPeers.get(peerId);
        if (cur && (cur.meshSessionCount == null || Number.isNaN(Number(cur.meshSessionCount)))) {
          cur.meshSessionCount = 0;
          this.http.webrtcPeers.set(peerId, cur);
        }

        pushNetworkStatus();
        return { status: 'success', peerId };
      });

      this.http._registerMethod('ListWebRTCPeers', (...params) => {
        const options = params[0] || {};
        const excludeSelf = options.excludeSelf !== false;
        const requestingPeerId = options.peerId;
        const now = Date.now();
        const maxAgeMs = Number(this.settings.webrtcPeerMaxAgeMs || 2 * 60 * 1000);
        const maxCandidates = Number(this.settings.webrtcPeerCandidateLimit || 16);

        // Keep the requesting peer active while it continues polling.
        if (requestingPeerId && this.http.webrtcPeers.has(requestingPeerId)) {
          const self = this.http.webrtcPeers.get(requestingPeerId);
          self.lastSeen = now;
          if (!self.registeredAt) self.registeredAt = now;
          if (!self.connectedAt) self.connectedAt = now;
          this.http.webrtcPeers.set(requestingPeerId, self);
        }

        // Prune stale browser peer registrations so dead sessions do not crowd
        // candidate selection for active clients.
        for (const [id, entry] of this.http.webrtcPeers.entries()) {
          if (!entry || typeof entry !== 'object') {
            this.http.webrtcPeers.delete(id);
            continue;
          }
          const seenAt = Number(entry.lastSeen || entry.registeredAt || entry.connectedAt || 0);
          if (!seenAt || (now - seenAt) > maxAgeMs) {
            this.http.webrtcPeers.delete(id);
          }
        }

        const peers = this.http.webrtcPeerList || [];
        const filtered = excludeSelf && requestingPeerId
          ? peers.filter(p => p.id !== requestingPeerId)
          : peers;

        console.debug('[HUB] ListWebRTCPeers:', filtered.length, 'peers available');

        return {
          type: 'ListWebRTCPeersResult',
          peers: filtered
            .sort((a, b) => {
              const bSeen = Number(b.lastSeen || b.registeredAt || b.connectedAt || 0);
              const aSeen = Number(a.lastSeen || a.registeredAt || a.connectedAt || 0);
              return bSeen - aSeen;
            })
            .slice(0, maxCandidates)
            .map(p => ({
            id: p.id,
            peerId: p.id,
            connectedAt: p.connectedAt,
            lastSeen: Number(p.lastSeen || p.registeredAt || p.connectedAt || 0) || undefined,
            registeredAt: Number(p.registeredAt || p.connectedAt || 0) || undefined,
            status: p.status,
            metadata: p.metadata,
            meshSessionCount: Number(p.meshSessionCount || 0) || 0
          }))
        };
      });

      this._loadWorkQueueStrategyFromSettings();
      this._ensureWorker();
      if (!this._workQueueTimer) {
        this._workQueueTimer = setInterval(() => {
          this._drainWorkQueue().catch(() => {});
        }, 2000);
      }
      await this.startBeacon();

      // Local State
      this._state.status = 'STARTED';

      // Alert message
      await this.alert(`Hub HTTP service started.  Agent ID: ${this.id}`);

      return this;
    } catch (err) {
      console.error('[HUB:STARTUP:ERROR]', err && err.stack ? err.stack : err);
      throw err;
    }
  }

  /**
   * Stop the instance.
   * @returns {Hub} Instance of the {@link Hub}.
   */
  async stop () {
    if (this._stopPromise) return this._stopPromise;

    const stopWork = async () => {
      this._state.status = 'STOPPING';

      // Detach network-status listeners and peering offer timer before stopping subsystems.
      if (this._fabricPeeringOfferIntervalId) {
        try {
          clearInterval(this._fabricPeeringOfferIntervalId);
          this._fabricPeeringOfferIntervalId = null;
        } catch (e) {}
      }
      if (this._workQueueTimer) {
        try {
          clearInterval(this._workQueueTimer);
          this._workQueueTimer = null;
        } catch (e) {}
      }
      if (this._pushNetworkStatus) {
        try {
          this.agent.removeListener('connections:open', this._pushNetworkStatus);
          this.agent.removeListener('connections:close', this._pushNetworkStatus);
        } catch (e) {}
        try {
          this.http.removeListener('webrtc:connection', this._pushNetworkStatus);
          this.http.removeListener('webrtc:disconnect', this._pushNetworkStatus);
        } catch (e) {}
      }

      if (this.http && typeof this.http.stop === 'function') {
        try {
          await this.http.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop HTTP cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.agent && typeof this.agent.stop === 'function') {
        // Avoid late async peer-registry writes while the DB is closing.
        try {
          this.agent.settings.peersDb = null;
          if (this.agent._peerRegistrySaveScheduled) clearTimeout(this.agent._peerRegistrySaveScheduled);
          this.agent._peerRegistrySaveScheduled = null;
          if (typeof this.agent._savePeerRegistry === 'function') this.agent._savePeerRegistry = () => {};
        } catch (e) {}
        try {
          await this.agent.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Agent cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.beacon && typeof this.beacon.stop === 'function') {
        try {
          await this.beacon.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Beacon cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.lightning && typeof this.lightning.stop === 'function') {
        try {
          await this.lightning.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Lightning cleanly:', err && err.message ? err.message : err);
        }
        this.lightning = null;
      }

      if (this.bitcoin && typeof this.bitcoin.stop === 'function') {
        try {
          await this.bitcoin.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Bitcoin service cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.payjoin && typeof this.payjoin.stop === 'function') {
        try {
          await this.payjoin.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Payjoin service cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.email && typeof this.email.stop === 'function') {
        try {
          await this.email.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Email service cleanly:', err && err.message ? err.message : err);
        }
      }

      if (this.chain && typeof this.chain.stop === 'function') {
        try {
          await this.chain.stop();
        } catch (err) {
          console.warn('[HUB] Failed to stop Chain cleanly:', err && err.message ? err.message : err);
        }
      }

      this._state.status = 'STOPPED';
      return this;
    };

    const timeoutMs = Math.max(1000, Number(this.settings.shutdownTimeoutMs || 10000));
    this._stopPromise = Promise.race([
      stopWork(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Hub stop timeout after ${timeoutMs}ms`)), timeoutMs);
      })
    ]).finally(() => {
      this._stopPromise = null;
    });

    return this._stopPromise;
  }

}

module.exports = Hub;
