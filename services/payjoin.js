'use strict';

const Service = require('@fabric/core/types/service');
const Actor = require('@fabric/core/types/actor');
const Tree = require('@fabric/core/types/tree');
const psbtFabric = require('../functions/psbtFabric');
const payjoinJoinmarketTaproot = require('../functions/payjoinJoinmarketTaproot');
const payjoinReceiverContribution = require('../functions/payjoinReceiverContribution');
const { buildFabricPayjoinProtocolProfile } = require('../functions/payjoinFabricProtocol');
const { resolvePayjoinPublicOrigin, joinOriginPath } = require('../functions/payjoinPublicOrigin');
const { PayjoinAsyncMailbox } = require('../functions/payjoinAsyncMailbox');
const { SATS_PER_BTC } = require('../constants');
const { encodeBitcoinUri } = require('@fabric/core/functions/bip21');

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
      /** Optional absolute origin for BIP21 pj= (overrides env when set). */
      publicOrigin: '',
      hostname: '',
      httpPort: 0,
      // BIP78 receiver contribution: the Hub adds one wallet coin to each proposal.
      // null = on for regtest only; env FABRIC_PAYJOIN_RECEIVER_CONTRIBUTION (legacy FABRIC_PAYJOIN_AUTO_ACP).
      receiverContribution: null,
      // Lowest original fee rate (sat/vB) the Hub will contribute to.
      minOriginalFeeRateSatVb: 1,
      // Hub-local BIP77 async mailbox (experimental).
      bip77MailboxExperimental: true,
      // Optional 64-hex x-only federation pubkey for the Taproot reserve leaf (required on mainnet).
      beaconFederationXOnlyHex: ''
    }, settings);
    if (this.settings.receiverContribution == null && (settings.autoAcpBoost === true || settings.autoAcpBoost === false)) {
      this.settings.receiverContribution = settings.autoAcpBoost;
    }

    this._placeholderFederationXOnlyHex = null;

    this.fs = null;
    this.bitcoin = null;
    this.key = null;
    this.mailbox = null;

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
    if (this.settings.bip77MailboxExperimental !== false) {
      this.mailbox = new PayjoinAsyncMailbox({
        fs: this.fs,
        defaultTtlMs: Number(this.settings.defaultSessionTTLSeconds || 1800) * 1000
      });
      if (this.fs) this.mailbox.attach({ fs: this.fs });
    }
    return this;
  }

  async start () {
    await this._loadFromFilesystem();
    this._ensureStateShape();
    this._refreshStateMerkle();
    await this._ensurePlaceholderFederationKey();
    if (this.mailbox && typeof this.mailbox.start === 'function') {
      await this.mailbox.start();
    }
    return this;
  }

  async stop () {
    await this._persistIndex();
    return this;
  }

  getCapabilities () {
    const now = Date.now();
    const sessions = this.listSessions({ includeExpired: false, limit: 10 });
    const federationConfigured = !!(
      String(this.settings.beaconFederationXOnlyHex || '').trim() ||
      String(process.env.FABRIC_PAYJOIN_BEACON_FEDERATION_XONLY_HEX || '').trim()
    );
    const contributing = this._receiverContributionEnabled();
    const taprootReceiveTemplate = {
      label: payjoinJoinmarketTaproot.TEMPLATE_LABEL,
      template: payjoinJoinmarketTaproot.HUB_TAPROOT_TEMPLATE_ID,
      contractVersion: payjoinJoinmarketTaproot.HUB_TAPROOT_CONTRACT_VERSION,
      templates: payjoinJoinmarketTaproot.TEMPLATE_IDS.slice(),
      description:
        'Hub-custody P2TR: Hub operator key path + one Beacon federation reserve leaf. ' +
        `${payjoinJoinmarketTaproot.TEMPLATE_ID} (script path only) is still accepted. BIP21 pj= unchanged.`,
      requiresHubIdentityKey: true,
      beaconFederationXOnlyConfigured: federationConfigured,
      placeholderFederationKey: !federationConfigured && !!this._placeholderFederationXOnlyHex
    };
    const fabricProtocol = buildFabricPayjoinProtocolProfile({
      endpointBasePath: this.settings.endpointBasePath,
      taprootReceiveTemplate: true,
      beaconFederationLeafConfigured: federationConfigured,
      receiverContribution: contributing,
      publicOrigin: this._publicOrigin(),
      bip77MailboxExperimental: !!this.settings.bip77MailboxExperimental,
      coinjoin: typeof this.settings.coinjoinProfile === 'function' ? this.settings.coinjoinProfile() : null
    });
    return {
      available: this.settings.enable !== false,
      service: 'payjoin',
      bip: 'BIP78',
      asyncPayjoinRoadmap: 'BIP77',
      network: this.settings.network,
      endpointBasePath: this.settings.endpointBasePath,
      publicOrigin: this._publicOrigin() || undefined,
      fabricProtocol,
      taprootReceiveTemplate,
      receiverContribution: {
        description:
          'BIP78: the Hub adds one wallet coin (closest to the payment, sender script type) at a random input position and raises the payment output by its value less the extra input fee; ' +
          'the sender re-signs with SIGHASH_ALL. Originals paying no fee are refused. Admin POST .../sessions/:id/contribute builds one for a stored proposal.',
        pathTemplate: `${this.settings.endpointBasePath}/sessions/:sessionId/contribute`,
        onBip78Proposal: contributing,
        minOriginalFeeRateSatVb: Number(this.settings.minOriginalFeeRateSatVb || 1)
      },
      defaults: {
        sessionTTLSeconds: Number(this.settings.defaultSessionTTLSeconds || 1800),
        receiverContribution: contributing
      },
      counts: Object.assign({}, this._payjoinState.counts),
      merkle: Object.assign({}, this._payjoinState.merkle),
      clock: now,
      recentSessions: sessions.map((session) => this._publicSessionView(session, { includeProposals: false }))
    };
  }

  _publicOrigin () {
    return resolvePayjoinPublicOrigin({
      publicOrigin: this.settings.publicOrigin,
      hostname: this.settings.hostname,
      port: this.settings.httpPort,
      env: process.env
    });
  }

  _receiverContributionEnabled () {
    if (this.settings.receiverContribution === true || this.settings.receiverContribution === false) {
      return !!this.settings.receiverContribution;
    }
    const env = String(process.env.FABRIC_PAYJOIN_RECEIVER_CONTRIBUTION || process.env.FABRIC_PAYJOIN_AUTO_ACP || '').trim().toLowerCase();
    if (env === '1' || env === 'true') return true;
    if (env === '0' || env === 'false') return false;
    const net = String(this.settings.network || '').toLowerCase();
    return net === 'regtest' || net === 'test';
  }

  /**
   * Off mainnet, a Hub with no federation key uses a random placeholder
   * x-only key generated once and saved under `payjoin/` (private key
   * discarded). Mainnet never gets one.
   * @returns {Promise<(string|null)>}
   */
  async _ensurePlaceholderFederationKey () {
    if (this._placeholderFederationXOnlyHex) return this._placeholderFederationXOnlyHex;
    const net = String(this.settings.network || '').toLowerCase();
    if (!['regtest', 'test', 'signet', 'testnet'].includes(net)) return null;
    const path = 'payjoin/federation-placeholder.json';
    if (this.fs && typeof this.fs.readFile === 'function') {
      try {
        const raw = this.fs.readFile(path);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && saved.network === net && /^[0-9a-f]{64}$/.test(String(saved.xOnlyHex || ''))) {
          this._placeholderFederationXOnlyHex = saved.xOnlyHex;
          return saved.xOnlyHex;
        }
      } catch (_) {}
    }
    const xOnlyHex = payjoinJoinmarketTaproot.generatePlaceholderFederationXOnly();
    this._placeholderFederationXOnlyHex = xOnlyHex;
    if (this.fs && typeof this.fs.publish === 'function') {
      await this.fs.publish(path, {
        network: net,
        xOnlyHex,
        created: new Date().toISOString(),
        note: 'Placeholder Beacon federation key for test networks; no private key exists.'
      });
    }
    return xOnlyHex;
  }

  /**
   * Relative proposals path + absolute URL for BIP21 pj=.
   * @param {string} sessionId
   * @returns {{ proposalPath: string, proposalURL: string }}
   */
  _proposalUrlsForSession (sessionId) {
    const base = String(this.settings.endpointBasePath || '/services/payjoin').replace(/\/+$/, '') || '/services/payjoin';
    const proposalPath = `${base}/sessions/${sessionId}/proposals`;
    const origin = this._publicOrigin();
    const proposalURL = origin ? joinOriginPath(origin, proposalPath) : proposalPath;
    return { proposalPath, proposalURL };
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
    let receiveTemplate = String(input.receiveTemplate || '').trim().toLowerCase();
    if (receiveTemplate === 'taproot' || receiveTemplate === 'hub_taproot') receiveTemplate = payjoinJoinmarketTaproot.HUB_TAPROOT_TEMPLATE_ID;
    let address = String(input.address || '').trim();
    let receiveContract = null;

    if (receiveTemplate) {
      if (!payjoinJoinmarketTaproot.TEMPLATE_IDS.includes(receiveTemplate)) {
        throw new Error(`Unknown receiveTemplate "${receiveTemplate}"; use ${payjoinJoinmarketTaproot.TEMPLATE_IDS.join(' or ')}.`);
      }
      if (!this.key || typeof this.key.pubkey !== 'string' || !this.key.pubkey) {
        throw new Error('Hub identity key is required for a Hub Taproot payjoin receive address.');
      }
      const opBuf = Buffer.from(String(this.key.pubkey).trim(), 'hex');
      if (opBuf.length !== 33) {
        throw new Error('Hub identity pubkey must be a 33-byte compressed key.');
      }
      const federationX = payjoinJoinmarketTaproot.resolveBeaconFederationXOnly({
        explicitHex: input.federationXOnlyHex,
        configHex: this.settings.beaconFederationXOnlyHex,
        placeholderHex: await this._ensurePlaceholderFederationKey(),
        networkName: this.settings.network
      });
      const built = payjoinJoinmarketTaproot.buildPayjoinTaprootTemplate(receiveTemplate, {
        networkName: this.settings.network,
        operatorPubkeyCompressed: opBuf,
        federationXOnly: federationX
      });
      address = built.address;
      receiveContract = {
        template: built.template,
        label: built.label,
        contractVersion: built.contractVersion,
        network: built.network,
        operatorPubkeyCompressedHex: built.operatorPubkeyCompressedHex,
        federationXOnlyHex: built.federationXOnlyHex,
        placeholderFederationKey: built.federationXOnlyHex === this._placeholderFederationXOnlyHex,
        internalPubkeyHex: built.internalPubkeyHex,
        keyPath: built.keyPath,
        leafOrder: built.leafOrder,
        leaves: built.leaves
      };
    }

    const walletId = String(input.walletId || '').trim() || 'default';
    const amountSats = Number(input.amountSats || 0);
    const label = String(input.label || input.memo || '').trim();
    const memo = String(input.memo || '').trim();
    const ttlSeconds = Math.max(30, Math.min(86400, Number(input.expiresInSeconds || this.settings.defaultSessionTTLSeconds || 1800)));

    if (!address) throw new Error(`Address is required for a Payjoin deposit session (or use receiveTemplate ${payjoinJoinmarketTaproot.HUB_TAPROOT_TEMPLATE_ID}).`);

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
    const { proposalPath, proposalURL } = this._proposalUrlsForSession(sessionId);
    const bip21Uri = this._buildBIP21Uri(address, payload.amountSats, label, proposalURL);
    const requested = input.receiverContribution != null ? input.receiverContribution : input.autoAcpBoost;
    const receiverContribution = requested != null
      ? !!requested
      : this._receiverContributionEnabled();

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
      proposalPath,
      proposalURL,
      receiverContribution,
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
      analysis,
      bip78Params: proposalInput.bip78Params || undefined,
      payjoinPsbt: null,
      receiverContribution: null
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

    const requested = proposalInput.receiverContribution != null ? proposalInput.receiverContribution : proposalInput.autoAcpBoost;
    const sessionWants = session.receiverContribution != null ? session.receiverContribution : session.autoAcpBoost;
    const wantContribution = requested != null
      ? !!requested
      : (sessionWants !== false && this._receiverContributionEnabled());

    if (wantContribution && psbt) {
      await this._applyContribution(session, proposal, proposalInput.bip78Params);
    }

    this._payjoinState.counts.proposals = this._countAllProposals();
    this._refreshSessionMerkle(session);
    this._refreshStateMerkle();
    await this._persistSession(session);
    await this._persistIndex();

    const contribution = proposal.receiverContribution;
    return {
      status: 'success',
      sessionId: id,
      proposal: Object.assign({}, proposal),
      // JSON path: the payjoin proposal when the Hub contributed, else the original.
      bip78Psbt: proposal.payjoinPsbt || proposal.psbt || '',
      // BIP78 wire: when set, answer with this error instead of a PSBT (the sender broadcasts its original).
      bip78Error: proposal.payjoinPsbt
        ? null
        : {
            errorCode: (contribution && contribution.errorCode) || 'unavailable',
            message: (contribution && contribution.error) || 'This Hub does not contribute to payjoin proposals.'
          },
      session: this._publicSessionView(session, { includeProposals: true })
    };
  }

  /**
   * Run the BIP78 receiver contribution for a stored proposal and record the outcome.
   * @param {Object} session
   * @param {Object} proposal
   * @param {Object} [bip78Params] {@link payjoinReceiverContribution.parseBip78Params}
   * @returns {Promise<Object>} `proposal.receiverContribution`
   */
  async _applyContribution (session, proposal, bip78Params) {
    try {
      if (!this.bitcoin || typeof this.bitcoin._makeRPCRequest !== 'function') {
        const err = new Error('Bitcoin service unavailable for receiver contribution.');
        err.code = 'unavailable';
        throw err;
      }
      const out = await payjoinReceiverContribution.contributeReceiverInput({
        psbtBase64: proposal.psbt,
        bitcoin: this.bitcoin,
        receiverAddress: session.address,
        networkName: this.bitcoin.network || this.settings.network || 'regtest',
        params: bip78Params || payjoinReceiverContribution.parseBip78Params({}),
        minFeeRateSatVb: Number(this.settings.minOriginalFeeRateSatVb || 1)
      });
      proposal.payjoinPsbt = out.psbtBase64;
      proposal.receiverContribution = Object.assign({ ok: true }, out, { psbtBase64: undefined });
      proposal.status = 'payjoin-proposed';
      session.events.push(this._createEvent('PAYJOIN_RECEIVER_CONTRIBUTION', {
        sessionId: session.id,
        proposalId: proposal.id,
        contributedOutpoint: out.contributedOutpoint,
        contributedValueSats: out.contributedValueSats,
        receiverOutputAfterSats: out.receiverOutputAfterSats,
        additionalFeeSats: out.additionalFeeSats
      }));
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      let errorCode = 'unavailable';
      if (err && err.code === 'original-psbt-rejected') errorCode = 'original-psbt-rejected';
      else if (/no confirmed coin|does not cover/i.test(message)) errorCode = 'not-enough-money';
      proposal.receiverContribution = { ok: false, errorCode, error: message };
      if (errorCode === 'original-psbt-rejected') proposal.status = 'rejected';
      session.events.push(this._createEvent('PAYJOIN_RECEIVER_CONTRIBUTION_FAILED', {
        sessionId: session.id,
        proposalId: proposal.id,
        errorCode,
        error: message
      }));
    }
    return proposal.receiverContribution;
  }

  /**
   * Operator retry: contribute to a stored proposal (or a supplied original).
   * @param {string} sessionId
   * @param {Object} [opts]
   * @param {string} [opts.psbt] original PSBT (default: the session's latest proposal)
   * @param {Object} [opts.bip78Params]
   * @returns {Promise<{ proposalId: string, psbtBase64: string, receiverContribution: Object }>}
   */
  async contributeToProposal (sessionId, opts = {}) {
    const id = String(sessionId || '').trim();
    const session = this._payjoinState.sessions[id];
    if (!session) throw new Error('Payjoin session not found.');
    let proposal;
    const psbt = String(opts.psbt || '').trim();
    if (psbt) {
      proposal = Object.values(session.proposals || {}).find((p) => p && p.psbt === psbt);
      if (!proposal) {
        const submitted = await this.submitProposal(id, { psbt, receiverContribution: false, bip78Params: opts.bip78Params });
        proposal = session.proposals[submitted.proposal.id];
      }
    } else {
      proposal = Object.values(session.proposals || {})
        .filter((p) => p && p.psbt)
        .sort((a, b) => new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime())
        .pop();
    }
    if (!proposal) throw new Error('No PSBT on session; submit a proposal first or pass psbt.');
    const result = await this._applyContribution(session, proposal, opts.bip78Params || proposal.bip78Params);
    this._refreshSessionMerkle(session);
    this._refreshStateMerkle();
    await this._persistSession(session);
    await this._persistIndex();
    if (!result.ok) throw new Error(result.error);
    return { proposalId: proposal.id, psbtBase64: proposal.payjoinPsbt, receiverContribution: result };
  }

  _buildBIP21Uri (address, amountSats, label, proposalURL) {
    const extras = {};
    if (proposalURL) extras.pj = proposalURL;
    const opts = {
      address: String(address || '').trim(),
      extras
    };
    if (Number.isFinite(amountSats) && amountSats > 0) {
      opts.amount = amountSats / SATS_PER_BTC;
    }
    if (label) opts.label = label;
    return encodeBitcoinUri(opts);
  }

  _createEvent (type, payload = {}) {
    const created = new Date().toISOString();
    const actor = new Actor({ content: { type, payload, created } });
    return { id: actor.id, type, created, payload };
  }

  /**
   * Best-effort txid for wallet labeling (final tx, unsigned PSBT id, or decodepsbt hints).
   * @param {{ psbt: (string|undefined), txhex: (string|undefined), analysis: (object|undefined), proposalTxid: (string|undefined)}} proposal
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
      proposalPath: session.proposalPath || undefined,
      proposalURL: session.proposalURL,
      receiverContribution: session.receiverContribution != null ? session.receiverContribution : session.autoAcpBoost,
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
