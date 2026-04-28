'use strict';

/**
 * First-time setup service for Hub.
 * Creates and signs an admin token (client-only, never stored on server),
 * verifies admin auth via Token.verifySigned, and supports token refresh.
 */

const Token = require('@fabric/core/types/token');

const STATE_FILE = 'STATE';
const SETTINGS_KEY = 'settings';
const GLOBAL_SETTINGS = [
  'NODE_NAME',
  'NODE_PERSONALITY',
  'NODE_TEMPERATURE',
  'NODE_GOALS',
  'IS_CONFIGURED',
  'BITCOIN_NETWORK',
  'BITCOIN_MANAGED',
  'BITCOIN_HOST',
  'BITCOIN_RPC_PORT',
  'BITCOIN_USERNAME',
  'BITCOIN_PASSWORD',
  'LIGHTNING_MANAGED',
  'LIGHTNING_SOCKET',
  'DISK_ALLOCATION_MB',
  'COST_PER_BYTE_SATS',
  /** When true, hub HTTP binds 0.0.0.0; when false, 127.0.0.1 (unless FABRIC_HUB_INTERFACE / INTERFACE is set). Changing via PUT rebinds the listener at runtime when env does not override. */
  'HTTP_SHARED_MODE'
];

/**
 * Setup service for Hub first-time configuration.
 */
class SetupService {
  constructor (settings = {}) {
    this.settings = Object.assign({
      fs: null,
      key: null,
      state: null
    }, settings);
    this.fs = this.settings.fs;
    this._rootKey = this.settings.key;
    this._state = this.settings.state;
  }

  /**
   * Get setup status. Returns { configured, needsSetup }.
   * @returns {{configured: boolean, needsSetup: boolean}}
   */
  getSetupStatus () {
    const settings = this._loadSettings();
    const isConfigured = settings.IS_CONFIGURED === true || settings.IS_CONFIGURED === 'true';
    return {
      configured: !!isConfigured,
      needsSetup: !isConfigured
    };
  }

  _loadStateContent () {
    if (this._state && typeof this._state === 'object') return this._state;
    if (!this.fs) return {};
    const raw = this.fs.readFile(STATE_FILE);
    if (!raw) return {};
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    } catch {
      return {};
    }
  }

  async _saveStateContent (content) {
    if (!this.fs) throw new Error('Filesystem not available');
    if (this._state && typeof this._state === 'object' && content !== this._state) {
      Object.assign(this._state, content);
    }
    await this.fs.publish(STATE_FILE, JSON.stringify(content, null, '  '));
  }

  /**
   * Load settings from filesystem.
   * @returns {Object}
   */
  _loadSettings () {
    const state = this._loadStateContent();
    const root = state && typeof state === 'object' ? state[SETTINGS_KEY] : null;
    if (!root || typeof root !== 'object') return {};
    return root;
  }

  /**
   * Save settings to filesystem.
   * @param {Object} settings
   */
  async _saveSettings (settings) {
    const state = this._loadStateContent();
    state[SETTINGS_KEY] = settings;
    await this._saveStateContent(state);
  }

  /**
   * List all settings.
   * @returns {Object} Map of name -> value
   */
  listSettings () {
    const settings = this._loadSettings();
    const result = {};
    for (const [name, raw] of Object.entries(settings)) {
      let value = raw;
      if (value !== undefined && typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // keep as string
        }
      }
      result[name] = value;
    }
    return result;
  }

  /**
   * Get a setting value.
   * @param {string} name
   * @returns {*} Value or undefined
   */
  getSetting (name) {
    const settings = this._loadSettings();
    let value = settings[name];
    if (value !== undefined && typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // keep as string
      }
    }
    return value;
  }

  /**
   * Set a setting value.
   * @param {string} name
   * @param {*} value
   */
  async setSetting (name, value) {
    const settings = this._loadSettings();
    settings[name] = typeof value === 'string' ? value : JSON.stringify(value);
    await this._saveSettings(settings);
  }

  /**
   * Create and sign an admin token. Token is returned to the client only; never stored on server.
   * Only succeeds when not yet configured (first client).
   * @param {Object} [initialConfig] Optional initial settings (NODE_NAME, etc.)
   * @returns {Promise<{token: string, configured: boolean, expiresAt?: number}>}
   */
  async createAdminToken (initialConfig = {}) {
    const status = this.getSetupStatus();
    if (status.configured) {
      throw new Error('Hub is already configured. Admin token cannot be recreated.');
    }

    if (!this._rootKey) throw new Error('Signing key not available');

    const adminToken = new Token({
      capability: 'OP_IDENTITY',
      issuer: this._rootKey,
      subject: 'admin'
    });
    const tokenString = adminToken.toSignedString();

    // Apply initial config (no token storage)
    const settings = this._loadSettings();
    for (const [key, val] of Object.entries(initialConfig)) {
      if (key !== 'IS_CONFIGURED' && (GLOBAL_SETTINGS.includes(key) || key.startsWith('NODE_') || key.startsWith('BITCOIN_') || key.startsWith('LIGHTNING_') || key.startsWith('DISK_') || key.startsWith('COST_PER_BYTE_'))) {
        settings[key] = typeof val === 'string' ? val : JSON.stringify(val);
      }
    }
    settings.IS_CONFIGURED = true;
    if (this.fs) await this._saveSettings(settings);

    console.log('[HUB] [SETUP] Admin token created (client-only). Hub is now configured.');

    const payload = Token.verifySigned(tokenString, this._rootKey);
    return {
      token: tokenString,
      configured: true,
      expiresAt: payload && payload.exp ? payload.exp * 1000 : undefined
    };
  }

  /**
   * Refresh an admin token. Verifies the current token and returns a new one.
   * Token is never stored on server.
   * @param {string} currentToken
   * @returns {Promise<{token: string, expiresAt?: number}>}
   */
  async refreshAdminToken (currentToken) {
    if (!currentToken || typeof currentToken !== 'string') {
      throw new Error('Current token required for refresh.');
    }
    if (!this.verifyAdminToken(currentToken)) {
      throw new Error('Invalid or expired token. Cannot refresh.');
    }
    if (!this._rootKey) throw new Error('Signing key not available');

    const adminToken = new Token({
      capability: 'OP_IDENTITY',
      issuer: this._rootKey,
      subject: 'admin'
    });
    const tokenString = adminToken.toSignedString();
    const payload = Token.verifySigned(tokenString, this._rootKey);
    return {
      token: tokenString,
      expiresAt: payload && payload.exp ? payload.exp * 1000 : undefined
    };
  }

  /**
   * Verify an admin token. Uses Token.verifySigned (cryptographic signature); no server-side storage.
   * @param {string} bearerToken
   * @returns {boolean}
   */
  verifyAdminToken (bearerToken) {
    if (!bearerToken || typeof bearerToken !== 'string') return false;
    if (!this._rootKey) return false;
    return Token.verifySigned(bearerToken, this._rootKey) !== null;
  }

  /**
   * Extract Bearer token from request.
   * @param {Object} req
   * @returns {string|null}
   */
  static extractBearerToken (req) {
    const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
    if (!auth || typeof auth !== 'string') return null;
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  }
}

SetupService.GLOBAL_SETTINGS = GLOBAL_SETTINGS;
SetupService.STATE_FILE = STATE_FILE;
SetupService.SETTINGS_KEY = SETTINGS_KEY;

module.exports = SetupService;
