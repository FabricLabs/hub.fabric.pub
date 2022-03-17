'use strict';

const Service = require('@fabric/core/types/service');
const Peer = require('@fabric/core/types/peer');
const HTTP = require('@fabric/http/types/server');

class Hub extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      port: 7777,
      http: {
        host: 'localhost',
        port: 8080,
        secure: false
      },
      routes: [
        { method: 'GET', route: '/contracts', handler: this._handleContractListRequest.bind(this) },
        { method: 'GET', route: '/contracts/:id', handler: this._handleContractViewRequest.bind(this) },
        { method: 'POST', route: '/contracts', handler: this._handleContractCreateRequest.bind(this) }
      ],
      contracts: [],
      documents: {}
    }, settings);

    this.http = new HTTP(this.settings.http);
    this.peer = new Peer(this.settings);

    this._state = {
      contracts: [],
      documents: {},
      status: 'PAUSED'
    };

    return this;
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
    // Configure routes
    this._addAllRoutes();

    // Bind event listeners
    // this.trust(this.spa, 'FABRIC:SPA');
    this.trust(this.http, 'FABRIC:HTTP');

    // Services (primarily HTTP)
    // await this.spa.start();
    await this.http.start();

    // Local State
    this._state.status = 'STARTED';

    // Alert message
    await this.alert(`Portal HTTP service started.  Agent ID: ${this.id}`);

    return this;
  }

  async stop () {
    await this.http.stop();
    // await this.portal.stop();
    await this.zapier.stop();
    this._state.status = 'STOPPED';
    return this;
  }
}

module.exports = Hub;