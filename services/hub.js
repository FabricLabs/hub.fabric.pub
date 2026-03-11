'use strict';

// Dependencies
const merge = require('lodash.merge');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// Fabric HTTP
const HTTPServer = require('@fabric/http/types/server');

// Hub Services
const Fabric = require('../services/fabric');
// const Queue = require('../types/queue');

// Routes (Request Handlers)
const ROUTES = require('../routes');

/**
 * Defines the Hub service, known as `@fabric/hub` within the network.
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
      state: {
        status: 'INITIALIZED',
        agents: {},
        collections: {
          documents: {},
          people: {}
        },
        counts: {
          documents: 0,
          people: 0
        },
        services: {
          bitcoin: {
            balance: 0
          },
        }
      },
      crawlDelay: 2500,
      interval: 86400 * 1000,
      verbosity: 2,
      verify: true,
      workers: 1,
    }, settings);

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

    // File Uploads
    // TODO: check for vulnerabilities, easy setup
    // this.uploader = new multer({ dest: this.settings.files.path });

    // Internals
    this.agents = {};
    this.healths = {};
    this.services = {};
    this.sources = {};
    this.workers = [];
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
          components: {
            list: 'ContractHome',
            view: 'ContractView'
          }
        },
        Document: {
          route: '/documents',
          components: {
            list: 'DocumentHome',
            view: 'DocumentView'
          }
        },
        Index: {
          route: '/',
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        },
        Session: {
          route: '/sessions',
          components: {
            list: 'HubInterface',
            view: 'HubInterface'
          }
        },
        Service: {
          route: '/services',
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
   * Finalizes the current state.
   */
  commit () {
    this.fs.publish('STATE', JSON.stringify(this.state, null, '  '));
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

  /**
   * Start the instance.
   * @returns {Hub} Instance of the {@link Hub}.
   */
  async start () {
    try {
      // Listen for agent errors
      this.agent.on('error', (err) => {
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

      // Load prior state
      const file = this.fs.readFile('STATE');
      const state = (file) ? JSON.parse(file) : this.state;

      // Assign properties
      Object.assign(this._state.content, state);

      // Contract deploy
      console.debug('[HUB]', 'Contract ID:', this.contract.id);
      console.debug('[HUB]', 'Contract State:', this.contract.state);

      // TODO: retrieve contract ID, add to local state
      this.contract.deploy();
      this.commit();

      // Load HTML document from disk to serve from memory
      this.applicationString = fs.readFileSync('./assets/index.html').toString('utf8');

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

      // Configure routes
      this._addAllRoutes();

      // Bind event listeners
      // this.trust(this.spa, 'FABRIC:SPA');
      this.trust(this.http, 'FABRIC:HTTP');
      this.trust(this.agent, 'FABRIC:AGENT');

      this.http._registerMethod('AddPeer', (...params) => {
        const peer = params[0];
        const address = typeof peer === 'string' ? peer : (peer && typeof peer.address === 'string' ? peer.address : (peer && peer.address) || null);
        if (!address) return { status: 'error', message: 'address required' };
        const normalized = address.includes(':') ? address : `${address}:7777`;
        console.debug('[HUB] AddPeer:', normalized);
        try {
          this.agent._connect(normalized);
          return { status: 'success' };
        } catch (err) {
          console.error('[HUB] AddPeer error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'connect failed' };
        }
      });

      this.http._registerMethod('RemovePeer', (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        if (!idOrAddress) return { status: 'error', message: 'id or address required' };
        const address = typeof this.agent._resolveToAddress === 'function'
          ? this.agent._resolveToAddress(idOrAddress)
          : idOrAddress;
        if (!address) return { status: 'error', message: 'peer not connected' };
        const ok = this.agent._disconnect(address);
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
        const address = typeof this.agent._resolveToAddress === 'function'
          ? this.agent._resolveToAddress(idOrAddress)
          : idOrAddress;
        if (!address || !this.agent.connections[address]) return { status: 'error', message: 'peer not connected' };
        try {
          const clientId = body && body.clientId ? String(body.clientId) : null;
          const chatPayload = {
            type: 'P2P_CHAT_MESSAGE',
            actor: { id: this.agent.identity.id },
            object: { content: text, created: Date.now() },
            // ActivityStreams-style: top-level target identifies the logical recipient (id or address),
            // independent of how we resolve the network connection.
            target: targetValue
          };

          if (clientId) chatPayload.object.clientId = clientId;

          const vector = ['P2P_CHAT_MESSAGE', JSON.stringify(chatPayload)];
          const msg = Message.fromVector(vector).signWithKey(this.agent.key);
          this.agent.connections[address]._writeFabric(msg.toBuffer());

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

      // Send a file to a peer via P2P_FILE_SEND. Params: (idOrAddress, document)
      // document: { id, name, mime, size, contentBase64 } or { id } (hub fetches content)
      this.http._registerMethod('SendPeerFile', async (...params) => {
        const idOrAddress = params[0] && (params[0].address || params[0].id || params[0]);
        const docParam = params[1] || params[0];
        if (!idOrAddress) return { status: 'error', message: 'peer id/address required' };
        const address = typeof this.agent._resolveToAddress === 'function'
          ? this.agent._resolveToAddress(idOrAddress)
          : idOrAddress;
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

          const filePayload = {
            type: 'P2P_FILE_SEND',
            actor: { id: this.agent.identity.id },
            object: {
              id: doc.id,
              name: doc.name,
              mime: doc.mime || 'application/octet-stream',
              size: doc.size,
              sha256: doc.sha256 || doc.id,
              contentBase64: doc.contentBase64,
              created: doc.created || new Date().toISOString(),
              target: address
            }
          };

          const vector = ['P2P_FILE_SEND', JSON.stringify(filePayload)];
          const msg = Message.fromVector(vector).signWithKey(this.agent.key);
          this.agent.connections[address]._writeFabric(msg.toBuffer());
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
                published: entry.published
              };
            }
          }
        }
      } catch (err) {
        console.error('[HUB] Failed to seed documents index from content store:', err);
      }

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
        const sha256 = doc.sha256 ? String(doc.sha256) : crypto.createHash('sha256').update(buffer).digest('hex');
        const id = sha256;
        const now = new Date().toISOString();

        const meta = {
          id,
          sha256,
          name,
          mime,
          size: size != null && !Number.isNaN(size) ? size : buffer.length,
          created: now
        };

        try {
          // Persist the document (metadata + base64) under the hub's filesystem store
          await this.fs.publish(`documents/${id}.json`, {
            ...meta,
            contentBase64
          });

          // Keep a lightweight index in memory/state (no content)
          this._state.documents = this._state.documents || {};
          this._state.documents[id] = meta;

          // Push network status so document lists update
          if (typeof pushNetworkStatus === 'function') pushNetworkStatus();

          return { type: 'CreateDocumentResult', document: meta };
        } catch (err) {
          console.error('[HUB] CreateDocument error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'create failed' };
        }
      });

      // List documents (metadata only)
      this.http._registerMethod('ListDocuments', async (...params) => {
        try {
          const docs = this._state.documents || {};
          const list = Object.values(docs).sort((a, b) => {
            const ta = a && a.created ? new Date(a.created).getTime() : 0;
            const tb = b && b.created ? new Date(b.created).getTime() : 0;
            return tb - ta;
          });
          return { type: 'ListDocumentsResult', documents: list };
        } catch (err) {
          console.error('[HUB] ListDocuments error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'list failed' };
        }
      });

      // Get a document (metadata + base64 content)
      this.http._registerMethod('GetDocument', async (...params) => {
        const id = params[0] && (params[0].id || params[0]);
        if (!id) return { status: 'error', message: 'id required' };
        try {
          const raw = this.fs.readFile(`documents/${id}.json`);
          if (!raw) return { status: 'error', message: 'document not found' };
          const parsed = JSON.parse(raw);
          return { type: 'GetDocumentResult', document: parsed };
        } catch (err) {
          console.error('[HUB] GetDocument error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'get failed' };
        }
      });

      // Publish a document ID into the global store (hub node state.collections.documents)
      // Params: (id: string | { id: string })
      this.http._registerMethod('PublishDocument', async (...params) => {
        const id = params[0] && (params[0].id || params[0]);
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
            published: now
          };
          if (!exists) {
            this._state.content.counts.documents = (this._state.content.counts.documents || 0) + 1;
          }

          // Persist global state
          this.commit();

          // Update UI clients
          if (typeof pushNetworkStatus === 'function') pushNetworkStatus();

          return { type: 'PublishDocumentResult', document: this._state.content.collections.documents[id] };
        } catch (err) {
          console.error('[HUB] PublishDocument error:', err);
          return { status: 'error', message: err && err.message ? err.message : 'publish failed' };
        }
      });

      const buildNetworkStatus = () => {
        console.debug('getting network status (settings):', this.http.agent.settings);
        console.debug('getting network status (address):', this.http.agent.listenAddress);
        return {
          clock: this.http.clock,
          contract: this.contract.id,
          documents: this._state.documents,
          publishedDocuments: (this._state.content && this._state.content.collections && this._state.content.collections.documents) ? this._state.content.collections.documents : {},
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

      this.http._registerMethod('ListPeers', (...params) => {
        // For the UI we return the same shape as GetNetworkStatus
        // so the bridge/networkStatus wiring can remain consistent.
        const status = buildNetworkStatus();
        return status;
      });

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
        } catch (err) {
          console.error('[HUB] pushNetworkStatus error:', err);
        }
      };

      this.agent.on('connections:open', pushNetworkStatus);
      this.agent.on('connections:close', pushNetworkStatus);

      // Push network status when WebRTC peers connect/disconnect
      this.http.on('webrtc:connection', pushNetworkStatus);
      this.http.on('webrtc:disconnect', pushNetworkStatus);

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

        // The peer is already tracked by the PeerServer coordinator events
        // This method allows clients to provide additional metadata
        const existing = this.http.webrtcPeers.get(peerId);
        if (existing) {
          existing.metadata = info.metadata || existing.metadata;
          existing.registeredAt = Date.now();
          this.http.webrtcPeers.set(peerId, existing);
        }

        pushNetworkStatus();
        return { status: 'success', peerId };
      });

      // List available WebRTC peers for mesh connections
      this.http._registerMethod('ListWebRTCPeers', (...params) => {
        const options = params[0] || {};
        const excludeSelf = options.excludeSelf !== false;
        const requestingPeerId = options.peerId;

        const peers = this.http.webrtcPeerList || [];
        const filtered = excludeSelf && requestingPeerId
          ? peers.filter(p => p.id !== requestingPeerId)
          : peers;

        console.debug('[HUB] ListWebRTCPeers:', filtered.length, 'peers available');

        return {
          type: 'ListWebRTCPeersResult',
          peers: filtered.map(p => ({
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

      // Broadcast chat messages received from the P2P network to UI clients.
      // The UI Bridge will parse `ChatMessage` and append it to client-side state.
      this.agent.on('chat', (chat) => {
        try {
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

      // Handle files received from peers via P2P_FILE_SEND. Store and broadcast to clients.
      this.agent.on('file', async ({ message, origin }) => {
        try {
          const obj = message && message.object;
          if (!obj || !obj.contentBase64 || !obj.id) return;
          const doc = {
            id: obj.id,
            name: obj.name || 'received',
            mime: obj.mime || 'application/octet-stream',
            size: obj.size,
            sha256: obj.sha256 || obj.id,
            contentBase64: obj.contentBase64,
            created: obj.created || new Date().toISOString(),
            receivedFrom: origin && origin.name
          };
          await this.fs.publish(`documents/${doc.id}.json`, doc);
          this._state.documents = this._state.documents || {};
          this._state.documents[doc.id] = { id: doc.id, sha256: doc.sha256, name: doc.name, mime: doc.mime, size: doc.size, created: doc.created };
          if (typeof pushNetworkStatus === 'function') pushNetworkStatus();
          const payload = JSON.stringify({ type: 'P2P_FILE_SEND', object: doc });
          const msg = Message.fromVector(['FileMessage', payload]);
          if (this._rootKey && this._rootKey.private) msg.signWithKey(this._rootKey);
          if (typeof this.http.broadcast === 'function') this.http.broadcast(msg);
        } catch (err) {
          console.error('[HUB] Failed to handle received file:', err);
        }
      });

      await this.agent.start();
      await this.http.start();

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
    await this.http.stop();
    await this.agent.stop();

    this._state.status = 'STOPPED';
    return this;
  }

}

module.exports = Hub;
