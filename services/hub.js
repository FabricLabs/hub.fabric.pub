'use strict';

// Dependencies
const merge = require('lodash.merge');

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
        { method: 'GET', route: '/contracts', handler: ROUTES.contracts.list.bind(this) },
        { method: 'GET', route: '/contracts/:id', handler: ROUTES.contracts.view.bind(this) },
        { method: 'POST', route: '/contracts', handler: ROUTES.contracts.create.bind(this) },
        { method: 'POST', route: '/peers', handler: ROUTES.peers.create.bind(this) },
        { method: 'GET', route: '/peers', handler: ROUTES.peers.list.bind(this) }
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
    this.fs = new Filesystem(this.settings.fs);

    // HTTP Server
    this.http = new HTTPServer({
      name: 'hub.fabric.pub',
      path: 'assets',
      hostname: this.settings.http.hostname,
      interface: this.settings.http.interface,
      port: this.settings.http.port,
      middlewares: {
        userIdentifier: this._userMiddleware.bind(this)
      },
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
    console.debug('Adding route:', options);
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

    // Configure routes
    this._addAllRoutes();

    // Bind event listeners
    // this.trust(this.spa, 'FABRIC:SPA');
    this.trust(this.http, 'FABRIC:HTTP');
    this.trust(this.agent, 'FABRIC:AGENT');

    // Services (primarily HTTP)
    await Promise.all([
      // this.spa.start(),
      this.http.start(),
      this.agent.start()
    ]);

    // Local State
    this._state.status = 'STARTED';

    // Alert message
    await this.alert(`Hub HTTP service started.  Agent ID: ${this.id}`);

    return this;
  }

  /**
   * Stop the instance.
   * @returns {Hub} Instance of the {@link Hub}.
   */
  async stop () {
    await this.agent.stop();
    await this.http.stop();

    this._state.status = 'STOPPED';
    return this;
  }

  _userMiddleware (req, res, next) {
    // Initialize user object (null id = anonymous)
    req.user = {
      id: null
    };

    // TODO: use response signing (`X-Fabric-HTTP-Signature`, etc.)
    // const ephemera = new Key();
    let token = null;

    // Does the request have a cookie?
    if (req.headers.cookie) {
      // has cookie, parse it
      req.cookies = req.headers.cookie
        .split(';')
        .map((x) => x.trim().split(/=(.+)/))
        .reduce((acc, curr) => {
          acc[curr[0]] = curr[1];
          return acc;
        }, {});

      token = req.cookies['token'];
    }

    // no cookie, has authorization header
    if (!token && req.headers.authorization) {
      if (this.settings.debug) console.debug('found authorization header:', req.headers.authorization);
      const header = req.headers.authorization.split(' ');
      if (header[0] == 'Bearer' && header[1]) {
        token = header[1];
      }
    }

    // read token
    if (token) {
      const parts = token.split('.');
      if (parts && parts.length == 3) {
        // Named parts
        const headers = parts[0]; // TODO: check headers
        const payload = parts[1];
        const signature = parts[2]; // TODO: check signature

        // Decode the payload
        const inner = Token.base64UrlDecode(payload);

        try {
          const obj = JSON.parse(inner);
          if (this.settings.audit) this.emit('debug', `[AUTH] Bearer Token: ${JSON.stringify(obj)}`);
          req.user.id = obj.sub;
          req.user.role = obj.role || 'asserted';
          req.user.state = obj.state || {};
        } catch (exception) {
          console.error('Invalid Bearer Token:', inner)
        }
      }
    }

    next();
  }
}

module.exports = Hub;
