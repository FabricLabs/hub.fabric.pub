'use strict';

/**
 * @fileoverview Contract journal rows (label, time, a Data payload, and the
 * Fabric message behind each row), shared by Hub's contract page and
 * GoonCitizen's group log. Framework free and browser safe.
 */

const { messageLabel, messageHref } = require('./fabricMessageView');

/** @private */
function rowTime (entry) {
  const e = entry || {};
  const v = e.at || e.created || e.createdAt || e.enqueuedAt || e.acceptedAt || e.ts || e.timestamp || null;
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v).toISOString();
  return String(v);
}

/** @private */
function rowMs (row) {
  const t = row && row.at ? Date.parse(row.at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Journal rows with a Data payload and a Fabric link. Each entry may carry
 * `fabricMessage.hash` (GoonCitizen journals) or `frameId` (Hub log entries);
 * rows without one get `fabricHref: null` (show a disabled Fabric button).
 * @param {Object[]} journal
 * @param {Object} [opts]
 * @param {Function} [opts.label] `(entry) => string`, default the humanized type
 * @param {Function} [opts.hrefForHash] `(hash) => string|null`, default `/messages/<hash>`
 * @returns {Object[]} `{ key, label, type, at, data, fabricHash, fabricHref }`
 */
function journalRows (journal, opts = {}) {
  const label = typeof opts.label === 'function' ? opts.label : (e) => messageLabel(e && e.type);
  const hrefForHash = typeof opts.hrefForHash === 'function' ? opts.hrefForHash : (h) => messageHref(h);
  return (Array.isArray(journal) ? journal : []).filter(Boolean).map((entry, i) => {
    const hash = (entry.fabricMessage && entry.fabricMessage.hash) || entry.frameId || null;
    return {
      key: String(entry.id || entry.hash || entry.frameId || `j${i}`),
      label: label(entry),
      type: entry.type || null,
      at: rowTime(entry),
      data: entry,
      fabricHash: hash,
      fabricHref: hash ? hrefForHash(hash) : null
    };
  });
}

/**
 * One timeline for an application contract (`GET /contracts/:id` `application`):
 * Hub log entries naming the contract, the Statechain patches that sealed it,
 * and the CONTRACT_MESSAGE frames queued for it. Newest first.
 * @param {Object} application
 * @param {Object} [opts] Same as {@link journalRows}
 * @returns {Object[]} rows with `source`: `log` | `seal` | `queue`
 */
function applicationTimeline (application, opts = {}) {
  const app = application || {};
  const rows = [];
  for (const row of journalRows(app.messages || [], opts)) {
    rows.push(Object.assign(row, {
      source: 'log',
      fabricHref: row.fabricHref || (row.data && row.data.href) || null
    }));
  }
  for (const seal of Array.isArray(app.seals) ? app.seals : []) {
    if (!seal) continue;
    rows.push({
      key: `seal:${seal.seq != null ? seal.seq : seal.clock}`,
      label: `Statechain sealed (clock ${Number(seal.clock) || 0})`,
      type: 'SidechainStatePatch',
      at: rowTime(seal),
      data: seal,
      fabricHash: null,
      fabricHref: null,
      source: 'seal'
    });
  }
  const queue = app.queue && Array.isArray(app.queue.entries) ? app.queue.entries : [];
  for (const q of queue) {
    if (!q) continue;
    rows.push({
      key: `queue:${q.hash}`,
      label: `Queued ${q.type ? messageLabel(q.type).toLowerCase() : 'contract message'}`,
      type: q.type || 'CONTRACT_MESSAGE',
      at: rowTime(q),
      data: q,
      fabricHash: q.hash || null,
      fabricHref: null,
      source: 'queue'
    });
  }
  return rows.sort((a, b) => rowMs(b) - rowMs(a));
}

/**
 * Header facts for an application contract.
 * @param {Object} application
 * @returns {Object}
 */
function applicationSummary (application) {
  const app = application || {};
  const tracked = app.tracked || {};
  const sidechain = app.sidechain || null;
  return {
    contractId: app.contractId || tracked.contractId || null,
    name: tracked.name || null,
    version: tracked.version || null,
    status: app.status || tracked.status || null,
    signer: tracked.signer || null,
    definitionDigest: tracked.definitionDigest || null,
    spendAddress: tracked.spendAddress || null,
    clock: sidechain ? Number(sidechain.clock) || 0 : null,
    stateDigest: sidechain ? sidechain.stateDigest || null : (tracked.stateDigest || null),
    parentSealPath: sidechain ? sidechain.parentSealPath || null : null,
    queued: app.queue ? Number(app.queue.count) || 0 : 0,
    seals: Array.isArray(app.seals) ? app.seals.length : 0,
    messages: Array.isArray(app.messages) ? app.messages.length : 0
  };
}

module.exports = {
  journalRows,
  applicationTimeline,
  applicationSummary
};
