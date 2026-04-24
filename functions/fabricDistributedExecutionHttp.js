'use strict';

/**
 * Vendored from `@fabric/http/types/distributedExecutionHttp` (FabricLabs/fabric-http).
 * Hub ships a copy so `npm install` works when the git tarball omits this file.
 *
 * HTTP surface for distributed execution: manifest and epoch status for operators.
 * Binds routes on a {@link FabricHTTPServer} via `_addRoute` (same pattern as Hub services).
 */
const merge = require('lodash.merge');
const Service = require('@fabric/core/types/service');

class FabricDistributedExecutionHTTP extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.basePath='/services/distributed']
   * @param {() => object|Promise<object>} [settings.getManifest] — JSON manifest (see `DistributedExecution.parseDistributedManifestV1`)
   * @param {() => object|Promise<object>} [settings.getEpochStatus] — beacon / epoch summary for UIs
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = merge({
      name: 'FabricDistributedExecutionHTTP',
      basePath: '/services/distributed',
      getManifest: null,
      getEpochStatus: null
    }, settings);
  }

  /**
   * Register routes on an HTTP server instance.
   * @param {*} httpServer — Fabric HTTPServer with `_addRoute`
   */
  bind (httpServer) {
    if (!httpServer || typeof httpServer._addRoute !== 'function') {
      throw new Error('FabricDistributedExecutionHTTP.bind requires a server with _addRoute');
    }
    const base = String(this.settings.basePath || '/services/distributed').replace(/\/$/, '');
    if (typeof this.settings.getManifest === 'function') {
      httpServer._addRoute('GET', `${base}/manifest`, this._handleManifest.bind(this));
    }
    if (typeof this.settings.getEpochStatus === 'function') {
      httpServer._addRoute('GET', `${base}/epoch`, this._handleEpoch.bind(this));
    }
  }

  async _handleManifest (req, res) {
    try {
      const manifest = await Promise.resolve(this.settings.getManifest(req));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(manifest));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }

  async _handleEpoch (req, res) {
    try {
      const body = await Promise.resolve(this.settings.getEpochStatus(req));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(body));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }
}

module.exports = FabricDistributedExecutionHTTP;
