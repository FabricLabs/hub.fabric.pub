'use strict';

/**
 * @fileoverview The Hub as a delegation participant (`@fabric/core` docs/DELEGATION.md).
 *
 * The Hub keeps its own `Delegation` (its identity key, frames on disk under
 * `stores/hub/delegation/`) and serves three things from `@fabric/http`:
 * - the pairing rendezvous (`/delegations`) for any two participants;
 * - the delegation mailbox (`/services/delegation/mailbox`); frames addressed
 *   to this Hub are taken in directly, and its answers to remote requesters
 *   wait there for them;
 * - the loopback delegate (`/services/delegation`) Passport on this machine
 *   pairs with and sends requests to.
 *
 * Every request a linked signer sends goes through the signer rules
 * (`services/signerRules.js`) first: a rule signs or declines it and the
 * decision is logged; otherwise it waits as a notification for the operator
 * (admin routes, the Notifications page) and, on the desktop, a native dialog.
 * Federation invites and withdrawal requests that reach the Hub over the mesh
 * go through the same rules.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const Delegation = require('@fabric/core/types/delegation');
const delegation = require('@fabric/core/functions/delegation');
const { encodeFabricUri } = require('@fabric/core/functions/fabricUri');
const { createDelegationRendezvous } = require('@fabric/http/functions/fabricDelegationHttp');
const { createDelegationMailbox } = require('@fabric/http/functions/fabricDelegationMailbox');
const { createFabricDelegate } = require('@fabric/http/functions/fabricDelegate');
const SignerRules = require('./signerRules');
const { factsForRequest, requestFacts } = require('../functions/signerRules');

const LINK_PROMPT_MS = 2 * 60 * 1000;
const SAFE_KEY = /^[a-z0-9-]{1,64}$/;

/**
 * Key-value store of JSON files in one directory (atomic writes, 0600).
 * @param {string} dir
 * @returns {{ get: Function, set: Function }}
 */
