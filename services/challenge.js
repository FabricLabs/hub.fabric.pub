'use strict';

/**
 * Tracks proof-of-storage challenge schedules for `StorageContract` rows on this Hub.
 * Syncs from `collections.contracts` on start and persists a JSON index under the Hub filesystem.
 */
const Service = require('@fabric/core/types/service');

const CADENCE_MS = {
  hourly: 3600000,
  daily: 86400000,
  weekly: 604800000,
  monthly: 2592000000
};

class ChallengeService extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Challenge',
      enable: true,
      persistPath: 'fabric/storage-challenges.json'
    }, settings);

    this.hub = null;
    this.fs = null;
    /** @type {Map<string, object>} Storage contract id → challenge record */
    this._challenges = new Map();
  }

  attach (deps = {}) {
    if (deps.hub) this.hub = deps.hub;
    if (deps.fs) this.fs = deps.fs;
    return this;
  }

  _nextDueIso (cadence) {
    const ms = CADENCE_MS[String(cadence)] || CADENCE_MS.daily;
    return new Date(Date.now() + ms).toISOString();
  }

  /**
   * @param {object} contract Hub `StorageContract` row
   * @returns {Promise<object|null>}
   */
  async registerFromStorageContract (contract) {
    if (!contract || contract.type !== 'StorageContract' || !contract.id) return null;
    const id = contract.id;
    const record = {
      type: 'Challenge',
      id: `challenge:${id}`,
      contractId: id,
      documentId: contract.document,
      challengeCadence: contract.challengeCadence || 'daily',
      responseDeadline: contract.responseDeadline || '10s',
      status: 'scheduled',
      nextChallengeAt: this._nextDueIso(contract.challengeCadence),
      updatedAt: new Date().toISOString()
    };
    this._challenges.set(id, record);
    await this._persist();
    this.emit('debug', `[ChallengeService] registered challenge for contract ${id}`);
    return record;
  }

  /**
   * Ensure every `StorageContract` in hub state has a challenge row.
   * @returns {number} number of newly registered rows
   */
  syncFromHubState () {
    if (!this.hub || !this.hub._state || !this.hub._state.content) return 0;
    const contracts = this.hub._state.content.collections && this.hub._state.content.collections.contracts;
    if (!contracts || typeof contracts !== 'object') return 0;
    let n = 0;
    for (const c of Object.values(contracts)) {
      if (c && c.type === 'StorageContract' && c.id && !this._challenges.has(c.id)) {
        this._challenges.set(c.id, {
          type: 'Challenge',
          id: `challenge:${c.id}`,
          contractId: c.id,
          documentId: c.document,
          challengeCadence: c.challengeCadence || 'daily',
          responseDeadline: c.responseDeadline || '10s',
          status: 'scheduled',
          nextChallengeAt: this._nextDueIso(c.challengeCadence),
          updatedAt: new Date().toISOString()
        });
        n++;
      }
    }
    return n;
  }

  _loadPersisted () {
    if (!this.fs || !this.settings.persistPath) return;
    try {
      const raw = this.fs.readFile(this.settings.persistPath);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.challenges && typeof data.challenges === 'object') {
        for (const v of Object.values(data.challenges)) {
          if (v && v.contractId) this._challenges.set(String(v.contractId), v);
        }
      }
    } catch (_) {}
  }

  async _persist () {
    if (!this.fs || !this.settings.persistPath) return;
    try {
      const challenges = {};
      for (const [k, v] of this._challenges) challenges[k] = v;
      const doc = { challenges, updatedAt: new Date().toISOString() };
      await this.fs.publish(this.settings.persistPath, doc);
    } catch (e) {
      this.emit('warning', `[ChallengeService] persist failed: ${e && e.message ? e.message : e}`);
    }
  }

  list () {
    return Array.from(this._challenges.values());
  }

  getByContractId (contractId) {
    return this._challenges.get(String(contractId)) || null;
  }

  getCapabilities () {
    const list = this.list();
    return {
      service: 'challenge',
      available: this.settings.enable !== false,
      endpointBasePath: '/services/challenges',
      count: list.length
    };
  }

  async start () {
    this._loadPersisted();
    const added = this.syncFromHubState();
    if (added > 0) await this._persist();
    return this;
  }
}

module.exports = ChallengeService;
