'use strict';

/**
 * @fileoverview The Hub's signer rules on disk (`stores/hub/signer-rules.json`):
 * the rules (`functions/signerRules.js`), each rule's spend and rate counters,
 * and a log of every decision a rule made. Writes are atomic (temp file + rename).
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const {
  validateRules,
  evaluate,
  usageAt,
  countUse
} = require('../functions/signerRules');

const FILE = 'signer-rules.json';
const MAX_DECISIONS = 500;

class SignerRules extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.dir] Store directory; in memory when omitted.
   * @param {Function} [settings.now]
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ dir: null }, settings);
    this._now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    this._state = { rules: [], usage: {}, decisions: [] };
    this._valid = [];
    this._invalid = [];
  }

  get file () {
    return this.settings.dir ? path.join(this.settings.dir, FILE) : null;
  }

  /**
   * Read the file. A file that cannot be read leaves no rules (ask for everything).
   * @returns {SignerRules}
   */
  load () {
    if (!this.file) return this;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err && err.code !== 'ENOENT') this.emit('warning', `[SIGNER-RULES] ${FILE} unreadable, asking for everything: ${err.message}`);
    }
    if (raw && typeof raw === 'object') {
      this._state = {
        rules: Array.isArray(raw.rules) ? raw.rules : [],
        usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : {},
        decisions: Array.isArray(raw.decisions) ? raw.decisions.slice(-MAX_DECISIONS) : []
      };
    }
    this._check();
    return this;
  }

  /** @private */
  _check () {
    const { rules, invalid } = validateRules(this._state.rules);
    this._valid = rules;
    this._invalid = invalid;
  }

  /** @private */
  _save () {
    if (!this.file) return;
    fs.mkdirSync(this.settings.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /**
   * Stored rules (as written), the valid ones, and why the others are not.
   * @returns {{ rules: Array<Object>, valid: Array<Object>, invalid: Array<Object> }}
   */
  list () {
    const now = this._now();
    return {
      rules: this._state.rules.slice(),
      valid: this._valid.map((r) => Object.assign({}, r, { usage: usageAt(this._state.usage[r.id], now) })),
      invalid: this._invalid.slice()
    };
  }

  /**
   * Replace every rule. Invalid rules are kept so the operator can fix them,
   * and sign nothing until they are fixed or removed.
   * @param {Array<Object>} rules
   * @returns {Object} {@link SignerRules#list}
   */
  set (rules) {
    if (!Array.isArray(rules)) throw new TypeError('rules must be a list');
    this._state.rules = JSON.parse(JSON.stringify(rules));
    this._check();
    const ids = new Set(this._valid.map((r) => r.id));
    for (const id of Object.keys(this._state.usage)) if (!ids.has(id)) delete this._state.usage[id];
    this._save();
    return this.list();
  }

  /**
   * Decide a request from its facts (`requestFacts` / `factsForRequest`).
   * @param {Object} facts
   * @param {Object} [context] `{ identityPeers, maxWithdrawalSats }`
   * @returns {{ action: string, rule: (string|undefined), reason: (string|undefined) }}
   */
  decide (facts, context = {}) {
    const now = this._now();
    return evaluate(this._valid, facts, {
      identityPeers: context.identityPeers || [],
      maxWithdrawalSats: context.maxWithdrawalSats,
      anyInvalid: this._invalid.length > 0,
      usage: (id) => usageAt(this._state.usage[id], now)
    });
  }

  /**
   * Log a decision and, when a rule signed, count it against the rule's limits.
   * @param {Object} decision `{ action, rule, reason }`
   * @param {Object} facts
   * @param {Object} [extra] `{ request, title }` shown in the log
   * @returns {Object} The log entry.
   */
  record (decision, facts, extra = {}) {
    const now = this._now();
    if (decision.action === 'sign' && decision.rule) {
      this._state.usage[decision.rule] = countUse(this._state.usage[decision.rule], facts, now);
    }
    const entry = {
      at: now,
      action: decision.action,
      rule: decision.rule || null,
      reason: decision.reason || null,
      scope: facts.scope,
      kind: facts.kind || null,
      from: facts.from,
      origin: facts.origin,
      federationId: facts.federationId,
      amountSats: facts.amountSats,
      destination: facts.destination,
      request: extra.request || null,
      title: extra.title || null
    };
    this._state.decisions.push(entry);
    if (this._state.decisions.length > MAX_DECISIONS) this._state.decisions.splice(0, this._state.decisions.length - MAX_DECISIONS);
    this._save();
    this.emit('decision', entry);
    return entry;
  }

  /**
   * Newest decisions first.
   * @param {number} [limit=100]
   * @returns {Array<Object>}
   */
  decisions (limit = 100) {
    const n = Math.max(1, Math.min(MAX_DECISIONS, Number(limit) || 100));
    return this._state.decisions.slice(-n).reverse();
  }
}

SignerRules.FILE = FILE;

module.exports = SignerRules;
