'use strict';

// Fabric Types
const Contract = require('@fabric/core/types/contract');
const Filesystem = require('@fabric/core/types/filesystem');
const Peer = require('@fabric/core/types/peer');
const Service = require('@fabric/core/types/service');

// Fabric HTTP
const HTTP = require('@fabric/http/types/server');

class Hub extends Service {
  constructor (settings = {}) {
    super(settings);

    // Settings
    this.settings = Object.assign({
      alias: '@fabric/hub',
      port: 7777,
      peers: [],
      http: {
        host: 'localhost',
        port: 8080,
        secure: false
      },
      interval: 60000, // 1 minute
      routes: [
        { method: 'GET', route: '/contracts', handler: this._handleContractListRequest.bind(this) },
        { method: 'GET', route: '/contracts/:id', handler: this._handleContractViewRequest.bind(this) },
        { method: 'POST', route: '/contracts', handler: this._handleContractCreateRequest.bind(this) }
      ],
      contracts: [],
      documents: {},
      fs: {
        path: `stores/hub`
      },
      state: Object.assign({
        status: 'PAUSED'
      }, settings.state)
    }, settings);

    // Fabric
    this.agent = new Peer(this.settings);
    this.contract = new Contract({
      state: this.settings.state
    });

    // Storage and Network
    this.fs = new Filesystem(this.settings.fs);
    this.http = new HTTP(this.settings.http);

    // State
    this._state = {
      content: this.settings.state,
      contracts: [],
      documents: {},
      status: 'PAUSED'
    };

    return this;
  }

  commit () {
    this.fs.publish('STATE', JSON.stringify(this.state, null, '  '));
  }

  // TODO: upstream
  _addAllRoutes () {
    for (let i = 0; i < this.settings.routes; i++) {
      this._addRoute(this.settings.routes[i]);
    }

    return this;
  }

  // TODO: upstream (deprecate, should already exist)
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

  _handleContractCreateRequest (req, res, next) {
    return res.send({ status: 'error', message: 'Not yet implemented.' });
  }

  async start () {
    await this.fs.start();

    // Load prior state
    const file = this.fs.readFile('STATE');
    const state = (file) ? JSON.parse(file) : this.state;

    // Assign properties
    Object.assign(this._state.content, state);

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

  async stop () {
    await this.agent.stop();
    await this.http.stop();

    this._state.status = 'STOPPED';
    return this;
  }
}

module.exports = Hub;
