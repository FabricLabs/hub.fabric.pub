'use strict';

/**
 * HTTP surface for distributed execution: manifest, epoch status, and optional
 * sidechain document (shared mutual state) for operators. Not a Fabric type —
 * document APIs live in `@fabric/core/functions/sidechainState`.
 * Binds routes on a {@link FabricHTTPServer} via `_addRoute` (same pattern as Hub services).
 *
 * Canonical paths use `/sidechain`. `/statechain` aliases are transitional for one release.
 */
const merge = require('lodash.merge');
const Service = require('@fabric/core/types/service');

class FabricDistributedExecutionHTTP extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.basePath='/services/distributed']
   * @param {Function} [settings.getManifest] Returns `Object` or `Promise.<Object>` JSON manifest.
   * @param {Function} [settings.getEpochStatus] Returns `Object` or `Promise.<Object>` epoch summary.
   * @param {Function} [settings.getSidechainState] Returns sidechain document head JSON.
   * @param {Function} [settings.submitSidechainStatePatch] Body/params → patch result.
   * @param {Function} [settings.getSidechainJournal] Returns journal summary.
   * @param {Function} [settings.getSidechainSnapshots] Returns snapshot index.
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = merge({
      name: 'FabricDistributedExecutionHTTP',
      basePath: '/services/distributed',
      getManifest: null,
      getEpochStatus: null,
      getSidechainState: null,
      submitSidechainStatePatch: null,
      getSidechainJournal: null,
      getSidechainSnapshots: null
    }, settings);
  }

  /**
   * Register routes on an HTTP server instance.
   * @param {Object} httpServer HTTP server instance exposing `_addRoute(method, path, handler)`.
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
    if (typeof this.settings.getSidechainState === 'function') {
      httpServer._addRoute('GET', `${base}/sidechain`, this._handleGetSidechain.bind(this));
      // Transitional alias (one release): prefer /sidechain
      httpServer._addRoute('GET', `${base}/statechain`, this._handleGetSidechain.bind(this));
    }
    if (typeof this.settings.submitSidechainStatePatch === 'function') {
      httpServer._addRoute('POST', `${base}/sidechain/patches`, this._handleSubmitPatch.bind(this));
      httpServer._addRoute('POST', `${base}/statechain/patches`, this._handleSubmitPatch.bind(this));
    }
    if (typeof this.settings.getSidechainJournal === 'function') {
      httpServer._addRoute('GET', `${base}/sidechain/journal`, this._handleGetJournal.bind(this));
      httpServer._addRoute('GET', `${base}/statechain/journal`, this._handleGetJournal.bind(this));
    }
    if (typeof this.settings.getSidechainSnapshots === 'function') {
      httpServer._addRoute('GET', `${base}/sidechain/snapshots`, this._handleGetSnapshots.bind(this));
      httpServer._addRoute('GET', `${base}/statechain/snapshots`, this._handleGetSnapshots.bind(this));
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

  async _handleGetSidechain (req, res) {
    try {
      const body = await Promise.resolve(this.settings.getSidechainState(req));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(body));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }

  async _handleSubmitPatch (req, res) {
    try {
      const params = (req && req.body && typeof req.body === 'object') ? req.body : {};
      const body = await Promise.resolve(this.settings.submitSidechainStatePatch(params, req));
      const err = body && body.status === 'error';
      res.setHeader('Content-Type', 'application/json');
      res.status(err ? 400 : 200).send(JSON.stringify(body));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }

  async _handleGetJournal (req, res) {
    try {
      const body = await Promise.resolve(this.settings.getSidechainJournal(req));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(body));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }

  async _handleGetSnapshots (req, res) {
    try {
      const body = await Promise.resolve(this.settings.getSidechainSnapshots(req));
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(body));
    } catch (e) {
      res.status(500).json({ status: 'error', message: e && e.message ? e.message : String(e) });
    }
  }
}

module.exports = FabricDistributedExecutionHTTP;
