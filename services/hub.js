'use strict';

// Dependencies
const merge = require('lodash.merge');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58check = require('bs58check');

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
const Actor = require('@fabric/core/types/actor');
const Entity = require('@fabric/core/types/entity');
const Tree = require('@fabric/core/types/tree');
const Bitcoin = require('@fabric/core/services/bitcoin');
const Lightning = require('@fabric/core/services/lightning');
const Beacon = require('../contracts/beacon');
const PayjoinService = require('../services/payjoin');

// Fabric HTTP
const HTTPServer = require('@fabric/http/types/server');
const { P2P_PEERING_OFFER, P2P_PEER_GOSSIP, MAX_PEERS } = require('@fabric/core/constants');

// Hard limits and validation patterns
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // 8 MiB per document/file payload
const DEFAULT_DISTRIBUTE_FEE_SATS = Number(process.env.FABRIC_DISTRIBUTE_FEE_SATS || 1000);
const MAX_ADDRESS_LENGTH = 256;
const PEER_ADDRESS_RE = /^[^:]+:\d+$/;
const P2P_FILE_CHUNK_BYTES = 1024 * 1024; // exact 1 MiB binary chunks
const P2P_FILE_CHUNK_TTL_MS = 10 * 60 * 1000; // expire incomplete inbound transfers after 10 minutes
const FABRIC_PEERING_OFFER_INTERVAL_MS = Number(process.env.FABRIC_PEERING_OFFER_INTERVAL_MS || 30000);

// Hub Services
const Fabric = require('../services/fabric');
const SetupService = require('../services/setup');
// const Queue = require('../types/queue');

// Routes (Request Handlers)
const ROUTES = require('../routes');