function fileStore (dir) {
  let writes = 0;
  const file = (key) => {
    if (!SAFE_KEY.test(String(key))) throw new Error(`bad store key ${key}`);
    return path.join(dir, `${key}.json`);
  };
  return {
    async get (key) {
      try {
        return await fs.promises.readFile(file(key), 'utf8');
      } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async set (key, value) {
      await fs.promises.mkdir(dir, { recursive: true });
      const target = file(key);
      const tmp = `${target}.${process.pid}.${++writes}.tmp`;
      await fs.promises.writeFile(tmp, String(value), { mode: 0o600 });
      await fs.promises.rename(tmp, target);
    }
  };
}

/** @private */
function grantView (g, which) {
  const grant = g.grant || {};
  return {
    hash: g.hash,
    direction: which,
    grantor: grant.grantor,
    grantee: grant.grantee,
    label: grant.label || null,
    scopes: grant.scopes || [],
    origins: grant.origins || [],
    networks: grant.networks || [],
    cosigner: grant.cosigner || null,
    extensionOrigin: grant.extensionOrigin || null,
    issuedAt: grant.issuedAt || null,
    revoked: !!g.revoked
  };
}

class HubDelegation extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.key Hub identity key (private).
   * @param {Object} [settings.cosignerKey] Hub cosigner key, disclosed in its federation grants.
   * @param {string} settings.network
   * @param {string} [settings.dir] Store directory (`stores/hub`); in memory when omitted.
   * @param {string} [settings.name] Label this Hub gives itself.
   * @param {Function} settings.getAccount `({ network, account }) => deriveAccount result|null`
   * @param {Object} [settings.federations] `services/federations.js`
   * @param {Function} [settings.approve] `(prompt) => Promise<boolean>` native dialog (desktop only).
   * @param {string[]} [settings.origins] Origins the rendezvous serves.
   * @param {string[]} [settings.extensionIds] Chrome Passport ids.
   * @param {string[]} [settings.extensionOrigins]
   * @param {Function} [settings.now]
   */
  constructor (settings = {}) {
    super();
    if (!settings.key || !settings.key.private) throw new TypeError('HubDelegation: the Hub identity key is required');
    this.settings = Object.assign({ name: 'Fabric Hub', origins: [], extensionIds: [], extensionOrigins: [] }, settings);
    this._now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    this.federations = settings.federations || null;
    const dir = settings.dir || null;
    this.store = new Delegation({
      key: settings.key,
      store: dir ? fileStore(path.join(dir, 'delegation')) : undefined,
      now: this._now,
      networkOf: (read) => this._networkOf(read && read.inner && read.inner.body && read.inner.body.federationId)
    });
    this.rules = new SignerRules({ dir, now: this._now }).load();
    this.rules.on('warning', (msg) => this.emit('warning', msg));
    this.mailbox = createDelegationMailbox({
      store: dir ? fileStore(path.join(dir, 'delegation')) : undefined,
      now: this._now,
      deliver: (to, buffer) => this._deliver(to, buffer)
    });
    this.rendezvous = createDelegationRendezvous({ origins: this.settings.origins, now: this._now });
    this.delegate = createFabricDelegate({
      delegation: this.store,
      signer: 'hub',
      network: settings.network,
      name: this.settings.name,
      getAccount: settings.getAccount,
      decide: (item) => this._decide(item),
      answer: (item) => this._answerFederation(item),
      confirmLink: settings.approve
        ? (p) => settings.approve({ kind: 'link', code: p.sas, label: p.peerLabel, from: p.peer, expiresAt: this._now() + LINK_PROMPT_MS })
        : null,
      grantsForLink: () => [Object.assign(
        { scopes: ['identity', 'passport', 'federation'], label: this.settings.name },
        settings.cosignerKey && settings.cosignerKey.private ? { cosignerKey: settings.cosignerKey } : {}
      )],
      extensionIds: this.settings.extensionIds,
      extensionOrigins: this.settings.extensionOrigins,
      now: this._now
    });
    this._onWithdrawal = (ev) => this._federationEvent('withdrawal', ev).catch((err) => this.emit('warning', `[DELEGATION] withdrawal rule failed: ${err.message}`));
    this._onInvite = (ev) => this._federationEvent('invite', ev).catch((err) => this.emit('warning', `[DELEGATION] invite rule failed: ${err.message}`));
    if (this.federations && typeof this.federations.on === 'function') {
      this.federations.on('withdrawal', this._onWithdrawal);
      this.federations.on('invite', this._onInvite);
    }
  }

  /** Compressed pubkey of the Hub's delegation identity. */
  get pubkey () {
    return this.store.pubkey;
  }

  stop () {
    if (this.federations && typeof this.federations.removeListener === 'function') {
      this.federations.removeListener('withdrawal', this._onWithdrawal);
      this.federations.removeListener('invite', this._onInvite);
    }
  }

  /** @private */
  _networkOf (federationId) {
    if (!federationId || !this.federations || typeof this.federations.networkOf !== 'function') return null;
    return this.federations.networkOf(federationId);
  }

  /** @private */
  _maxWithdrawalSats () {
    const cap = this.federations && this.federations.settings && this.federations.settings.maxWithdrawalSats;
    return cap != null ? Number(cap) : null;
  }

  /** @private */
  async _context () {
    return { identityPeers: await this.store.identityPeers(), maxWithdrawalSats: this._maxWithdrawalSats() };
  }

  /**
   * A request a linked signer sent: a rule answers it, or it waits for the operator.
   * @private
   */
  async _decide (item) {
    const facts = factsForRequest(item.read, { networkOf: (id) => this._networkOf(id) });
    const decision = this.rules.decide(facts, await this._context());
    if (decision.action !== 'notify') {
      const entry = this.rules.record(decision, facts, { request: item.hash, title: item.notification && item.notification.title });
      this.emit('decided', entry);
      return decision;
    }
    this.emit('notification', Object.assign({ hash: item.hash }, item.notification));
    this._prompt(item);
    return decision;
  }

  /**
   * Desktop: ask with the native dialog, in the background; the answer settles the request.
   * @private
   */
  _prompt (item) {
    if (typeof this.settings.approve !== 'function') return;
    const read = item.read;
    const n = item.notification || {};
    const prompt = read.scope === 'passport'
      ? {
          kind: 'sign',
          origin: read.request.origin,
          purpose: read.inner.challenge.purpose || '',
          label: n.from && n.from.label,
          from: read.request.requester,
          network: read.inner.network,
          account: read.request.account,
          shares: ['identity'].concat(read.request.disclose || []),
          expiresAt: read.request.expiresAt
        }
      : { kind: 'request', title: n.title, summary: n.summary, label: n.from && n.from.label, from: read.request.requester, expiresAt: read.request.expiresAt };
    Promise.resolve(this.settings.approve(prompt))
      .then((approved) => this.answer(item.hash, approved === true ? 'sign' : 'decline', { reason: 'declined on this Hub' }))
      .catch((err) => this.emit('warning', `[DELEGATION] approval failed: ${err.message}`));
  }

  /**
   * Answer a pending request (operator or dialog). Remote requesters find
   * the result in this Hub's mailbox.
   * @param {string} hash
   * @param {string} action `sign` | `decline`
   * @param {Object} [options] `{ reason }`
   * @returns {Promise<{ status: number, json: object }>}
   */
  async answer (hash, action, options = {}) {
    const out = await this.delegate.resolve(hash, { action, reason: options.reason });
    if (out && out.json && out.json.alreadySettled !== true && (out.json.status === 'signed' || out.json.status === 'declined')) {
      const item = await this.store.inboxItem(hash);
      if (item && item.read && item.read.ok) {
        const facts = factsForRequest(item.read, { networkOf: (id) => this._networkOf(id) });
        const notification = delegation.notificationFor ? delegation.notificationFor(item.read) : null;
        this.rules.record({ action: out.json.status === 'signed' ? 'sign' : 'decline', rule: null, reason: 'operator' }, facts, {
          request: hash,
          title: notification && notification.title
        });
      }
    }
    await this._forward(hash, out);
    return out;
  }

  /** @private */
  async _forward (hash, out) {
    if (!out || !out.json || !out.json.result) return;
    const item = await this.store.inboxItem(hash);
    if (!item || !item.read || !item.read.ok) return;
    try {
      await this.mailbox.post(out.json.result, { to: item.read.request.requester });
    } catch (err) {
      this.emit('warning', `[DELEGATION] result not queued: ${err.message}`);
    }
  }

  /**
   * Frames posted to the mailbox for this Hub: take them in.
   * @private
   */
  _deliver (to, buffer) {
    if (delegation.xOnly(to) !== this.pubkey.slice(2)) return false;
    this.delegate.takeRemote(buffer)
      .then((out) => {
        const hash = out && out.json && out.json.request;
        return hash ? this._forward(hash, out) : null;
      })
      .catch((err) => this.emit('warning', `[DELEGATION] mailbox frame refused: ${err.message}`));
    return true;
  }

  /**
   * Sign a federation request as this Hub's cosigner: accept the invite or
   * approve the withdrawal, returning the frame the Hub sent.
   * @private
   */
  async _answerFederation (item) {
    if (item.read.scope !== 'federation') return null;
    if (!this.federations || typeof this.federations.answerDelegated !== 'function') throw new Error('shared wallets are off on this Hub');
    const message = await this.federations.answerDelegated(item.read.inner.body, item.read.inner.author);
    if (!message) throw new Error('the Hub could not send its answer');
    return encodeFabricUri(message.toBuffer());
  }

  /**
   * The identity behind a federation key: the grantor whose grant to this
   * Hub disclosed it as cosigner, else the key itself.
   * @private
   */
  async _identityOf (key) {
    const x = delegation.xOnly(key);
    if (!x) return null;
    const received = await this.store.grants('received');
    const found = received.find((g) => !g.revoked && g.grant.cosigner && g.grant.cosigner.slice(2) === x);
    return found ? found.grant.grantor : x;
  }

  /**
   * Federation frames from the mesh (not delegated): rules may accept an
   * invite or co-sign a withdrawal; otherwise they wait in the federation panel.
   * @private
   */
  async _federationEvent (kind, ev) {
    if (!ev || ev.delegated || !this.federations) return null;
    const facts = kind === 'withdrawal'
      ? requestFacts({
          scope: 'federation',
          kind,
          from: await this._identityOf(ev.requester),
          federationId: ev.federationId,
          network: ev.network,
          amountSats: ev.amountSats,
          destination: ev.destinationAddress
        })
      : requestFacts({ scope: 'federation', kind, from: await this._identityOf(ev.inviter), federationId: ev.id, network: ev.network });
    const decision = this.rules.decide(facts, await this._context());
    if (decision.action === 'notify') return decision;
    if (kind === 'withdrawal' && decision.action === 'sign') {
      await this.federations.approveWithdrawal(ev.federationId, ev.requestId);
    } else if (kind === 'invite') {
      await this.federations.respond(ev.id, decision.action === 'sign');
    }
    const title = kind === 'withdrawal' ? `Co-sign a withdrawal of ${facts.amountSats} sats` : `Join the shared wallet "${ev.name || ev.id.slice(0, 12)}"`;
    this.emit('decided', this.rules.record(decision, facts, { title }));
    return decision;
  }

  /**
   * Requests waiting for the operator, oldest first.
   * @returns {Promise<Array<Object>>}
   */
  async pending () {
    const list = await this.store.pending();
    return list.map((p) => Object.assign({ hash: p.hash, receivedAt: p.receivedAt }, p.notification));
  }

  /**
   * Pairings and grants both ways, plus the identity-linked participants.
   * @returns {Promise<Object>}
   */
  async signers () {
    const [links, given, received, identityPeers] = await Promise.all([
      this.store.links(),
      this.store.grants('given', { revoked: true }),
      this.store.grants('received', { revoked: true }),
      this.store.identityPeers()
    ]);
    return {
      pubkey: this.pubkey,
      links: links.map((l) => ({ linkId: l.linkId, role: l.role, status: l.status, peer: l.peer, peerLabel: l.peerLabel || null, createdAt: l.createdAt })),
      given: given.map((g) => grantView(g, 'given')),
      received: received.map((g) => grantView(g, 'received')),
      identityPeers
    };
  }

  /**
   * Revoke a grant this Hub gave; the grantee finds the revocation in the mailbox.
   * @param {string} hash
   * @returns {Promise<Object>}
   */
  async revoke (hash) {
    const given = await this.store.grants('given');
    const found = given.find((g) => g.hash === String(hash || '').toLowerCase());
    if (!found) throw Object.assign(new Error('unknown grant'), { status: 404 });
    const made = await this.store.revoke(found.hash);
    try {
      await this.mailbox.post(made.uri, { to: found.grant.grantee });
    } catch (err) {
      this.emit('warning', `[DELEGATION] revocation not queued: ${err.message}`);
    }
    return { ok: true, revoked: found.hash, frame: made.uri };
  }
}

HubDelegation.fileStore = fileStore;

module.exports = HubDelegation;
