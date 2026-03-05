'use strict';

// Dependencies
const merge = require('lodash.merge');
const fs = require('fs');
const path = require('path');

// Fabric Types
const Chain = require('@fabric/core/types/chain'); // fabric chains
const Collection = require('@fabric/core/types/collection');
const Contract = require('@fabric/core/types/contract');
const Filesystem = require('@fabric/core/types/filesystem');
const Key = require('@fabric/core/types/key'); // fabric keys
const Logger = require('@fabric/core/types/logger');
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
        console.debug('adding peer:', peer);
        this.agent._connect(peer.address);
        // this.agent.connectTo(peer.address);
        return { status: 'success' };
      });

      const buildNetworkStatus = () => {
        console.debug('getting network status (settings):', this.http.agent.settings);
        console.debug('getting network status (address):', this.http.agent.listenAddress);
        return {
          clock: this.http.clock,
          contract: this.contract.id,
          documents: this._state.documents,
          network: {
            address: this.http.agent.listenAddress,
            listening: this.http.agent.listening
          },
          // Use the Peer service's view of the network so we include
          // both known peers and their connection status.
          peers: this.agent.publicPeers,
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

      console.trace('[HUB]', 'Starting agent...', this.agent.settings);
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
