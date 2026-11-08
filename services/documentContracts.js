'use strict';

/**
 * @fileoverview Editable documents as contracts (`@fabric/core`
 * `functions/documentRevisions`, docs/DOCUMENT_REVISIONS.md). Each editable
 * document is a `DocumentContract`; every edit is a signed `DocumentRevision`
 * frame chained to the one it replaces. This service keeps every contract's
 * frames on disk (`<path>/<contractId>.json`), folds them, and indexes each
 * version's document id to its contract and revision, so the history survives
 * restarts. Versions stay ordinary documents: the Hub lists and sells each at
 * its own price, and hands a buyer that version's provenance.
 */

const Service = require('@fabric/core/types/service');
const {
  buildDocumentContractGenesis,
  buildDocumentContractPublishMessage,
  buildDocumentRevisionMessage,
  documentContractId,
  foldDocumentRevisions,
  documentProvenance,
  verifyDocumentProvenance,
  parseDocumentContractFrame,
  normalizeDocumentIdentifier,
  isDocumentContractDefinition
} = require('@fabric/core/functions/documentRevisions');

/** @private */
function parseJson (raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
  } catch (_) {
    return null;
  }
}

/** @private */
function hex64 (value) {
  const s = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

class DocumentContractsService extends Service {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.path='document-contracts'] Filesystem prefix.
   * @param {number} [settings.maxFramesPerContract=10000]
   * @param {number} [settings.maxContracts=10000]
   * @param {number} [settings.maxPendingFrames=500] Revisions held until their contract's publish arrives.
   */
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: 'DocumentContracts',
      path: 'document-contracts',
      maxFramesPerContract: 10000,
      maxContracts: 10000,
      maxPendingFrames: 500
    }, settings);
    this.fs = null;
    this.key = null;
    this._relay = null;
    this._records = new Map();
    this._documents = new Map();
    this._pending = new Map();
    this._queue = Promise.resolve();
  }

  /**
   * @param {Object} deps
   * @param {Object} deps.fs Hub Filesystem (`readFile`, `publish`).
   * @param {Object} [deps.key] Fabric Key that signs this Hub's edits.
   * @param {Function} [deps.relay] `(message) => void`, puts a frame on the mesh.
   * @returns {DocumentContractsService}
   */
  attach (deps = {}) {
    if (deps.fs) this.fs = deps.fs;
    if (deps.key) this.key = deps.key;
    if (typeof deps.relay === 'function') this._relay = deps.relay;
    return this;
  }

  async start () {
    const index = this._read('index.json');
    const ids = index && Array.isArray(index.contracts) ? index.contracts : [];
    for (const id of ids) {
      const contractId = hex64(id);
      if (!contractId) continue;
      const stored = this._read(`${contractId}.json`);
      if (!stored || !Array.isArray(stored.frames)) continue;
      this._records.set(contractId, { contractId, frames: stored.frames.slice(), fold: null });
      this._refold(contractId);
    }
    this.emit('ready', { contracts: this._records.size });
    return this;
  }

  /** x-only pubkey of the signing key, or null. */
  get editorPubkey () {
    if (!this.key || !this.key.pubkey) return null;
    const s = String(this.key.pubkey).toLowerCase();
    return s.length === 66 ? s.slice(2) : s;
  }

  /**
   * @param {string} name
   * @returns {Object|null}
   * @private
   */
  _read (name) {
    if (!this.fs || typeof this.fs.readFile !== 'function') return null;
    try {
      return parseJson(this.fs.readFile(`${this.settings.path}/${name}`));
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {string} contractId
   * @returns {Promise<void>}
   * @private
   */
  async _persist (contractId) {
    if (!this.fs || typeof this.fs.publish !== 'function') return;
    const record = this._records.get(contractId);
    if (record) {
      await this.fs.publish(`${this.settings.path}/${contractId}.json`, {
        type: 'DocumentContractFrames',
        contractId,
        frames: record.frames,
        updatedAt: new Date().toISOString()
      });
    }
    const documents = {};
    for (const [id, row] of this._documents) documents[id] = row;
    await this.fs.publish(`${this.settings.path}/index.json`, {
      contracts: [...this._records.keys()],
      documents
    });
  }

  /**
   * Serialize writes so concurrent edits chain onto each other.
   * @param {Function} fn
   * @returns {Promise<*>}
   * @private
   */
  _enqueue (fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  /**
   * @param {string} contractId
   * @private
   */
  _refold (contractId) {
    const record = this._records.get(contractId);
    if (!record) return null;
    record.fold = foldDocumentRevisions(record.frames, { contractId });
    for (const [id, row] of [...this._documents]) {
      if (row.contractId === contractId) this._documents.delete(id);
    }
    if (!record.fold.ok) return record.fold;
    const index = (row, onChain) => {
      const prev = this._documents.get(row.documentIdentifier);
      // The head's chain wins; on it, the latest revision of a content id.
      if (prev && prev.contractId !== contractId) return;
      if (prev && prev.onChain && !onChain) return;
      if (prev && prev.onChain === onChain && prev.revision >= row.revision) return;
      this._documents.set(row.documentIdentifier, {
        contractId,
        revision: row.revision,
        frameId: row.frameId,
        onChain
      });
    };
    for (const row of record.fold.revisions) index(row, true);
    for (const row of record.fold.forks) index(row, false);
    return record.fold;
  }

  /**
   * @param {string} hex
   * @param {string} contractId
   * @returns {boolean} Whether the frame was new.
   * @private
   */
  _addFrame (contractId, hex) {
    const record = this._records.get(contractId);
    if (!record || record.frames.includes(hex)) return false;
    if (record.frames.length >= this.settings.maxFramesPerContract) {
      throw new Error('document contract has too many frames');
    }
    record.frames.push(hex);
    return true;
  }

  /**
   * @param {Object} message
   * @private
   */
  _relayMessage (message) {
    if (!this._relay || !message) return;
    try {
      this._relay(message);
    } catch (err) {
      this.emit('warning', `[DOCUMENT-CONTRACTS] relay failed: ${err && err.message ? err.message : err}`);
    }
  }

  /**
   * Contract and revision of a document id.
   * @param {string} documentId
   * @returns {{ contractId: string, revision: number, frameId: string, head: boolean, headDocumentId: string|null }|null}
   */
  contractFor (documentId) {
    const id = normalizeDocumentIdentifier(documentId);
    const row = id ? this._documents.get(id) : null;
    if (!row) return null;
    const record = this._records.get(row.contractId);
    const head = record && record.fold && record.fold.head ? record.fold.head : null;
    return {
      contractId: row.contractId,
      revision: row.revision,
      frameId: row.frameId,
      head: !!(head && head.frameId === row.frameId),
      headDocumentId: head ? head.documentIdentifier : null,
      headRevision: head ? head.revision : null
    };
  }

  /**
   * Public view of one contract.
   * @param {string} contractId
   * @returns {Object|null}
   */
  get (contractId) {
    const id = hex64(contractId);
    const record = id ? this._records.get(id) : null;
    if (!record || !record.fold || !record.fold.ok) return null;
    const fold = record.fold;
    const def = fold.definition;
    return {
      type: 'DocumentContract',
      contractId: id,
      name: def.name,
      mime: def.mime,
      publisher: def.publisher,
      editors: fold.editors,
      threshold: def.members && def.members.threshold ? def.members.threshold : 1,
      created: def.created,
      editable: !!(this.editorPubkey && fold.editors.includes(this.editorPubkey)),
      publishFrameId: fold.publish.frameId,
      head: fold.head,
      revisions: fold.revisions,
      forks: fold.forks,
      invalid: fold.invalid.length,
      frames: fold.frames.length
    };
  }

  /**
   * Every contract, newest head first.
   * @returns {Object[]}
   */
  list () {
    const out = [];
    for (const id of this._records.keys()) {
      const view = this.get(id);
      if (view) {
        out.push({
          contractId: view.contractId,
          name: view.name,
          mime: view.mime,
          editable: view.editable,
          head: view.head,
          revisions: view.revisions.length,
          forks: view.forks.length
        });
      }
    }
    out.sort((a, b) => String((b.head && b.head.editedAt) || '').localeCompare(String((a.head && a.head.editedAt) || '')));
    return out;
  }

  /**
   * Signed frames of a contract, publish first (`{ id, hash, hex, parent, author }`).
   * @param {string} contractId
   * @returns {Object[]}
   */
  frames (contractId) {
    const record = this._records.get(hex64(contractId));
    return record && record.fold && record.fold.ok ? record.fold.frames : [];
  }

  /**
   * One version's provenance (publish through that revision).
   * @param {string} documentId
   * @returns {Object|null}
   */
  provenanceFor (documentId) {
    const row = this.contractFor(documentId);
    if (!row) return null;
    const record = this._records.get(row.contractId);
    return documentProvenance(record.frames, documentId, { contractId: row.contractId });
  }

  /**
   * Make a document editable: publish its contract and record `history` (each
   * version, oldest first) as revisions 1…n, all signed by this Hub.
   * @param {Object} opts
   * @param {Array<Object>} opts.history Versions (`id`, `sha256`, `name`, `mime`, `size`, `edited`).
   * @param {Array<string>} [opts.editors] More editor pubkeys.
   * @param {number} [opts.threshold]
   * @returns {Promise<Object>} Contract view.
   */
  async create (opts = {}) {
    return this._enqueue(async () => {
      if (!this.key || !this.key.private) throw new Error('this Hub has no signing key');
      const history = Array.isArray(opts.history) ? opts.history.filter(Boolean) : [];
      if (!history.length) throw new Error('document required');
      for (const doc of history) {
        const existing = this.contractFor(doc.id || doc.sha256);
        if (existing) {
          const err = new Error('document already belongs to a contract');
          err.contractId = existing.contractId;
          throw err;
        }
      }
      if (this._records.size >= this.settings.maxContracts) throw new Error('too many document contracts');
      const latest = history[history.length - 1];
      const definition = buildDocumentContractGenesis({
        name: opts.name || latest.name,
        mime: opts.mime || latest.mime,
        publisher: this.key.pubkey,
        editors: opts.editors,
        threshold: opts.threshold
      });
      const publish = buildDocumentContractPublishMessage({ definition, key: this.key });
      const contractId = documentContractId(definition);
      const messages = [publish];
      let previous = publish;
      let previousId = null;
      history.forEach((doc, i) => {
        const message = buildDocumentRevisionMessage({
          contract: contractId,
          previous,
          document: doc,
          revision: i + 1,
          previousDocumentIdentifier: previousId,
          editedAt: doc.edited || doc.created,
          note: i === 0 ? opts.note : null,
          key: this.key
        });
        messages.push(message);
        previous = message;
        previousId = normalizeDocumentIdentifier(doc.id || doc.sha256);
      });
      this._records.set(contractId, {
        contractId,
        frames: messages.map((m) => m.toBuffer().toString('hex')),
        fold: null
      });
      this._refold(contractId);
      await this._persist(contractId);
      for (const message of messages) this._relayMessage(message);
      this.emit('contract', { contractId, revisions: history.length });
      return this.get(contractId);
    });
  }

  /**
   * Record a new version replacing `previousDocumentId` (normally the head; an
   * older version makes a fork). Signed by this Hub, which must be an editor.
   * @param {Object} opts
   * @param {string} opts.previousDocumentId
   * @param {Object} opts.document The new version (`id`, `sha256`, `name`, `mime`, `size`).
   * @param {string} [opts.note]
   * @param {string} [opts.editedAt]
   * @returns {Promise<{ contractId: string, revision: Object, contract: Object }>}
   */
  async appendRevision (opts = {}) {
    return this._enqueue(async () => {
      if (!this.key || !this.key.private) throw new Error('this Hub has no signing key');
      const source = this.contractFor(opts.previousDocumentId);
      if (!source) throw new Error('document is not editable (no contract)');
      const record = this._records.get(source.contractId);
      if (!record.fold.editors.includes(this.editorPubkey)) {
        throw new Error('this Hub is not an editor of the document');
      }
      const previousFrame = record.fold.frames.find((f) => f.id === source.frameId);
      if (!previousFrame) throw new Error('previous revision frame missing');
      const message = buildDocumentRevisionMessage({
        contract: source.contractId,
        previous: previousFrame.id,
        document: opts.document,
        revision: source.revision + 1,
        previousDocumentIdentifier: normalizeDocumentIdentifier(opts.previousDocumentId),
        editedAt: opts.editedAt,
        note: opts.note,
        key: this.key
      });
      this._addFrame(source.contractId, message.toBuffer().toString('hex'));
      this._refold(source.contractId);
      await this._persist(source.contractId);
      this._relayMessage(message);
      const fold = record.fold;
      const revision = fold.revisions.concat(fold.forks).find((r) => r.frameId === message.id) || null;
      this.emit('revision', { contractId: source.contractId, revision });
      return { contractId: source.contractId, revision, contract: this.get(source.contractId) };
    });
  }

  /**
   * Take a signed frame from the mesh, a delivery, or a remote editor.
   * Publishes start a contract; revisions join theirs (or wait for its publish).
   * Invalid revisions are kept out of the history.
   * @param {*} input Message, Buffer, hex, or `fabric:<hex>`.
   * @returns {Promise<{ accepted: boolean, duplicate?: boolean, pending?: boolean, kind?: string, contractId?: string, reason?: string }>}
   */
  async ingestFrame (input) {
    return this._enqueue(() => this._ingest(input, true));
  }

  /**
   * @param {*} input
   * @param {boolean} persist
   * @returns {Promise<Object>}
   * @private
   */
  async _ingest (input, persist) {
    const parsed = parseDocumentContractFrame(input);
    if (!parsed.ok) return { accepted: false, reason: parsed.reason };
    const contractId = parsed.contractId;
    if (parsed.kind === 'publish') {
      if (!isDocumentContractDefinition(parsed.definition)) return { accepted: false, reason: 'not a document contract' };
      if (this._records.has(contractId)) {
        // The same genesis signed by another editor: kept, the fold picks one.
        const added = this._addFrame(contractId, parsed.hex);
        if (added) {
          this._refold(contractId);
          if (persist) await this._persist(contractId);
        }
        return { accepted: false, duplicate: !added, kind: 'publish', contractId };
      }
      if (this._records.size >= this.settings.maxContracts) return { accepted: false, reason: 'too many document contracts' };
      const record = { contractId, frames: [parsed.hex], fold: null };
      this._records.set(contractId, record);
      const fold = this._refold(contractId);
      if (!fold || !fold.ok) {
        this._records.delete(contractId);
        return { accepted: false, reason: (fold && fold.reason) || 'invalid publish' };
      }
      const waiting = this._pending.get(contractId) || [];
      this._pending.delete(contractId);
      for (const hex of waiting) this._addFrame(contractId, hex);
      if (waiting.length) this._refold(contractId);
      if (persist) await this._persist(contractId);
      this.emit('contract', { contractId, revisions: record.fold.revisions.length });
      return { accepted: true, kind: 'publish', contractId };
    }
    const record = this._records.get(contractId);
    if (!record) {
      const total = [...this._pending.values()].reduce((n, list) => n + list.length, 0);
      if (total >= this.settings.maxPendingFrames) return { accepted: false, reason: 'unknown contract' };
      const list = this._pending.get(contractId) || [];
      if (!list.includes(parsed.hex)) list.push(parsed.hex);
      this._pending.set(contractId, list);
      return { accepted: false, pending: true, kind: 'revision', contractId };
    }
    if (record.frames.includes(parsed.hex)) return { accepted: false, duplicate: true, kind: 'revision', contractId };
    const before = new Set(record.fold && record.fold.ok ? record.fold.frames.map((f) => f.id) : []);
    this._addFrame(contractId, parsed.hex);
    const fold = this._refold(contractId);
    const kept = fold && fold.ok && fold.frames.some((f) => f.id === parsed.id);
    if (!kept) {
      const why = fold && fold.invalid ? fold.invalid.find((row) => row.id === parsed.id) : null;
      // Keep a frame whose parent may still arrive; drop one that is refused outright.
      if (!why || why.reason !== 'parent frame missing') {
        record.frames = record.frames.filter((hex) => hex !== parsed.hex);
        this._refold(contractId);
        return { accepted: false, kind: 'revision', contractId, reason: why ? why.reason : 'refused' };
      }
    }
    // A late parent may connect frames that were waiting for it.
    const added = fold && fold.ok ? fold.frames.filter((f) => !before.has(f.id)).length : 0;
    if (persist) await this._persist(contractId);
    if (kept) this.emit('revision', { contractId, frameId: parsed.id });
    return { accepted: !!kept, pending: !kept, kind: 'revision', contractId, added };
  }

  /**
   * Check a provenance bundle and keep its frames.
   * @param {Object} provenance `DocumentProvenance`.
   * @param {Object} [expect] `{ documentIdentifier, sha256 }`
   * @returns {Promise<Object>} {@link verifyDocumentProvenance} result.
   */
  async ingestProvenance (provenance, expect = {}) {
    const checked = verifyDocumentProvenance(provenance, expect);
    if (!checked.ok) return checked;
    return this._enqueue(async () => {
      const messages = provenance && provenance.collection && Array.isArray(provenance.collection.messages)
        ? provenance.collection.messages
        : [];
      for (const row of messages) await this._ingest(row.hex, false);
      if (this._records.has(checked.contractId)) await this._persist(checked.contractId);
      return checked;
    });
  }
}

module.exports = DocumentContractsService;
