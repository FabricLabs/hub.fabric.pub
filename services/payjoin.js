'use strict';

const Service = require('@fabric/core/types/service');
const Actor = require('@fabric/core/types/actor');
const Tree = require('@fabric/core/types/tree');
const psbtFabric = require('../functions/psbtFabric');
const payjoinJoinmarketTaproot = require('../functions/payjoinJoinmarketTaproot');
const { buildFabricPayjoinProtocolProfile } = require('../functions/payjoinFabricProtocol');

class PayjoinService extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'Payjoin',
      enable: true,
      network: 'mainnet',
      endpointBasePath: '/services/payjoin',
      defaultSessionTTLSeconds: 1800,
      maxOpenSessions: 256,
      /** Optional 64-hex x-only federation pubkey for joinmarket taproot reserve leaf (mainnet recommended). */
      beaconFederationXOnlyHex: ''
    }, settings);

    this.fs = null;
    this.bitcoin = null;
    this.key = null;

    this._payjoinState = {
      sessions: {},
      counts: {
        sessions: 0,
        proposals: 0
      },
      merkle: {
        sessions: null
      },
      updatedAt: null
    };
  }

  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.bitcoin) this.bitcoin = deps.bitcoin;
    if (deps.key) this.key = deps.key;
    return this;
  }

  async start () {
    await this._loadFromFilesystem();
    this._ensureStateShape();
    this._refreshStateMerkle();
    return this;
  }

  async stop () {
    await this._persistIndex();
    return this;
  }

  getCapabilities () {
    const now = Date.now();
    const sessions = this.listSessions({ includeExpired: false, limit: 10 });
    const joinmarketTaprootTemplate = {
      template: payjoinJoinmarketTaproot.TEMPLATE_ID,
      contractVersion: payjoinJoinmarketTaproot.JOINMARKET_TAPROOT_CONTRACT_VERSION,
      description:
        'NUMS-internal P2TR with two tapleaves: hub operator checksig (default Joinmarket-style / ACP path) + beacon federation reserve checksig. BIP21 pj= unchanged.',
      requiresHubIdentityKey: true,
      beaconFederationXOnlyConfigured: !!(
        String(this.settings.beaconFederationXOnlyHex || '').trim() ||
        String(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX || '').trim()
      )
    };
    const fabricProtocol = buildFabricPayjoinProtocolProfile({
      endpointBasePath: this.settings.endpointBasePath,
      joinmarketTaprootTemplate: true,
      beaconFederationLeafConfigured: !!(
        String(this.settings.beaconFederationXOnlyHex || '').trim() ||
        String(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX || '').trim()
      )
    });
    return {
      available: this.settings.enable !== false,
      service: 'payjoin',
      bip: 'BIP78',
      asyncPayjoinRoadmap: 'BIP77',
      network: this.settings.network,
      endpointBasePath: this.settings.endpointBasePath,
      fabricProtocol,
      joinmarketTaprootTemplate,
      acpHubBoost: {
        description: 'SIGHASH_ALL|ANYONECANPAY payer PSBT + POST .../sessions/:id/acp-hub-boost (admin) appends Hub wallet input; outputs unchanged.',
        pathTemplate: `${this.settings.endpointBasePath}/sessions/:sessionId/acp-hub-boost`
      },
      defaults: {
        sessionTTLSeconds: Number(this.settings.defaultSessionTTLSeconds || 1800)
      },
      counts: Object.assign({}, this._payjoinState.counts),
      merkle: Object.assign({}, this._payjoinState.merkle),
      clock: now,
      recentSessions: sessions.map((session) => this._publicSessionView(session, { includeProposals: false }))
    };
  }

  listSessions (options = {}) {
    const includeExpired = !!options.includeExpired;
    const limit = Math.max(1, Math.min(200, Number(options.limit || 25)));
    const now = Date.now();
    const sessions = Object.values(this._payjoinState.sessions || {})
      .filter((session) => {
        if (!session || typeof session !== 'object') return false;
        if (includeExpired) return true;
        if (!session.expiresAt) return true;
        return new Date(session.expiresAt).getTime() > now;
      })
      .sort((a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime())
      .slice(0, limit);
    return sessions;
  }

  getSession (sessionId, options = {}) {
    const id = String(sessionId || '').trim();
    if (!id) return null;
    const session = this._payjoinState.sessions[id];
    if (!session) return null;
    return this._publicSessionView(session, options);
  }

  async createDepositSession (input = {}) {
    const receiveTemplate = String(input.receiveTemplate || '').trim().toLowerCase();
    let address = String(input.address || '').trim();
    let receiveContract = null;

    if (receiveTemplate === 'joinmarket_taproot_v1') {
      if (!this.key || typeof this.key.pubkey !== 'string' || !this.key.pubkey) {
        throw new Error('Hub identity key is required for joinmarket taproot receive sessions.');
      }
      const opBuf = Buffer.from(String(this.key.pubkey).trim(), 'hex');
      if (opBuf.length !== 33) {
        throw new Error('Hub identity pubkey must be a 33-byte compressed key.');
      }
      const federationX = payjoinJoinmarketTaproot.resolveBeaconFederationXOnly({
        explicitHex: input.federationXOnlyHex,
        configHex: this.settings.beaconFederationXOnlyHex,
        networkName: this.settings.network
      });
      const built = payjoinJoinmarketTaproot.buildPayjoinJoinmarketTaproot({
        networkName: this.settings.network,
        operatorPubkeyCompressed: opBuf,
        federationXOnly: federationX
      });
      address = built.address;
      receiveContract = {
        template: built.template,
        contractVersion: built.contractVersion,
        network: built.network,
        operatorPubkeyCompressedHex: built.operatorPubkeyCompressedHex,
        federationXOnlyHex: built.federationXOnlyHex,
        internalPubkeyHex: built.internalPubkeyHex,
        leafOrder: built.leafOrder,
        leaves: built.leaves
      };
    }

    const walletId = String(input.walletId || '').trim() || 'default';
    const amountSats = Number(input.amountSats || 0);
    const label = String(input.label || input.memo || '').trim();
    const memo = String(input.memo || '').trim();
    const ttlSeconds = Math.max(30, Math.min(86400, Number(input.expiresInSeconds || this.settings.defaultSessionTTLSeconds || 1800)));

    if (!address) throw new Error('Address is required for a Payjoin deposit session (or use receiveTemplate joinmarket_taproot_v1).');

    const openSessions = this.listSessions({ includeExpired: false, limit: 1000 });
    if (openSessions.length >= Number(this.settings.maxOpenSessions || 256)) {
      throw new Error('Too many open Payjoin sessions. Try again later.');
    }

    const now = new Date();
    const created = now.toISOString();
    const expiresAt = new Date(now.getTime() + (ttlSeconds * 1000)).toISOString();
    const payload = {
      walletId,
      address,
      amountSats: Number.isFinite(amountSats) ? Math.max(0, Math.round(amountSats)) : 0,
      label,
      memo,
      created,
      expiresAt
    };
    const actor = new Actor({ content: payload });
    const sessionId = actor.id;
    const proposalURL = `${this.settings.endpointBasePath}/sessions/${sessionId}/proposals`;
    const bip21Uri = this._buildBIP21Uri(address, payload.amountSats, label, proposalURL);

    const createdEvent = this._createEvent('PAYJOIN_SESSION_CREATED', {
      sessionId,
      walletId,
      address,
      amountSats: payload.amountSats
    });

    const session = {
      id: sessionId,
      created,
      updatedAt: created,
      expiresAt,
      status: 'awaiting-proposal',
      walletId,
      address,
      amountSats: payload.amountSats,
      label,
      memo,
      bip21Uri,
      proposalURL,
      receiveTemplate: receiveTemplate || undefined,
      receiveContract: receiveContract || undefined,
      proposals: {},
      events: [createdEvent],
      merkle: {
        proposals: null,
        events: null
      }
    };

    this._payjoinState.sessions[sessionId] = session;
    this._payjoinState.counts.sessions = Object.keys(this._payjoinState.sessions).length;
    this._refreshSessionMerkle(session);
    this._refreshStateMerkle();
    await this._persistSession(session);
    await this._persistIndex();

    return this._publicSessionView(session, { includeProposals: true });
  }

  async submitProposal (sessionId, proposalInput = {}) {
    const id = String(sessionId || '').trim();
    if (!id) throw new Error('Session ID is required.');

    const session = this._payjoinState.sessions[id];
    if (!session) throw new Error('Payjoin session not found.');

    const now = new Date();
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= now.getTime()) {
      session.status = 'expired';
      session.updatedAt = now.toISOString();
      await this._persistSession(session);
      await this._persistIndex();
      throw new Error('Payjoin session has expired.');
    }

    const psbt = String(proposalInput.psbt || '').trim();
    const txhex = String(proposalInput.txhex || '').trim();
    if (!psbt && !txhex) throw new Error('A Payjoin proposal must include psbt or txhex.');

    const proposalActor = new Actor({
      content: {
        sessionId: id,
        psbt,
        txhex,
        created: now.toISOString()
      }
    });
    const proposalId = proposalActor.id;
    const analysis = await this._analyzeProposal(psbt);
    const proposal = {
      id: proposalId,
      sessionId: id,
      created: now.toISOString(),
      status: 'accepted-for-review',
      psbt,
      txhex,
      analysis
    };
    const proposalTxid = this.extractProposalTxid(proposal);
    if (proposalTxid) proposal.proposalTxid = proposalTxid;

    session.proposals[proposalId] = proposal;
    session.status = 'proposal-received';
    session.updatedAt = now.toISOString();
    session.events.push(this._createEvent('PAYJOIN_PROPOSAL_RECEIVED', {
      sessionId: id,
      proposalId
    }));

    this._payjoinState.counts.proposals = this._countAllProposals();
    this._refreshSessionMerkle(session);
    this._refreshStateMerkle();
    await this._persistSession(session);
    await this._persistIndex();

    return {
      status: 'success',
      sessionId: id,
      proposal: Object.assign({}, proposal),
      session: this._publicSessionView(session, { includeProposals: true })
    };
  }

  _buildBIP21Uri (address, amountSats, label, proposalURL) {
    const params = [];
    if (Number.isFinite(amountSats) && amountSats > 0) {
      params.push(`amount=${(amountSats / 100000000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`);
    }
    if (label) params.push(`label=${encodeURIComponent(label)}`);
    if (proposalURL) params.push(`pj=${encodeURIComponent(proposalURL)}`);
    return `bitcoin:${address}${params.length ? `?${params.join('&')}` : ''}`;
  }

  _createEvent (type, payload = {}) {
    const created = new Date().toISOString();
    const actor = new Actor({ content: { type, payload, created } });
    return { id: actor.id, type, created, payload };
  }

  /**
   * Best-effort txid for wallet labeling (final tx, unsigned PSBT id, or decodepsbt hints).
   * @param {{ psbt?: string, txhex?: string, analysis?: object, proposalTxid?: string }} proposal
   * @returns {string} hex64 or ''
   */
  extractProposalTxid (proposal) {
    if (!proposal || typeof proposal !== 'object') return '';
    const cached = String(proposal.proposalTxid || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(cached)) return cached;
    const bitcoinjs = require('bitcoinjs-lib');
    const hex = String(proposal.txhex || '').trim();
    if (hex) {
      try {
        return bitcoinjs.Transaction.fromHex(hex).getId();
      } catch (_) {}
    }
    const p = String(proposal.psbt || '').trim();
    if (p) {
      try {
        return psbtFabric.extractTransactionId(p);
      } catch (_) {}
    }
    const a = proposal.analysis;
    if (a && !a.error) {
      const u = a.unsigned_txid || (a.tx && typeof a.tx === 'object' ? a.tx.txid : null);
      if (typeof u === 'string' && /^[a-fA-F0-9]{64}$/.test(u)) return u.toLowerCase();
    }
    return '';
  }

  /**
   * List-safe proposal row (no PSBT / txhex bodies).
   * @param {object} proposal
   * @returns {object}
   */
  _proposalListSummary (proposal) {
    if (!proposal) return null;
    const proposalTxid = this.extractProposalTxid(proposal);
    return {
      id: proposal.id,
      sessionId: proposal.sessionId,
      created: proposal.created,
      status: proposal.status,
      proposalTxid: proposalTxid || undefined,
      hasPsbt: !!proposal.psbt,
      hasTxhex: !!proposal.txhex
    };
  }

  _publicSessionView (session, options = {}) {
    const includeProposals = options.includeProposals !== false;
    const summariesOnly = !!options.proposalSummariesOnly;
    const proposalRows = includeProposals
      ? Object.values(session.proposals || {})
        .sort((a, b) => new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime())
      : null;
    return {
      id: session.id,
      created: session.created,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      status: session.status,
      walletId: session.walletId,
      address: session.address,
      amountSats: session.amountSats,
      label: session.label,
      memo: session.memo,
      bip21Uri: session.bip21Uri,
      proposalURL: session.proposalURL,
      receiveTemplate: session.receiveTemplate,
      receiveContract: session.receiveContract,
      proposalCount: Object.keys(session.proposals || {}).length,
      merkle: session.merkle || {},
      proposals: proposalRows
        ? (summariesOnly ? proposalRows.map((p) => this._proposalListSummary(p)) : proposalRows)
        : undefined
    };
  }

  _refreshSessionMerkle (session) {
    const proposalLeaves = Object.values(session.proposals || {})
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((proposal) => JSON.stringify({ id: proposal.id, status: proposal.status }));
    const eventLeaves = (session.events || [])
      .map((event) => JSON.stringify({ id: event.id, type: event.type, created: event.created }));
    const proposalTree = new Tree({ leaves: proposalLeaves });
    const eventTree = new Tree({ leaves: eventLeaves });
    session.merkle = {
      proposals: this._treeRootToString(proposalTree),
      events: this._treeRootToString(eventTree)
    };
    return session.merkle;
  }

  _refreshStateMerkle () {
    const state = this._ensureStateShape();
    const leaves = Object.values(state.sessions || {})
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((session) => JSON.stringify({ id: session.id, status: session.status, root: session.merkle && session.merkle.proposals }));
    const tree = new Tree({ leaves });
    state.merkle.sessions = this._treeRootToString(tree);
    state.updatedAt = new Date().toISOString();
    return state.merkle.sessions;
  }

  _treeRootToString (tree) {
    const root = tree && tree.root ? tree.root : null;
    if (!root) return null;
    if (Buffer.isBuffer(root)) return root.toString('hex');
    return String(root);
  }

  _countAllProposals () {
    let total = 0;
    for (const session of Object.values(this._payjoinState.sessions || {})) {
      total += Object.keys((session && session.proposals) || {}).length;
    }
    return total;
  }

  async _analyzeProposal (psbt) {
    if (!psbt || !this.bitcoin || typeof this.bitcoin._makeRPCRequest !== 'function') return null;
    try {
      return await this.bitcoin._makeRPCRequest('decodepsbt', [psbt]);
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  }

  async _loadFromFilesystem () {
    if (!this.fs || typeof this.fs.readFile !== 'function') return;
    try {
      const raw = this.fs.readFile('payjoin/index.json');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      this._payjoinState.sessions = parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
      this._payjoinState.counts = parsed.counts && typeof parsed.counts === 'object'
        ? parsed.counts
        : {
            sessions: Object.keys(this._payjoinState.sessions).length,
            proposals: this._countAllProposals()
          };
      this._payjoinState.merkle = parsed.merkle && typeof parsed.merkle === 'object' ? parsed.merkle : { sessions: null };
      this._payjoinState.updatedAt = parsed.updatedAt || null;
      this._ensureStateShape();
    } catch (err) {
      this.emit('warning', '[PAYJOIN] Failed loading index from filesystem:', err && err.message ? err.message : err);
    }
  }

  _ensureStateShape () {
    if (!this._payjoinState || typeof this._payjoinState !== 'object') this._payjoinState = {};
    const base = this._payjoinState;

    if (!base.sessions || typeof base.sessions !== 'object' || Array.isArray(base.sessions)) base.sessions = {};
    if (!base.counts || typeof base.counts !== 'object' || Array.isArray(base.counts)) base.counts = {};
    if (!base.merkle || typeof base.merkle !== 'object' || Array.isArray(base.merkle)) base.merkle = {};
    if (!Object.prototype.hasOwnProperty.call(base.merkle, 'sessions')) base.merkle.sessions = null;
    if (!Object.prototype.hasOwnProperty.call(base, 'updatedAt')) base.updatedAt = null;

    base.counts.sessions = Number.isFinite(Number(base.counts.sessions))
      ? Number(base.counts.sessions)
      : Object.keys(base.sessions).length;
    base.counts.proposals = Number.isFinite(Number(base.counts.proposals))
      ? Number(base.counts.proposals)
      : this._countAllProposals();

    return base;
  }

  async _persistSession (session) {
    if (!this.fs || typeof this.fs.publish !== 'function' || !session || !session.id) return;
    await this.fs.publish(`payjoin/sessions/${session.id}.json`, session);
  }

  async _persistIndex () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    const snapshot = {
      sessions: this._payjoinState.sessions,
      counts: this._payjoinState.counts,
      merkle: this._payjoinState.merkle,
      updatedAt: this._payjoinState.updatedAt
    };
    await this.fs.publish('payjoin/index.json', snapshot);
  }
}

module.exports = PayjoinService;
