'use strict';

/**
 * Hub-local BIP77-shaped async Payjoin mailbox (experimental).
 *
 * Mirrors CONTRACT_MESSAGE queue semantics:
 * - opaque blobs only (Hub does not parse PSBT internals here)
 * - enqueue → pending → markDelivered (delivery sidecar ≠ Payjoin settled)
 * - idempotent by content hash
 * - TTL + first-wins claim for multi-operator drain races
 *
 * Not a public Payjoin Directory / HPKE / OHTTP implementation.
 */

const crypto = require('crypto');
const Actor = require('@fabric/core/types/actor');

const FS_ROOT = 'payjoin/mailboxes';
const INDEX_PATH = `${FS_ROOT}/INDEX.json`;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BLOB_BYTES = 256 * 1024;
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_CLAIM_TTL_MS = 30 * 1000;
const ROLES = Object.freeze(['receiver_ready', 'payer_reply', 'receiver_reply']);

function sha256Hex (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeBlob (input) {
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) throw new Error('Mailbox blob is empty.');
    // Prefer hex when unambiguous; otherwise treat as standard base64 (BIP78 PSBT).
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 8) {
      return Buffer.from(s, 'hex');
    }
    const compact = s.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(compact)) {
      throw new Error('Mailbox blob must be hex or base64.');
    }
    const buf = Buffer.from(compact, 'base64');
    if (!buf.length) throw new Error('Mailbox blob base64 decoded empty.');
    // Reject strings Node accepts as base64 but that are not round-trippable opaque payloads.
    const reenc = buf.toString('base64').replace(/=+$/, '');
    const orig = compact.replace(/=+$/, '');
    if (reenc !== orig) {
      throw new Error('Mailbox blob is not valid base64.');
    }
    return buf;
  }
  throw new Error('Mailbox blob must be a Buffer or string.');
}

function normalizeRole (role) {
  const r = String(role || 'payer_reply').trim();
  if (!ROLES.includes(r)) {
    throw new Error(`Invalid mailbox role (expected one of ${ROLES.join(', ')}).`);
  }
  return r;
}

/**
 * In-memory + optional Hub Filesystem persistence for Payjoin mailboxes.
 */