/**
   * Defines the Hub service, known as `@fabric/hub` within the network.
   *
   * NOTE: the Hub currently exposes its JSON-RPC surface (WebSocket `/rpc`
   * and HTTP `/rpc`) without authentication. It is intended to run in
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
        username: process.env.FABRIC_BITCOIN_USERNAME || process.env.BITCOIN_RPC_USER || '',
        password: process.env.FABRIC_BITCOIN_PASSWORD || process.env.BITCOIN_RPC_PASS || '',
        debug: false,
        startTimeoutMs: Number(process.env.FABRIC_BITCOIN_START_TIMEOUT_MS || 10000)
      },
      payjoin: {
        enable: process.env.FABRIC_PAYJOIN_ENABLE ? process.env.FABRIC_PAYJOIN_ENABLE !== 'false' : true,
        endpointBasePath: process.env.FABRIC_PAYJOIN_BASE_PATH || '/services/bitcoin/payjoin',
        defaultSessionTTLSeconds: Number(process.env.FABRIC_PAYJOIN_SESSION_TTL_SECONDS || 1800),
        maxOpenSessions: Number(process.env.FABRIC_PAYJOIN_MAX_OPEN_SESSIONS || 256)
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
        documentChains: {},
        collections: {
          documents: {},
          people: {},
          contracts: {},
          messages: {},
          merkle: {}
        },
        counts: {
          documents: 0,
          people: 0,
          messages: 0
        },
        services: {
          bitcoin: {
            balance: 0
          },
          payjoin: {
            available: false,
            sessions: 0
          },
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

    // Regtest runs in one autonomous mode: managed local bitcoind, unless setup chose external.
    const inputBitcoin = settings && settings.bitcoin ? settings.bitcoin : {};
    const rpcportProvided = Object.prototype.hasOwnProperty.call(inputBitcoin, 'rpcport');
    if (this.settings.bitcoin && this.settings.bitcoin.network === 'regtest' && this.settings.bitcoin.managed !== false) {
      this.settings.bitcoin.managed = true;
      if (!rpcportProvided) this.settings.bitcoin.rpcport = 20444;
    }

    // Vector Clock
    this.clock = this.settings.clock;

    // Root Key
    this._rootKey = new Key(this.settings.key);

    // Internals
    this.agent = new Peer(this.settings);
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
    this._lightningRpcQueue = Promise.resolve();
    this.beacon = null;
    this._bitcoinStatusCache = { value: null, updatedAt: 0 };
    this._bitcoinCacheTTL = 15000;
    // Pending pay-to-distribute requests: documentId -> { address, amountSats, config, createdAt }
    this._distributeRequests = {};

    // Best-effort Bitcoin service initialization. The Hub keeps running even
    // when bitcoind is offline, but exposes status/errors via the upstream API.
    if (this.settings.bitcoin && this.settings.bitcoin.enable !== false) {
      try {
        const zmqPort = Number(this.settings.bitcoin.zmqPort || 29500);
        this.bitcoin = new Bitcoin({
          ...this.settings.bitcoin,
          debug: this.settings.bitcoin.debug !== undefined ? this.settings.bitcoin.debug : !!this.settings.debug,
          key: { xprv: this._rootKey.xprv },
          // Regtest: no P2P listening, no DNS seeds (avoids ip_resolver / "Operation not permitted" in restricted envs)
          ...(this.settings.bitcoin.network === 'regtest' && this.settings.bitcoin.managed
            ? { listen: false, bitcoinExtraParams: ['-dnsseed=0'] }
            : {}),
          // ZMQ for real-time block/tx notifications (bitcoind started with -zmqpubhashblock etc. on this port)
          ...(this.settings.bitcoin.managed ? { zmq: { host: '127.0.0.1', port: zmqPort } } : {})
        });
        // Managed regtest: single RPC probe candidate and shorter wait-for-RPC polling so we fit within startTimeoutMs
        if (this.settings.bitcoin.managed && this.settings.bitcoin.network === 'regtest') {
          const rpcport = Number(this.settings.bitcoin.rpcport || 20444);
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
    this.services = {};
    this.sources = {};
    this.workers = [];
    this._stopPromise = null;
    this.changes = new Logger({
      name: 'hub.fabric.pub',
      path: './stores'
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
    this.setup = new SetupService({ fs: this.fs, key: this._rootKey });

    // HTTP Server
    this.http = new HTTPServer({
      name: 'hub.fabric.pub',
      path: 'assets',
      hostname: this.settings.http.hostname,
      interface: this.settings.http.interface,
      port: this.settings.http.port,
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

  _getCollectionMap (name) {
    this._state.content = this._state.content || {};
    this._state.content.collections = this._state.content.collections || {};
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
    const required = new Set(['documents', 'contracts', 'messages']);

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

    // Backward-compatible alias while moving to collections-first storage.
    this._state.content.contracts = this._state.content.collections.contracts;
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

  async _ensureGenesisMessage () {
    this._state.content = this._state.content || {};
    this._state.content.counts = this._state.content.counts || {};
    const map = this._getCollectionMap('messages');
    const existing = Object.values(map).find((entry) => entry && entry.type === 'GENESIS_MESSAGE');
    if (existing) {
      this._state.content.genesisMessage = existing.id;
      this._buildMessageTreeFromLog();
      return existing;
    }

    // Fresh state: use regular append flow so all persistence hooks apply.
    if (Object.keys(map).length === 0) {
      const created = await this._appendFabricMessage('GENESIS_MESSAGE', {
        service: '@fabric/hub',
        created: new Date().toISOString()
      });
      this._state.content.genesisMessage = created.id;
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
    this._state.content.genesisMessage = id;
    this._buildMessageTreeFromLog();
    return map[id];
  }

  _getDocumentChains () {
    this._state.content = this._state.content || {};
    if (!this._state.content.documentChains || typeof this._state.content.documentChains !== 'object') {
      this._state.content.documentChains = {};
    }
    return this._state.content.documentChains;
  }

  _buildDocumentPublishPayload (meta = {}) {
    return {
      id: meta.id,
      lineage: meta.lineage || meta.id,
      name: meta.name,
      mime: meta.mime,
      size: meta.size,
      sha256: meta.sha256 || meta.id,
      created: meta.created || new Date().toISOString(),
      parent: meta.parent || null,
      revision: Number(meta.revision || 1),
      published: meta.published || null
    };
  }

  _buildDocumentChainMerkle (chain) {
    const entries = Object.values((chain && chain.messages) || {})
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
    const leaves = entries.map((entry) => JSON.stringify({
      seq: entry.seq,
      type: entry.type,
      payload: entry.payload
    }));
    const tree = new Tree({ leaves });
    const root = tree && tree.root ? tree.root : null;
    chain.merkle = {
      leaves: leaves.length,
      root: Buffer.isBuffer(root) ? root.toString('hex') : (root ? String(root) : null)
    };
    chain.tip = entries.length ? entries[entries.length - 1].id : null;
    return chain.merkle.root;
  }

  async _appendDocumentChainMessage (lineageInput, type, payload = {}, options = {}) {
    const lineage = String(lineageInput || payload.lineage || payload.id || '');
    if (!lineage) return null;

    const chains = this._getDocumentChains();
    let chain = chains[lineage];
    if (!chain || typeof chain !== 'object') {
      chain = {
        id: lineage,
        lineage,
        created: new Date().toISOString(),
        counts: { messages: 0 },
        messages: {},
        merkle: { leaves: 0, root: null },
        tip: null
      };
      chains[lineage] = chain;
    }

    chain.counts = chain.counts || { messages: 0 };
    chain.messages = chain.messages || {};

    // Enforce DOCUMENT_PUBLISH as the first entry in each document chain.
    if (Number(chain.counts.messages || 0) === 0 && String(type) !== 'DOCUMENT_PUBLISH') {
      const publishPayload = options.publishPayload || this._buildDocumentPublishPayload(payload);
      await this._appendDocumentChainMessage(lineage, 'DOCUMENT_PUBLISH', publishPayload, {});
    }

    // Never add more than one DOCUMENT_PUBLISH event per lineage.
    if (String(type) === 'DOCUMENT_PUBLISH') {
      const existingPublish = Object.values(chain.messages).find((entry) => entry && entry.type === 'DOCUMENT_PUBLISH');
      if (existingPublish) {
        return existingPublish;
      }
    }

    const now = new Date().toISOString();
    const nextSeq = Number(chain.counts.messages || 0) + 1;
    const base = {
      seq: nextSeq,
      type: String(type),
      payload: Object.assign({}, payload, { lineage }),
      created: now
    };
    const id = new Actor({ content: base }).id;
    chain.messages[id] = Object.assign({ id }, base);
    chain.counts.messages = nextSeq;
    this._buildDocumentChainMerkle(chain);

    if (this.fs && typeof this.fs.publish === 'function') {
      try {
        await this.fs.publish(`documents/${lineage}.chain.json`, chain);
      } catch (err) {
        console.error('[HUB] Failed to persist document chain:', err && err.message ? err.message : err);
      }
    }

    return chain.messages[id];
  }

  async _ensureDocumentChainsFromState () {
    const docs = Object.values(this._state.documents || {}).filter((doc) => doc && doc.id);
    if (!docs.length) return;

    const grouped = {};
    for (const doc of docs) {
      const lineage = String(doc.lineage || doc.id);
      grouped[lineage] = grouped[lineage] || [];
      grouped[lineage].push(doc);
    }

    const chains = this._getDocumentChains();
    for (const [lineage, revisions] of Object.entries(grouped)) {
      const existing = chains[lineage];
      if (existing && existing.counts && Number(existing.counts.messages || 0) > 0) continue;

      const ordered = revisions.slice().sort((a, b) => {
        const ra = Number(a.revision || 1);
        const rb = Number(b.revision || 1);
        if (ra !== rb) return ra - rb;
        const ta = new Date(a.created || 0).getTime();
        const tb = new Date(b.created || 0).getTime();
        return ta - tb;
      });

      const first = ordered[0];
      await this._appendDocumentChainMessage(lineage, 'DOCUMENT_PUBLISH', this._buildDocumentPublishPayload(first));
      for (let i = 1; i < ordered.length; i++) {
        const doc = ordered[i];
        await this._appendDocumentChainMessage(lineage, 'DOCUMENT_EDIT', {
          id: doc.id,
          lineage,
          parent: doc.parent || null,
          revision: Number(doc.revision || (i + 1)),
          edited: doc.edited || doc.created || null,
          name: doc.name,
          mime: doc.mime,
          size: doc.size,
          sha256: doc.sha256 || doc.id
        });
      }
    }
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
    this._state.content.fabricMessageTree = {
      leaves: leaves.length,
      root: rootHex
    };
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
    const documentChains = this._getDocumentChains();
    const normalizedChains = {};
    for (const [lineage, chain] of Object.entries(documentChains || {})) {
      normalizedChains[lineage] = {
        id: chain && chain.id ? chain.id : lineage,
        tip: chain && chain.tip ? chain.tip : null,
        root: chain && chain.merkle ? chain.merkle.root : null,
        messages: chain && chain.counts ? Number(chain.counts.messages || 0) : 0
      };
    }
    const beaconRoot = (this.beacon && typeof this.beacon.merkleRoot === 'string') ? this.beacon.merkleRoot : null;
    return {
      documents: this._computeMerkleRootForMap(this._state.documents || {}, 'Document'),
      publishedDocuments: this._computeMerkleRootForMap(collections.documents || {}, 'PublishedDocument'),
      contracts: this._computeMerkleRootForMap(collections.contracts || {}, 'Contract'),
      documentChains: this._computeMerkleRootForMap(normalizedChains, 'DocumentChain'),
      fabricMessages: messageRoot,
      beacon: beaconRoot
    };
  }

  _refreshMerkleState (reason = 'update') {
    this._ensureResourceCollections();
    this._state.content.collections.merkle = this._state.content.collections.merkle || {};

    const roots = this._computeMerkleRoots();
    const rootsId = crypto.createHash('sha256').update(JSON.stringify(roots)).digest('hex');
    const now = new Date().toISOString();

    this._state.content.merkle = {
      id: rootsId,
      updatedAt: now,
      roots
    };

    const history = this._state.content.collections.merkle;
    if (!history[rootsId]) {
      history[rootsId] = {
        id: rootsId,
        created: now,
        reason,
        roots
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
      this._state.content.collections.merkle = compacted;
    }

    return this._state.content.merkle;
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

  // TODO: upstream
  _addAllRoutes () {
    return this.http._addAllRoutes();
  }

  // TODO: upstream to @fabric/http (deprecate, should already exist there)
  _addRoute (options) {
    this.http._addRoute(options.method, options.route, options.handler);
    return this;
  }

  _handleContractListRequest (req, res, next) {
    return res.send({ status: 'error', message: 'Not yet implemented.' });
  }

  _handleContractViewRequest (req, res, next) {
    return res.send({ status: 'error', message: 'Not yet implemented.' });
  }

  _getBitcoinService () {
    return this.bitcoin || null;
  }

  _getPayjoinService () {
    if (!this.payjoin) return null;
    if (this.settings && this.settings.payjoin && this.settings.payjoin.enable === false) return null;
    return this.payjoin;
  }

  /**
   * Verify that a transaction pays at least amountSats to the given address.
   * @param {Object} bitcoin - Bitcoin service instance
   * @param {string} txid - Transaction ID
   * @param {string} address - Expected recipient address
   * @param {number} amountSats - Minimum amount in satoshis
   * @returns {Promise<boolean>}
   */
  async _verifyL1Payment (bitcoin, txid, address, amountSats) {
    try {
      const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txid, true]);
      if (!tx || !Array.isArray(tx.vout)) return false;
      const amountBTC = amountSats / 100000000;
      let received = 0;
      for (const vout of tx.vout) {
        const addr = vout.scriptPubKey && vout.scriptPubKey.address;
        if (addr === address) received += Number(vout.value || 0);
      }
      return received >= amountBTC;
    } catch (err) {
      console.error('[HUB] _verifyL1Payment error:', err);
      return false;
    }
  }

  _jsonOrShell (req, res, onJSON) {
    return res.format({
      html: () => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(this.applicationString);
      },
      json: async () => {
        try {
          await onJSON();
        } catch (error) {
          res.status(500).json({
            status: 'error',
            message: error && error.message ? error.message : String(error)
          });
        }
      }
    });
  }

  /** Always return JSON (no Accept negotiation). Use for API-only routes like /settings. */
  _jsonOnly (req, res, onJSON) {
    return (async () => {
      try {
        await onJSON();
      } catch (error) {
        res.status(500).json({
          status: 'error',
          message: error && error.message ? error.message : String(error)
        });
      }
    })();
  }

  async _collectBitcoinStatus (options = {}) {
    const force = !!options.force;
    const now = Date.now();
    this._state.content.services = this._state.content.services || {};
    this._state.content.services.bitcoin = this._state.content.services.bitcoin || { balance: 0 };
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
      this._state.content.services.bitcoin.status = unavailable;
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

      const maxRecent = 6;
      const recentBlocks = [];
      for (let h = height; h >= 0 && recentBlocks.length < maxRecent; h--) {
        try {
          const hash = await bitcoin._makeRPCRequest('getblockhash', [h]);
          const block = await bitcoin._makeRPCRequest('getblock', [hash, 1]);
          recentBlocks.push({
            hash: block.hash,
            height: block.height,
            time: block.time,
            txCount: Array.isArray(block.tx) ? block.tx.length : 0,
            size: block.size
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

      const trusted = balances && balances.mine && balances.mine.trusted != null ? balances.mine.trusted : 0;
      const beacon = this._state.content.services && this._state.content.services.bitcoin && this._state.content.services.bitcoin.beacon
        ? this._state.content.services.bitcoin.beacon
        : null;
      const summary = {
        available: true,
        status: 'ONLINE',
        network: bitcoin.network,
        blockchain,
        networkInfo,
        bestHash,
        height,
        mempoolInfo: mempoolInfo || {},
        recentBlocks,
        recentTransactions: mempoolTxs,
        balance: trusted,
        beacon: beacon || undefined
      };

      this._state.content.services.bitcoin.balance = trusted;
      this._state.content.services.bitcoin.status = summary;
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
      this._state.content.services.bitcoin.status = failed;
      this._bitcoinStatusCache = { value: failed, updatedAt: now };
      return failed;
    }
  }

  /**
   * Called when the Bitcoin service receives a new block via ZMQ.
   * Updates global state, appends a commit message to the Fabric chain, and broadcasts a JSON Patch to all WebSocket clients.
   */
  async _handleBitcoinBlockUpdate (payload = {}) {
    try {
      this._bitcoinStatusCache = { value: null, updatedAt: 0 };
      const status = await this._collectBitcoinStatus({ force: true });
      if (!status || !status.available) return;

      await this._appendFabricMessage('BitcoinBlock', {
        tip: payload.tip || status.bestHash,
        height: payload.height != null ? payload.height : status.height,
        supply: payload.supply,
        at: new Date().toISOString()
      });

      const patch = { op: 'add', path: '/bitcoin', value: status };
      const msg = Message.fromVector(['JSONPatch', JSON.stringify(patch)]);
      if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
      if (this.http && typeof this.http.broadcast === 'function') {
        this.http.broadcast(msg);
      }
    } catch (err) {
      console.error('[HUB] _handleBitcoinBlockUpdate error:', err && err.message ? err.message : err);
    }
  }

  _handleBitcoinStatusRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const status = await this._collectBitcoinStatus({ force: true });
      // Always 200 so the client receives balance/beacon/message even when unavailable
      const body = status && typeof status === 'object'
        ? { ...status, balance: status.balance != null ? status.balance : 0, beacon: status.beacon || { balanceSats: 0, clock: 0 } }
        : { available: false, status: 'UNAVAILABLE', balance: 0, beacon: { balanceSats: 0, clock: 0 }, message: 'Bitcoin status unknown.' };
      return res.status(200).json(body);
    });
  }

  _handleSettingsListRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const settings = this.setup.listSettings();
      const setupStatus = this.setup.getSetupStatus();
      return res.status(200).json({ success: true, settings, ...setupStatus });
    });
  }

  _handleSettingsBootstrapRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
        } : {})
      };
      const result = await this.setup.createAdminToken(initialConfig);
      return res.status(200).json(result);
    });
  }

  _handleSettingsGetRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const name = req.params && req.params.name;
      if (!name) return res.status(400).json({ error: 'Setting name is required' });
      const value = this.setup.getSetting(name);
      if (value === undefined) return res.status(404).json({ error: 'Setting not found', setting: name });
      return res.status(200).json({ success: true, setting: name, value });
    });
  }

  _handleSettingsPutRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
      return res.status(200).json({ success: true, setting: name, value });
    });
  }

  _handleSettingsRefreshRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
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

  _handleBitcoinBlockViewRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const hash = req && req.params ? req.params.blockhash : null;
      if (!hash) return res.status(400).json({ status: 'error', message: 'Block hash is required.' });
      const block = await bitcoin._makeRPCRequest('getblock', [hash, 2]);
      return res.json(block);
    });
  }

  _handleBitcoinTransactionsListRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const txhash = req && req.params ? req.params.txhash : null;
      if (!txhash) return res.status(400).json({ status: 'error', message: 'Transaction hash is required.' });

      try {
        const tx = await bitcoin._makeRPCRequest('getrawtransaction', [txhash, true]);
        return res.json(tx);
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

  _handleBitcoinWalletSummaryRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const walletId = (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName;
      const xpub = (req.query && req.query.xpub) ? String(req.query.xpub).trim() : '';

      const isHubWallet = walletId && String(walletId) === String(bitcoin.walletName);
      const isClientWallet = !isHubWallet && xpub;

      if (isClientWallet) {
        try {
          const network = bitcoin.network || 'regtest';
          const normalizedXpub = this._normalizeXpubForNetwork(xpub, network);
          const receiveDesc = `wpkh(${normalizedXpub}/0/*)`;
          const changeDesc = `wpkh(${normalizedXpub}/1/*)`;

          const [receiveInfo, changeInfo] = await Promise.all([
            bitcoin._makeRPCRequest('getdescriptorinfo', [receiveDesc]).catch(() => ({ descriptor: receiveDesc })),
            bitcoin._makeRPCRequest('getdescriptorinfo', [changeDesc]).catch(() => ({ descriptor: changeDesc }))
          ]);

          const scanObjects = [
            { desc: receiveInfo.descriptor || receiveDesc, range: [0, 999] },
            { desc: changeInfo.descriptor || changeDesc, range: [0, 999] }
          ];

          const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', scanObjects]);
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
    return this._jsonOrShell(req, res, async () => {
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
   * Look up balance for a single address. Server does not hold keys; uses scantxoutset.
   * Requires txindex. Works for any on-chain address.
   */
  _handleBitcoinAddressBalanceRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });
      const utxos = await bitcoin._listUnspent();
      return res.json({
        walletId: (req.params && req.params.walletId) || (req.query && req.query.walletId) || bitcoin.walletName,
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
    return this._jsonOrShell(req, res, async () => {
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
          const normalizedXpub = this._normalizeXpubForNetwork(xpub, network);
          const receiveDesc = `wpkh(${normalizedXpub}/0/*)`;
          const changeDesc = `wpkh(${normalizedXpub}/1/*)`;

          const [receiveInfo, changeInfo] = await Promise.all([
            bitcoin._makeRPCRequest('getdescriptorinfo', [receiveDesc]).catch(() => ({ descriptor: receiveDesc })),
            bitcoin._makeRPCRequest('getdescriptorinfo', [changeDesc]).catch(() => ({ descriptor: changeDesc }))
          ]);

          const scanObjects = [
            { desc: receiveInfo.descriptor || receiveDesc, range: [0, 999] },
            { desc: changeInfo.descriptor || changeDesc, range: [0, 999] }
          ];

          const result = await bitcoin._makeRPCRequest('scantxoutset', ['start', scanObjects]);
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
            transactions: sorted,
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
        transactions: transactions.filter(Boolean)
      });
    });
  }

  _handleBitcoinWalletSendRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const bitcoin = this._getBitcoinService();
      if (!bitcoin) return res.status(503).json({ status: 'error', message: 'Bitcoin service unavailable' });

      const body = req.body || {};
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

  /** Faucet: send from Beacon/Hub wallet to address. Regtest only; amount capped. */
  _handleBitcoinFaucetRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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

        const txid = await bitcoin._processSpendMessage({
          destination: to,
          amount: amountBTC,
          comment: 'faucet'
        });

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
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
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
        sessions: Number(capabilities.counts && capabilities.counts.sessions ? capabilities.counts.sessions : 0),
        merkle: capabilities.merkle || {}
      };
      return res.json(capabilities);
    });
  }

  _handlePayjoinDepositRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });

      const bitcoin = this._getBitcoinService();
      const body = req.body || {};
      const walletId = String(body.walletId || '').trim() || (bitcoin ? bitcoin.walletName : 'default');
      const amountSats = Number(body.amountSats || 0);
      const label = String(body.label || body.memo || '').trim();
      const memo = String(body.memo || '').trim();
      const expiresInSeconds = Number(body.expiresInSeconds || 0) || undefined;
      const address = String(body.address || '').trim() || (bitcoin ? await bitcoin.getUnusedAddress() : '');
      if (!address) return res.status(400).json({ status: 'error', message: 'Deposit address is required.' });

      const session = await payjoin.createDepositSession({
        walletId,
        amountSats,
        label,
        memo,
        expiresInSeconds,
        address
      });

      this._state.content.services.payjoin = this._state.content.services.payjoin || {};
      this._state.content.services.payjoin.available = true;
      this._state.content.services.payjoin.sessions = Number((payjoin.state && payjoin.state.counts && payjoin.state.counts.sessions) || 0);
      this._state.content.services.payjoin.merkle = (payjoin.state && payjoin.state.merkle) || {};

      return res.json({
        service: 'payjoin',
        bip: 'BIP77',
        status: 'success',
        session
      });
    });
  }

  _handlePayjoinSessionsListRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 25)));
      const includeExpired = String(req.query.includeExpired || '').toLowerCase() === 'true';
      const sessions = payjoin.listSessions({ limit, includeExpired }).map((session) => payjoin.getSession(session.id, { includeProposals: false }));
      return res.json({
        service: 'payjoin',
        sessions
      });
    });
  }

  _handlePayjoinSessionViewRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
      const payjoin = this._getPayjoinService();
      if (!payjoin) return res.status(503).json({ status: 'error', message: 'Payjoin service unavailable' });
      const sessionId = req && req.params ? req.params.sessionId : null;
      if (!sessionId) return res.status(400).json({ status: 'error', message: 'sessionId is required.' });
      const body = req.body || {};
      const result = await payjoin.submitProposal(sessionId, {
        psbt: body.psbt,
        txhex: body.txhex
      });
      return res.json(result);
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
      case 'getpayjoinstatus':
      case 'payjoinstatus': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        return payjoin.getCapabilities();
      }
      case 'createpayjoindeposit': {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const address = String(params.address || '').trim() || (bitcoin ? await bitcoin.getUnusedAddress() : '');
        if (!address) return { status: 'error', message: 'address is required' };
        return payjoin.createDepositSession({
          walletId: String(params.walletId || (bitcoin && bitcoin.walletName) || ''),
          amountSats: Number(params.amountSats || 0),
          label: String(params.label || params.memo || ''),
          memo: String(params.memo || ''),
          expiresInSeconds: Number(params.expiresInSeconds || 0) || undefined,
          address
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

  _serializedLightningRpc (fn) {
    const p = this._lightningRpcQueue.then(() => fn());
    this._lightningRpcQueue = p.catch(() => {});
    return p;
  }

  _handleLightningStatusRequest (req, res) {
    return this._jsonOrShell(req, res, async () => {
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
    return this._jsonOrShell(req, res, async () => {
      const stub = this.settings.lightning && this.settings.lightning.stub === true;
      const pathName = req && req.path ? req.path : '/services/lightning';
      if (stub) {
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
      return this._jsonOrShell(req, res, async () => {
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
    this.beacon.attach({ fs: this.fs, key: this._rootKey });

    this.beacon.on('epoch', (epoch) => {
      try {
        this._state.content.services = this._state.content.services || {};
        this._state.content.services.bitcoin = this._state.content.services.bitcoin || {};
        const storedInterval = this.beacon.settings.regtest !== false
          ? Number(beaconConfig.interval || 600000)
          : 0;
        this._state.content.services.bitcoin.beacon = {
          status: 'RUNNING',
          interval: storedInterval,
          clock: Number(epoch && epoch.clock ? epoch.clock : 0),
          lastBlockHash: epoch && epoch.blockHash ? epoch.blockHash : null,
          height: epoch && Number.isFinite(epoch.height) ? epoch.height : null,
          balance: epoch && Number.isFinite(epoch.balance) ? epoch.balance : 0,
          balanceSats: epoch && Number.isFinite(epoch.balanceSats) ? epoch.balanceSats : 0,
          updatedAt: new Date().toISOString()
        };
      } catch (e) {
        console.warn('[HUB:BEACON] Failed to store epoch metadata:', e && e.message ? e.message : e);
      }
    });

    this.beacon.on('error', (err) => {
      console.error('[HUB:BEACON] Error:', err && err.message ? err.message : err);
    });

    this.beacon.on('reorg', () => {
      try {
        this._refreshMerkleState('beacon-reorg');
      } catch (e) {
        console.warn('[HUB:BEACON] Failed to refresh merkle after reorg:', e && e.message ? e.message : e);
      }
    });

    await this.beacon.start();
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
        this._state.content.services.bitcoin.status = { available: false, status: 'ERROR', message: msg };
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
        const btcDatadir = path.resolve(process.cwd(), btcSettings.datadir || './stores/bitcoin-regtest');
        const rpcport = Number(btcSettings.rpcport || 20444);
        const username = btcSettings.username || '';
        const password = btcSettings.password || '';

        if (!username || !password) {
          console.warn('[HUB:LIGHTNING] Bitcoin RPC credentials not available; Lightning not started.');
          return;
        }

        this.lightning = new Lightning({
          managed: true,
          network: 'regtest',
          datadir: path.resolve(process.cwd(), './stores/lightning/hub'),
          hostname: '0.0.0.0',
          port: 9735,
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
      if (this.chain && typeof this.chain.start === 'function') {
        await this.chain.start();
      }

      if (this.bitcoin) {
        this.bitcoin.on('debug', (...args) => console.log('[BITCOIN]', '[DEBUG]', ...args));
        this.bitcoin.on('error', (...error) => console.error('[BITCOIN]', '[ERROR]', ...error));
        this.bitcoin.on('log', (...log) => console.log('[BITCOIN]', ...log));
        this.bitcoin.on('warning', (...warning) => console.warn('[BITCOIN]', '[WARNING]', ...warning));
        this.bitcoin.on('block', this._handleBitcoinBlockUpdate.bind(this));
        this.bitcoin.on('transaction', this._handleBitcoinBlockUpdate.bind(this));
        this._state.content.services.bitcoin = this._state.content.services.bitcoin || { balance: 0 };
        this._state.content.services.bitcoin.status = { available: false, status: 'STARTING', message: 'Starting Bitcoin...' };
        // Enable debug so bitcoind stdout and RPC wait progress are visible while startup takes time
        this.bitcoin.settings.debug = true;
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
          this._state.content.services.bitcoin.status = { available: false, status: 'ERROR', message: msg };
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

      // Load prior state
      const file = this.fs.readFile('STATE');
      const state = (file) ? JSON.parse(file) : this.state;

      // Assign properties
      Object.assign(this._state.content, state);
      this._ensureResourceCollections();
      // Remove legacy bundle-specific state from persisted snapshots now that
      // documents are the single resource model.
      if (this._state.content.collections && this._state.content.collections.bundles) {
        delete this._state.content.collections.bundles;
      }
      if (this._state.content.merkle && this._state.content.merkle.roots && Object.prototype.hasOwnProperty.call(this._state.content.merkle.roots, 'bundles')) {
        delete this._state.content.merkle.roots.bundles;
      }
      if (this._state.content.collections && this._state.content.collections.merkle) {
        for (const entry of Object.values(this._state.content.collections.merkle)) {
          if (entry && entry.roots && Object.prototype.hasOwnProperty.call(entry.roots, 'bundles')) {
            delete entry.roots.bundles;
          }
        }
      }
      this._state.content.services = this._state.content.services || {};
      this._state.content.services.payjoin = this._state.content.services.payjoin || { available: false, sessions: 0 };
      await this._ensureGenesisMessage();
      await this._ensureDocumentChainsFromState();

      // Contract deploy
      console.debug('[HUB]', 'Contract ID:', this.contract.id);
      console.debug('[HUB]', 'Contract State:', this.contract.state);

      // TODO: retrieve contract ID, add to local state
      this.contract.deploy();
      this.commit();

      // Load HTML document from disk to serve from memory
      try {
        this.applicationString = fs.readFileSync('./assets/index.html').toString('utf8');
      } catch (err) {
        console.error('[HUB]', 'Failed to load ./assets/index.html:', err && err.message ? err.message : err);
        this.applicationString = '<html><body><h1>hub.fabric.pub</h1><p>Application shell unavailable.</p></body></html>';
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

      // Bitcoin service surface:
      // - GET routes are browser-friendly (HTML shell or JSON by Accept header)
      // - POST /services/bitcoin is the compact JSON-RPC style endpoint
      // - resource paths use plural nouns
      this.http._addRoute('GET', '/services/bitcoin', this._handleBitcoinStatusRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin', this._handleBitcoinRPCRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/blocks', this._handleBitcoinBlocksListRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/blocks', this._handleBitcoinGenerateBlockRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/blocks/:blockhash', this._handleBitcoinBlockViewRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/transactions', this._handleBitcoinTransactionsListRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/transactions/:txhash', this._handleBitcoinTransactionViewRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets', this._handleBitcoinWalletSummaryRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId', this._handleBitcoinWalletSummaryRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/addresses', this._handleBitcoinWalletAddressRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/addresses/:address/balance', this._handleBitcoinAddressBalanceRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId/utxos', this._handleBitcoinWalletUtxosRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/wallets/:walletId/transactions', this._handleBitcoinWalletTransactionsRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/payments', this._handleBitcoinPaymentsListRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/payments', this._handleBitcoinWalletSendRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/faucet', this._handleBitcoinFaucetRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/payjoin', this._handlePayjoinStatusRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/payjoin/deposits', this._handlePayjoinDepositRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/payjoin/sessions', this._handlePayjoinSessionsListRequest.bind(this));
      this.http._addRoute('GET', '/services/bitcoin/payjoin/sessions/:sessionId', this._handlePayjoinSessionViewRequest.bind(this));
      this.http._addRoute('POST', '/services/bitcoin/payjoin/sessions/:sessionId/proposal', this._handlePayjoinProposalSubmitRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning', this._handleLightningStatusRequest.bind(this));
      this.http._addRoute('GET', '/services/lightning/channels', this._handleLightningCollectionRequest.bind(this));
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

      this.http._registerMethod('GetPayjoinStatus', async () => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        return payjoin.getCapabilities();
      });

      this.http._registerMethod('CreatePayjoinDeposit', async (...params) => {
        const payjoin = this._getPayjoinService();
        const bitcoin = this._getBitcoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const walletId = String(body.walletId || (bitcoin && bitcoin.walletName) || '').trim();
        const address = String(body.address || '').trim() || (bitcoin ? await bitcoin.getUnusedAddress() : '');
        if (!address) return { status: 'error', message: 'address is required' };
        return payjoin.createDepositSession({
          walletId,
          amountSats: Number(body.amountSats || 0),
          label: String(body.label || body.memo || ''),
          memo: String(body.memo || ''),
          expiresInSeconds: Number(body.expiresInSeconds || 0) || undefined,
          address
        });
      });

      this.http._registerMethod('ListPayjoinSessions', (...params) => {
        const payjoin = this._getPayjoinService();
        if (!payjoin) return { status: 'error', message: 'Payjoin service unavailable' };
        const body = params[0] || {};
        const limit = Math.max(1, Math.min(200, Number(body.limit || 25)));
        const includeExpired = !!body.includeExpired;
        return payjoin.listSessions({ limit, includeExpired }).map((session) => payjoin.getSession(session.id, { includeProposals: false }));
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
        return payjoin.submitProposal(sessionId, {
          psbt: body.psbt,
          txhex: body.txhex
        });
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
      // Params: (idOrAddress, kind = 'documents')
      this.http._registerMethod('RequestPeerInventory', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        const kind = params[1] || 'documents';
        if (!idOrAddress) return { status: 'error', message: 'id/address required' };

        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };

        try {
          const targetValue = (typeof idOrAddress === 'object' && idOrAddress)
            ? (idOrAddress.id || idOrAddress.address || String(idOrAddress))
            : String(idOrAddress);

          const payload = {
            type: 'INVENTORY_REQUEST',
            actor: { id: this.agent.identity.id },
            object: {
              kind: kind || 'documents',
              created: Date.now()
            },
            target: targetValue
          };

          const vector = ['INVENTORY_REQUEST', JSON.stringify(payload)];
          this._sendVectorToPeer(address, vector);

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
          if (!doc || !doc.contentBase64) return { status: 'error', message: 'document content required' };

          // Enforce an upper bound on file size to avoid memory/disk exhaustion.
          const buf = Buffer.from(doc.contentBase64, 'base64');
          if (buf.length > MAX_DOCUMENT_BYTES) {
            return { status: 'error', message: `document too large (max ${MAX_DOCUMENT_BYTES} bytes)` };
          }

          const totalChunks = Math.max(1, Math.ceil(buf.length / P2P_FILE_CHUNK_BYTES));
          const transferId = `${doc.id || (doc.sha256 || 'document')}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;

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
                part: {
                  transferId,
                  index,
                  total: totalChunks
                }
              }
            };

            const vector = ['P2P_FILE_SEND', JSON.stringify(filePayload)];
            this._sendVectorToPeer(address, vector);
          }
          // Record an activity for file distribution.
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

      // Ensure in-memory documents index includes any documents already present
      // in the global content store (e.g. previously published documents).
      try {
        this._state.documents = this._state.documents || {};
        this._state.content = this._state.content || {};
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
                edited: entry.edited || entry.created || null
              };
            }
          }
        }
      } catch (err) {
        console.error('[HUB] Failed to seed documents index from content store:', err);
      }

      await this._ensureDocumentChainsFromState();
      this._refreshMerkleState('startup-resource-sync');

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
        if (buffer.length > MAX_DOCUMENT_BYTES) {
          return { status: 'error', message: `document too large (max ${MAX_DOCUMENT_BYTES} bytes)` };
        }
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
        await this._appendDocumentChainMessage(meta.lineage || id, 'DOCUMENT_PUBLISH', this._buildDocumentPublishPayload(meta));
        // Local creation is not a major global state update; message log
        // updates occur when resource collections (public state) are changed.
        this._refreshMerkleState('create-document');

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

          const list = Object.values(docs).sort((a, b) => {
            const ta = a && a.created ? new Date(a.created).getTime() : 0;
            const tb = b && b.created ? new Date(b.created).getTime() : 0;
            return tb - ta;
          }).map((meta) => {
            if (!meta || !meta.id) return meta;
            const id = meta.id;
            const publishedMeta = collections[id];
            const backingId = meta.sha256 || id;
            const storageContractId = contractIndex[backingId];
            return Object.assign(
              {},
              meta,
              publishedMeta && publishedMeta.published ? { published: publishedMeta.published } : null,
              storageContractId ? { storageContractId } : null
            );
          });

          return { type: 'ListDocumentsResult', documents: list };
        } catch (err) {
          console.error('[HUB] ListDocuments error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'list failed' };
        }
      });

      // Get a document (metadata + base64 content)
      this.http._registerMethod('GetDocument', async (...params) => {
        const id = this._normalizeDocumentId(params[0] && (params[0].id || params[0]));
        if (!id) return { status: 'error', message: 'id required' };
        try {
          const raw = this.fs.readFile(`documents/${id}.json`);
          if (!raw) return { status: 'error', message: 'document not found' };
          const parsed = JSON.parse(raw);

          // Decorate with published + storageContractId from hub state, if present
          const collections = (this._state.content && this._state.content.collections && this._state.content.collections.documents) || {};
          const publishedMeta = collections[id];
          if (publishedMeta && publishedMeta.published && !parsed.published) {
            parsed.published = publishedMeta.published;
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
          return { status: 'error', message: err && err.message ? err.message : 'get failed' };
        }
      });

      // Create a pay-to-distribute invoice: returns address + amount for L1 payment.
      // Params: ({ documentId, amountSats, durationYears?, challengeCadence?, responseDeadline? })
      this.http._registerMethod('CreateDistributeInvoice', async (...params) => {
        const config = params[0] || {};
        const documentId = this._normalizeDocumentId(config.documentId || config.id);
        if (!documentId) return { status: 'error', message: 'documentId required' };

        const bitcoin = this._getBitcoinService();
        if (!bitcoin) return { status: 'error', message: 'Bitcoin service unavailable for pay-to-distribute' };

        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found' };

        const amountSats = Number(config.amountSats || 0);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'positive amountSats required' };
        }

        const address = await bitcoin.getUnusedAddress();
        const now = new Date().toISOString();
        const distributeConfig = {
          amountSats,
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
        if (!idOrAddress) return { status: 'error', message: 'peer id/address required' };
        if (!documentId || !Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'documentId and positive amountSats required' };
        }
        const address = this._resolvePeerAddress(idOrAddress);
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };
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
          return { status: 'success', proposalId: `proposal:${Date.now()}:${this.agent.identity.id}` };
        } catch (err) {
          console.error('[HUB] SendDistributeProposal error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'send failed' };
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
          return { status: 'error', message: 'documentId and positive amountSats required' };
        }
        if (!senderAddress) return { status: 'error', message: 'senderAddress required to send acceptance' };
        const bitcoin = this._getBitcoinService();
        if (!bitcoin) return { status: 'error', message: 'Bitcoin service unavailable' };
        const raw = this.fs.readFile(`documents/${documentId}.json`);
        if (!raw) return { status: 'error', message: 'document not found' };
        try {
          const address = await bitcoin.getUnusedAddress();
          const now = new Date().toISOString();
          const distributeConfig = {
            amountSats,
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
          return { status: 'error', message: err && err.message ? err.message : 'accept failed' };
        }
      });

      // Publish a document ID into the global store (hub node state.collections.documents)
      // Params: (id: string | { id: string })
      this.http._registerMethod('PublishDocument', async (...params) => {
        const id = this._normalizeDocumentId(params[0] && (params[0].id || params[0]));
        if (!id) return { status: 'error', message: 'id required' };
        try {
          // Ensure the document exists locally
          const raw = this.fs.readFile(`documents/${id}.json`);
          if (!raw) return { status: 'error', message: 'document not found' };
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
            published: now
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
          await this._appendDocumentChainMessage(parsed.lineage || id, 'DOCUMENT_PUBLISH', this._buildDocumentPublishPayload({
            id,
            lineage: parsed.lineage || id,
            name: parsed.name,
            mime: parsed.mime,
            size: parsed.size,
            sha256: parsed.sha256 || id,
            created: parsed.created || now,
            parent: parsed.parent || null,
            revision: parsed.revision || 1,
            published: now
          }));
          this._refreshMerkleState('publish-document');
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
          return { status: 'error', message: err && err.message ? err.message : 'publish failed' };
        }
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
          if (buffer.length > MAX_DOCUMENT_BYTES) {
            return { status: 'error', message: `document too large (max ${MAX_DOCUMENT_BYTES} bytes)` };
          }

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
            await this._appendDocumentChainMessage(lineage, 'DOCUMENT_EDIT', {
              sourceId: source.id || sourceId,
              document: nextId,
              name: nextName,
              mime: nextMime,
              size: buffer.length,
              sha256: nextId,
              parent: source.id || sourceId,
              revision: nextRevision,
              edited: now
            }, {
              publishPayload: this._buildDocumentPublishPayload(source)
            });
          }

          this._refreshMerkleState('edit-document');
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
          revisions,
          chain: (this._getDocumentChains() && this._getDocumentChains()[lineage]) ? this._getDocumentChains()[lineage] : null
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

        if (!documentId) return { status: 'error', message: 'documentId required' };

        const amountSats = Number(config.amountSats || 0);
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
          return { status: 'error', message: 'positive amountSats required' };
        }

        const bitcoin = this._getBitcoinService();
        const pending = this._distributeRequests[documentId];

        if (bitcoin && pending) {
          if (!txid) return { status: 'error', message: 'Payment required. Call CreateDistributeInvoice first, pay to the returned address, then pass txid to CreateStorageContract.' };
          const verified = await this._verifyL1Payment(bitcoin, txid, pending.address, pending.amountSats);
          if (!verified) return { status: 'error', message: 'Payment verification failed. Ensure the transaction pays to the invoice address with at least the required amount.' };
          delete this._distributeRequests[documentId];
        } else if (bitcoin && !pending) {
          return { status: 'error', message: 'Payment required. Call CreateDistributeInvoice first with documentId and amountSats.' };
        }

        const durationYears = Number(config.durationYears || 4);
        const challengeCadence = config.challengeCadence || 'daily';
        const responseDeadline = config.responseDeadline || '10s';
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
            created: new Date().toISOString()
          };

          const contract = new Actor({ content: descriptor });
          const contractId = contract.id;

          this._state.content.collections.contracts[contractId] = {
            id: contractId,
            ...descriptor,
            owner: ownerId || undefined
          };
          this._state.content.contracts = this._state.content.collections.contracts;

          // Persist a minimal record alongside documents for durability
          try {
            await this.fs.publish(`contracts/${contractId}.json`, this._state.content.collections.contracts[contractId]);
            // Persist updated global state (includes contracts index)
            await this._appendFabricMessage('CreateStorageContract', {
              id: contractId,
              document: documentId,
              amountSats,
              durationYears
            });
            this._refreshMerkleState('create-storage-contract');
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

          return {
            type: 'CreateStorageContractResult',
            id: contractId,
            contract: this._state.content.collections.contracts[contractId]
          };
        } catch (err) {
          console.error('[HUB] CreateStorageContract error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'create storage contract failed' };
        }
      });

      const buildNetworkStatus = () => {
        const merkle = this._refreshMerkleState('network-status');
        const fabricMessages = this._getFabricMessages();
        const setupStatus = this.setup.getSetupStatus();
        return {
          clock: this.http.clock,
          contract: this.contract.id,
          documents: this._state.documents,
          setup: setupStatus,
          publishedDocuments: (this._state.content && this._state.content.collections && this._state.content.collections.documents) ? this._state.content.collections.documents : {},
          documentChains: this._getDocumentChains(),
          fabricMessages,
          merkle,
          network: {
            address: this.http.agent.listenAddress,
            listening: this.http.agent.listening
          },
          // Use the Peer's persistent known-peers list (scores, metadata) with current status.
          peers: this.agent.knownPeers,
          // WebRTC peers connected via PeerJS signaling at /services/peering
          webrtcPeers: this.http.webrtcPeerList || [],
          // settings: this.settings,
          state: this.http.state,
          xpub: this._rootKey.xpub
        };
      };

      this.http._registerMethod('GetNetworkStatus', (...params) => {
        const status = buildNetworkStatus();
        return status;
      });

      this.http._registerMethod('GetSetupStatus', (...params) => {
        return this.setup.getSetupStatus();
      });

      this.http._registerMethod('GetMerkleState', (...params) => {
        const current = this._refreshMerkleState('rpc-get-merkle-state');
        return {
          type: 'GetMerkleStateResult',
          current,
          history: (this._state.content && this._state.content.collections && this._state.content.collections.merkle)
            ? this._state.content.collections.merkle
            : {}
        };
      });

      this.http._registerMethod('ListFabricMessages', (...params) => {
        return {
          type: 'ListFabricMessagesResult',
          messages: this._getFabricMessages()
        };
      });

      this.http._registerMethod('ListPeers', (...params) => {
        // For the UI we return the same shape as GetNetworkStatus
        // so the bridge/networkStatus wiring can remain consistent.
        const status = buildNetworkStatus();
        return status;
      });

      // When Hub needs more Fabric P2P connections, publish peering offer (gossiped until fulfilled).
      // Called from pushNetworkStatus and from periodic timer.
      const maybeBroadcastFabricPeeringOffer = () => {
        try {
          const connCount = Object.keys(this.agent.connections || {}).length;
          const maxPeers = (this.agent.settings.constraints && this.agent.settings.constraints.peers && this.agent.settings.constraints.peers.max) || MAX_PEERS;
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

      this.agent.on('connections:open', pushNetworkStatus);
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

      // WebRTC Peer Mesh Management
      // Register a browser client's WebRTC peer ID for peer discovery
      this.http._registerMethod('RegisterWebRTCPeer', (...params) => {
        const info = params[0] || {};
        const peerId = info.peerId;
        if (!peerId) return { status: 'error', message: 'peerId required' };

        console.debug('[HUB] RegisterWebRTCPeer:', peerId);

        // The peer is normally tracked by the PeerServer coordinator events;
        // this method augments that state and also ensures a fallback entry
        // exists so ListWebRTCPeers can return recently registered peers
        // even if the PeerServer connection event raced or was missed.
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
            lastSeen: now
          });
        }

        pushNetworkStatus();
        return { status: 'success', peerId };
      });

      // List available WebRTC peers for mesh connections
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
            status: p.status,
            metadata: p.metadata
          }))
        };
      });

      // Track when browsers establish direct WebRTC connections
      this.http._registerMethod('WebRTCPeerConnected', (...params) => {
        const info = params[0] || {};
        console.debug('[HUB] WebRTCPeerConnected:', info.peerId, 'direction:', info.direction);
        return { status: 'success' };
      });

      // Track when browsers disconnect from direct WebRTC connections
      this.http._registerMethod('WebRTCPeerDisconnected', (...params) => {
        const info = params[0] || {};
        console.debug('[HUB] WebRTCPeerDisconnected:', info.peerId);
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
      const RELAYABLE_ORIGINAL_TYPES = ['P2P_CHAT_MESSAGE', P2P_PEER_GOSSIP, P2P_PEERING_OFFER, 'fabric-message'];
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
            hops: [...hops, { from: fromPeerId, at: Date.now() }]
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

      // HTTP JSON-RPC endpoint used by tests and non-WebSocket clients.
      // TODO: move this upstream to @fabric/http and use Jayson server.
      const rpcHandler = async (req, res) => {
        try {
          const body = req && req.body ? req.body : {};
          const method = body.method;
          const params = Array.isArray(body.params) ? body.params : [];
          const id = body.id != null ? body.id : null;

          if (!method) {
            res.status(400).json({
              jsonrpc: '2.0',
              id,
              error: { code: -32600, message: 'Invalid Request: method required' }
            });
            return;
          }

          let result = null;
          try {
            result = await this.http._handleCall({ method, params });
          } catch (callErr) {
            console.error('[HUB] RPC call error:', callErr);
            res.status(500).json({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32603,
                message: callErr && callErr.message ? callErr.message : 'Internal error'
              }
            });
            return;
          }

          res.status(200).json({
            jsonrpc: '2.0',
            id,
            result
          });
        } catch (err) {
          console.error('[HUB] RPC handler error:', err);
          res.status(500).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32603,
              message: err && err.message ? err.message : 'Internal error'
            }
          });
        }
      };

      // TODO: remove /rpc route
      this.http._addRoute('POST', '/rpc', rpcHandler);
      this.http._addRoute('POST', '/services/rpc', rpcHandler);

      const inboundFileTransfers = new Map();

      const persistIncomingDocument = async (doc, origin) => {
        const incomingBuffer = Buffer.from(doc.contentBase64, 'base64');
        if (incomingBuffer.length > MAX_DOCUMENT_BYTES) {
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

      // Handle inventory requests from peers and respond with local document inventory.
      this.agent.on('inventory', async ({ message, origin }) => {
        try {
          if (!message || !message.object || message.object.kind !== 'documents') return;

          const targetId = message.actor && message.actor.id;

          // Build a lightweight document inventory: id/sha256/size/mime/created/published.
          const docs = this._state.documents || {};
          const collections = (this._state.content && this._state.content.collections && this._state.content.collections.documents) || {};

          const items = Object.values(docs).map((meta) => {
            if (!meta || !meta.id) return null;
            const id = meta.id;
            const c = collections[id];
            return {
              id,
              sha256: meta.sha256 || id,
              name: meta.name,
              mime: meta.mime || 'application/octet-stream',
              size: meta.size,
              created: meta.created,
              published: !!(c && c.published)
            };
          }).filter(Boolean);

          const responsePayload = {
            type: 'INVENTORY_RESPONSE',
            actor: { id: this.agent.identity.id },
            object: {
              kind: 'documents',
              items,
              created: Date.now()
            },
            target: targetId
          };

          const vector = ['INVENTORY_RESPONSE', JSON.stringify(responsePayload)];
          const originAddress = origin && (origin.address || origin.id);
          if (originAddress && this.agent.connections[originAddress]) {
            this._sendVectorToPeer(originAddress, vector);
          } else if (typeof this.agent.relay === 'function') {
            // Fallback: relay to all peers (for older Peer implementations that support relay)
            const reply = Message.fromVector(vector).signWithKey(this.agent.key);
            this.agent.relay(reply);
          } else {
            // As a last resort, iterate connections and write directly.
            try {
              const reply = Message.fromVector(vector).signWithKey(this.agent.key);
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

      await this.agent.start();
      await this.http.start();
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