class PayjoinAsyncMailbox {
  /**
   * @param {object} [opts]
   * @param {object} [opts.fs] Hub Filesystem (readFile / publish)
   * @param {number} [opts.defaultTtlMs]
   * @param {number} [opts.maxBlobBytes]
   * @param {number} [opts.maxEntries]
   * @param {number} [opts.claimTtlMs]
   */
  constructor (opts = {}) {
    this.fs = opts.fs || null;
    this.defaultTtlMs = Math.max(5000, Number(opts.defaultTtlMs || DEFAULT_TTL_MS));
    this.maxBlobBytes = Math.max(1024, Number(opts.maxBlobBytes || DEFAULT_MAX_BLOB_BYTES));
    this.maxEntries = Math.max(1, Math.min(512, Number(opts.maxEntries || DEFAULT_MAX_ENTRIES)));
    this.claimTtlMs = Math.max(1000, Number(opts.claimTtlMs || DEFAULT_CLAIM_TTL_MS));
    /** @type {Record<string, object>} */
    this._mailboxes = {};
  }

  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    return this;
  }

  async start () {
    await this._loadIndex();
    return this;
  }

  createMailbox (input = {}) {
    const now = Date.now();
    const ttlMs = Math.max(5000, Number(input.ttlMs || this.defaultTtlMs));
    const sessionId = input.sessionId != null ? String(input.sessionId).trim() : '';
    const payload = {
      created: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      sessionId: sessionId || undefined
    };
    const actor = new Actor({ content: payload });
    const id = actor.id;
    const doc = {
      id,
      created: payload.created,
      expiresAt: payload.expiresAt,
      sessionId: payload.sessionId,
      maxEntries: this.maxEntries,
      entries: [],
      updatedAt: payload.created
    };
    this._mailboxes[id] = doc;
    this._persistMailbox(doc);
    this._persistIndex();
    return this._publicMailbox(doc);
  }

  getMailbox (mailboxId) {
    const doc = this._requireMailbox(mailboxId);
    if (this._isExpired(doc)) {
      const err = new Error('Payjoin mailbox has expired.');
      err.code = 'MAILBOX_EXPIRED';
      throw err;
    }
    return this._publicMailbox(doc);
  }

  /**
   * @param {string} mailboxId
   * @param {Buffer|string} blob
   * @param {{ role?: string }} [meta]
   */
  enqueue (mailboxId, blob, meta = {}) {
    const doc = this._requireMailbox(mailboxId);
    if (this._isExpired(doc)) {
      const err = new Error('Payjoin mailbox has expired.');
      err.code = 'MAILBOX_EXPIRED';
      throw err;
    }
    const role = normalizeRole(meta.role);
    const buf = normalizeBlob(blob);
    if (buf.length > this.maxBlobBytes) {
      throw new Error(`Mailbox blob exceeds max size (${this.maxBlobBytes} bytes).`);
    }
    const contentHash = sha256Hex(buf);
    const dup = doc.entries.find((e) => e && e.contentHash === contentHash);
    if (dup) {
      return { accepted: true, duplicate: true, entry: this._publicEntry(dup) };
    }
    const created = new Date().toISOString();
    const entryActor = new Actor({ content: { mailboxId: doc.id, contentHash, role, created } });
    const entry = {
      id: entryActor.id,
      role,
      contentHash,
      blobBase64: buf.toString('base64'),
      created,
      deliveredTo: {},
      claim: null
    };
    doc.entries.push(entry);
    while (doc.entries.length > doc.maxEntries) {
      let dropIdx = doc.entries.findIndex((e) => e && e.deliveredTo && Object.keys(e.deliveredTo).length);
      if (dropIdx < 0) dropIdx = 0;
      doc.entries.splice(dropIdx, 1);
    }
    doc.updatedAt = created;
    this._persistMailbox(doc);
    this._persistIndex();
    return { accepted: true, duplicate: false, entry: this._publicEntry(entry) };
  }

  /**
   * Pending entries for poll (opaque payload included).
   * @param {string} mailboxId
   * @param {{ after?: string, role?: string, includeDelivered?: boolean }} [opts]
   */
  pendingFor (mailboxId, opts = {}) {
    const doc = this._requireMailbox(mailboxId);
    if (this._isExpired(doc)) {
      const err = new Error('Payjoin mailbox has expired.');
      err.code = 'MAILBOX_EXPIRED';
      throw err;
    }
    const after = opts.after != null ? String(opts.after).trim() : '';
    const roleFilter = opts.role ? normalizeRole(opts.role) : null;
    let started = !after;
    const out = [];
    for (const entry of doc.entries) {
      if (!started) {
        if (entry.contentHash === after || entry.id === after) started = true;
        continue;
      }
      if (roleFilter && entry.role !== roleFilter) continue;
      if (!opts.includeDelivered) {
        const delivered = entry.deliveredTo && Object.keys(entry.deliveredTo).length > 0;
        if (delivered) continue;
      }
      out.push(this._publicEntry(entry, { includeBlob: true }));
    }
    return {
      mailbox: this._publicMailbox(doc),
      entries: out
    };
  }

  /**
   * First-wins claim for receiver drain.
   * @param {string} mailboxId
   * @param {string} contentHash
   * @param {string} claimant
   */
  claim (mailboxId, contentHash, claimant) {
    const doc = this._requireMailbox(mailboxId);
    if (this._isExpired(doc)) {
      const err = new Error('Payjoin mailbox has expired.');
      err.code = 'MAILBOX_EXPIRED';
      throw err;
    }
    const hash = String(contentHash || '').trim().toLowerCase();
    const who = String(claimant || '').trim();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('contentHash must be 64-char hex.');
    if (!who) throw new Error('claimant is required.');
    const entry = doc.entries.find((e) => e && e.contentHash === hash);
    if (!entry) throw new Error('Mailbox entry not found.');
    const now = Date.now();
    if (entry.claim && entry.claim.claimant && entry.claim.claimedAt) {
      const start = Date.parse(entry.claim.claimedAt) || 0;
      const ttl = Math.max(1000, Number(entry.claim.ttlMs) || this.claimTtlMs);
      if (start && (now - start) < ttl) {
        if (entry.claim.claimant === who) {
          return { ok: true, duplicate: true, claim: entry.claim, entry: this._publicEntry(entry) };
        }
        const err = new Error('Mailbox entry already claimed.');
        err.code = 'CLAIM_HELD';
        err.claim = entry.claim;
        throw err;
      }
    }
    entry.claim = {
      claimant: who,
      claimedAt: new Date(now).toISOString(),
      ttlMs: this.claimTtlMs
    };
    doc.updatedAt = entry.claim.claimedAt;
    this._persistMailbox(doc);
    return { ok: true, duplicate: false, claim: entry.claim, entry: this._publicEntry(entry) };
  }

  /**
   * Delivery sidecar only — does not mean Payjoin finalized.
   * @param {string} mailboxId
   * @param {string} contentHash
   * @param {string} peerKey
   */
  markDelivered (mailboxId, contentHash, peerKey) {
    const doc = this._requireMailbox(mailboxId);
    const hash = String(contentHash || '').trim().toLowerCase();
    const peer = String(peerKey || 'http-poller').trim() || 'http-poller';
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('contentHash must be 64-char hex.');
    const entry = doc.entries.find((e) => e && e.contentHash === hash);
    if (!entry) throw new Error('Mailbox entry not found.');
    if (!entry.deliveredTo || typeof entry.deliveredTo !== 'object') entry.deliveredTo = {};
    const at = new Date().toISOString();
    entry.deliveredTo[peer] = at;
    doc.updatedAt = at;
    this._persistMailbox(doc);
    return {
      ok: true,
      contentHash: hash,
      peerKey: peer,
      deliveredAt: at,
      note: 'Delivery sidecar only — not Payjoin settlement or MessageReceipt.'
    };
  }

  listMailboxes (opts = {}) {
    const includeExpired = !!opts.includeExpired;
    const limit = Math.max(1, Math.min(200, Number(opts.limit || 25)));
    const now = Date.now();
    return Object.values(this._mailboxes)
      .filter((doc) => {
        if (!doc) return false;
        if (includeExpired) return true;
        return !this._isExpired(doc, now);
      })
      .sort((a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime())
      .slice(0, limit)
      .map((doc) => this._publicMailbox(doc));
  }

  _requireMailbox (mailboxId) {
    const id = String(mailboxId || '').trim();
    if (!id) throw new Error('mailboxId is required.');
    const doc = this._mailboxes[id];
    if (!doc) {
      const err = new Error('Payjoin mailbox not found.');
      err.code = 'MAILBOX_NOT_FOUND';
      throw err;
    }
    return doc;
  }

  _isExpired (doc, now = Date.now()) {
    if (!doc || !doc.expiresAt) return false;
    return new Date(doc.expiresAt).getTime() <= now;
  }

  _publicMailbox (doc) {
    return {
      id: doc.id,
      created: doc.created,
      updatedAt: doc.updatedAt,
      expiresAt: doc.expiresAt,
      sessionId: doc.sessionId,
      entryCount: (doc.entries || []).length,
      maxEntries: doc.maxEntries
    };
  }

  _publicEntry (entry, opts = {}) {
    const out = {
      id: entry.id,
      role: entry.role,
      contentHash: entry.contentHash,
      created: entry.created,
      claim: entry.claim || null,
      deliveredTo: entry.deliveredTo || {},
      delivered: !!(entry.deliveredTo && Object.keys(entry.deliveredTo).length)
    };
    if (opts.includeBlob) out.blobBase64 = entry.blobBase64;
    return out;
  }

  _persistMailbox (doc) {
    if (!this.fs || typeof this.fs.publish !== 'function' || !doc || !doc.id) return;
    try {
      this.fs.publish(`${FS_ROOT}/${doc.id}.json`, doc);
    } catch (_) {}
  }

  _persistIndex () {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    const ids = Object.keys(this._mailboxes).sort();
    try {
      this.fs.publish(INDEX_PATH, {
        version: 1,
        mailboxes: ids,
        updatedAt: new Date().toISOString()
      });
    } catch (_) {}
  }

  async _loadIndex () {
    if (!this.fs || typeof this.fs.readFile !== 'function') return;
    try {
      const raw = this.fs.readFile(INDEX_PATH);
      if (!raw) return;
      const parsed = typeof raw === 'string' || Buffer.isBuffer(raw) ? JSON.parse(raw.toString()) : raw;
      const ids = parsed && Array.isArray(parsed.mailboxes) ? parsed.mailboxes : [];
      for (const id of ids) {
        try {
          const docRaw = this.fs.readFile(`${FS_ROOT}/${id}.json`);
          if (!docRaw) continue;
          const doc = typeof docRaw === 'string' || Buffer.isBuffer(docRaw)
            ? JSON.parse(docRaw.toString())
            : docRaw;
          if (doc && doc.id) this._mailboxes[doc.id] = doc;
        } catch (_) {}
      }
    } catch (_) {}
  }
}

module.exports = {
  PayjoinAsyncMailbox,
  FS_ROOT,
  INDEX_PATH,
  ROLES,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_BLOB_BYTES,
  DEFAULT_CLAIM_TTL_MS,
  sha256Hex,
  normalizeBlob,
  normalizeRole
};
