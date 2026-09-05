'use strict';

/**
 * Document Market inventory book — accumulate peer `INVENTORY_RESPONSE` /
 * `FABRIC_DOCUMENT_OFFER_RESPONSE` rows and compute a local republish price.
 *
 * Durable offers live in Hub `collections.documentoffers` (metadata only; no blobs).
 * Outbound inventory must still list only documents this node can fulfill.
 *
 * Applications may require `@fabric/hub/functions/documentInventoryMarket`.
 */

const COLLECTION = 'documentoffers';

/**
 * @param {string} name
 * @param {boolean} fallback
 * @param {Object} [env]
 * @returns {boolean}
 */
function envFlag (name, fallback, env) {
  const src = env && typeof env === 'object' ? env : process.env;
  const v = src && src[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v === 'true';
}

/**
 * @param {*} value
 * @param {string} envName
 * @param {number} fallback
 * @param {Object} [env]
 * @returns {number}
 */
function envInt (value, envName, fallback, env) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
  const src = env && typeof env === 'object' ? env : process.env;
  const raw = src && src[envName];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeDocumentId (value) {
  const s = String(value || '').trim().toLowerCase();
  return s || null;
}

function peerKeyFromHex (value) {
  const h = String(value || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(h) || /^0[23][0-9a-f]{64}$/.test(h)) return h;
  return null;
}

function peerKey (peer) {
  const p = peer && typeof peer === 'object' ? peer : {};
  return peerKeyFromHex(p.peerPubkey)
    || (p.peerAddress ? String(p.peerAddress).trim().toLowerCase() : null)
    || 'unknown';
}

function offerRecordId (documentId, key) {
  return String(documentId) + ':' + String(key);
}

function priceSats (row) {
  if (!row || typeof row !== 'object') return Number.POSITIVE_INFINITY;
  const raw = row.purchasePriceSats != null ? row.purchasePriceSats : row.rateSats;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return Number.POSITIVE_INFINITY;
  return Math.floor(n);
}

function formatPrice (row) {
  const n = priceSats(row);
  if (!Number.isFinite(n)) return 'unset';
  if (n === 0) return 'free';
  return n.toLocaleString() + ' sats';
}

function peerLabel (row) {
  if (!row || typeof row !== 'object') return 'peer';
  if (row.local === true) return row.peerAlias || 'this node';
  if (row.peerAlias) return String(row.peerAlias);
  const pk = row.peerPubkey ? String(row.peerPubkey) : '';
  if (pk.length > 12) return pk.slice(0, 8) + '\u2026' + pk.slice(-4);
  if (pk) return pk;
  return row.peerAddress ? String(row.peerAddress) : 'peer';
}

/**
 * Resolve Document Market policy. Off by default.
 *
 * Environment:
 * - `FABRIC_DOCUMENT_MARKET_ACCUMULATE=1`
 * - `FABRIC_DOCUMENT_MARKET_REPUBLISH=1` (implies accumulate)
 * - `FABRIC_DOCUMENT_MARKET_MARKUP_BPS` (default 1000 = 10%)
 * - `FABRIC_DOCUMENT_MARKET_MARKUP_SATS` (default 0)
 * - `FABRIC_DOCUMENT_MARKET_MIN_PRICE_SATS` (default 0)
 *
 * @param {Object} [settings] Hub settings (`documents.market` or `documentMarket`)
 * @param {Object} [env]
 * @returns {Object}
 */
function normalizeMarketPolicy (settings, env) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const market = (s.documents && s.documents.market) || s.documentMarket || {};
  const accumulate = market.accumulatePeerInventories != null
    ? !!market.accumulatePeerInventories
    : envFlag('FABRIC_DOCUMENT_MARKET_ACCUMULATE', false, env);
  const republish = market.republishWithMarkup != null
    ? !!market.republishWithMarkup
    : envFlag('FABRIC_DOCUMENT_MARKET_REPUBLISH', false, env);
  const neverLower = market.neverLowerExistingPrice != null
    ? !!market.neverLowerExistingPrice
    : envFlag('FABRIC_DOCUMENT_MARKET_NEVER_LOWER', true, env);
  return {
    accumulatePeerInventories: accumulate || republish,
    republishWithMarkup: republish,
    markupBps: envInt(market.markupBps, 'FABRIC_DOCUMENT_MARKET_MARKUP_BPS', 1000, env),
    markupSats: envInt(market.markupSats, 'FABRIC_DOCUMENT_MARKET_MARKUP_SATS', 0, env),
    minPriceSats: envInt(market.minPriceSats, 'FABRIC_DOCUMENT_MARKET_MIN_PRICE_SATS', 0, env),
    neverLowerExistingPrice: neverLower
  };
}

/**
 * List price from a remote cost basis: `ceil(cost * (1 + bps/10000)) + markupSats`, floored at minPriceSats.
 * @param {number} costSats
 * @param {Object} [policy]
 * @returns {number}
 */
function markupListPrice (costSats, policy) {
  const p = policy && typeof policy === 'object' ? policy : {};
  const cost = Math.max(0, Math.floor(Number(costSats) || 0));
  const bps = Math.max(0, Math.floor(Number(p.markupBps) || 0));
  const extra = Math.max(0, Math.floor(Number(p.markupSats) || 0));
  const minP = Math.max(0, Math.floor(Number(p.minPriceSats) || 0));
  const marked = Math.ceil((cost * (10000 + bps)) / 10000) + extra;
  return Math.max(marked, minP);
}

function itemsFromInventoryMessage (message) {
  const obj = (message && (message.object || message)) || {};
  const items = obj.items || obj.documents || obj.inventory;
  return Array.isArray(items) ? items : [];
}

/**
 * Compact buyer-facing HTLC quote from an inventory item. Drops seller secrets
 * (`preimageHex`, content keys) so the offer book never stores unlock material.
 *
 * @param {Object} [htlc]
 * @returns {Object|undefined}
 */
function compactInventoryHtlc (htlc) {
  if (!htlc || typeof htlc !== 'object') return undefined;
  const settlementId = String(htlc.settlementId || '').trim();
  const paymentAddress = String(htlc.paymentAddress || '').trim();
  if (!settlementId || !paymentAddress) return undefined;
  const out = {
    kind: htlc.kind ? String(htlc.kind).slice(0, 64) : 'P2TR_SCRIPT_PATH',
    settlementId: settlementId.slice(0, 64),
    paymentAddress: paymentAddress.slice(0, 128)
  };
  if (htlc.paymentHashHex) out.paymentHashHex = String(htlc.paymentHashHex).trim().toLowerCase().slice(0, 64);
  const amt = Number(htlc.amountSats);
  if (Number.isFinite(amt) && amt > 0) out.amountSats = Math.round(amt);
  if (htlc.amountBtc) out.amountBtc = String(htlc.amountBtc).slice(0, 32);
  if (htlc.bitcoinUri) out.bitcoinUri = String(htlc.bitcoinUri).slice(0, 512);
  const rh = Number(htlc.refundLockHeight);
  if (Number.isFinite(rh) && rh > 0) out.refundLockHeight = Math.round(rh);
  const lb = Number(htlc.locktimeDeltaBlocks);
  if (Number.isFinite(lb) && lb > 0) out.locktimeDeltaBlocks = Math.round(lb);
  if (htlc.sellerPublicKeyHex) {
    out.sellerPublicKeyHex = String(htlc.sellerPublicKeyHex).trim().slice(0, 66);
  }
  return out;
}

function normalizeInventoryItem (item, peer) {
  if (!item || typeof item !== 'object') return null;
  const documentId = normalizeDocumentId(
    item.id || item.documentId || item.sha256 || item.contentHashHex || item.contentHash
  );
  if (!documentId) return null;
  const key = peerKey(peer);
  const raw = item.purchasePriceSats != null ? item.purchasePriceSats : item.rateSats;
  const purchasePriceSats = Number.isFinite(Number(raw))
    ? Math.max(0, Math.floor(Number(raw)))
    : 0;
  const name = item.name
    ? String(item.name).slice(0, 256)
    : (item.id ? String(item.id).slice(0, 64) : 'document');
  const published = item.published === true
    || (typeof item.published === 'string' && item.published.length > 0);
  const htlc = compactInventoryHtlc(item.htlc);
  return {
    id: offerRecordId(documentId, key),
    documentId,
    sha256: normalizeDocumentId(item.sha256 || item.contentHashHex || item.contentHash) || documentId,
    name,
    mime: item.mime ? String(item.mime).slice(0, 128) : 'application/octet-stream',
    size: item.size != null && Number.isFinite(Number(item.size)) ? Number(item.size) : null,
    purchasePriceSats,
    published,
    peerPubkey: peerKeyFromHex(peer && peer.peerPubkey),
    peerAddress: peer && peer.peerAddress ? String(peer.peerAddress) : null,
    peerAlias: peer && peer.peerAlias ? String(peer.peerAlias) : null,
    receivedAt: new Date().toISOString(),
    local: false,
    ...(htlc ? { htlc } : {})
  };
}

function listOffers (map) {
  if (!map || typeof map !== 'object') return [];
  return Object.values(map).filter((row) => row && typeof row === 'object');
}

/**
 * Replace every stored offer from one peer with a fresh inventory snapshot.
 * Mutates `map` in place.
 * @param {Object} map collection map
 * @param {Object} peer
 * @param {object[]} items
 * @returns {object[]}
 */
function replacePeerOffers (map, peer, items) {
  const out = map && typeof map === 'object' ? map : {};
  const key = peerKey(peer);
  for (const id of Object.keys(out)) {
    const row = out[id];
    if (!row) continue;
    const rowKey = peerKey({
      peerPubkey: row.peerPubkey,
      peerAddress: row.peerAddress
    });
    if (rowKey === key) delete out[id];
  }
  const saved = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const rec = normalizeInventoryItem(item, peer);
    if (!rec) continue;
    out[rec.id] = rec;
    saved.push(rec);
  }
  return saved;
}

function localOffer (doc, self) {
  if (!doc) return null;
  const documentId = normalizeDocumentId(doc.id || doc.sha256);
  if (!documentId) return null;
  const me = self && typeof self === 'object' ? self : {};
  return {
    id: offerRecordId(documentId, 'local'),
    documentId,
    sha256: doc.sha256 || documentId,
    name: doc.name || 'document',
    mime: doc.mime || 'application/octet-stream',
    size: doc.size != null ? Number(doc.size) : null,
    purchasePriceSats: Math.max(0, Math.floor(Number(doc.purchasePriceSats) || 0)),
    peerPubkey: peerKeyFromHex(me.peerPubkey),
    peerAlias: me.peerAlias || 'this node',
    peerAddress: null,
    local: true,
    published: !!(doc.published === true || (typeof doc.published === 'string' && doc.published))
  };
}

function sortOffersByPrice (offers) {
  return (Array.isArray(offers) ? offers.slice() : []).sort((a, b) => {
    const pa = priceSats(a);
    const pb = priceSats(b);
    if (pa !== pb) return pa - pb;
    const la = a.local === true ? 0 : 1;
    const lb = b.local === true ? 0 : 1;
    if (la !== lb) return la - lb;
    return String(a.peerPubkey || a.peerAddress || '')
      .localeCompare(String(b.peerPubkey || b.peerAddress || ''));
  });
}

function enrichAlias (offer, aliases) {
  if (!offer || offer.peerAlias || !offer.peerPubkey || !aliases) return offer;
  const alias = aliases[offer.peerPubkey] || aliases[String(offer.peerPubkey).toLowerCase()];
  if (!alias) return offer;
  return Object.assign({}, offer, { peerAlias: alias });
}

function offersForDocument (map, documentId, opts) {
  const id = normalizeDocumentId(documentId);
  if (!id) return [];
  const options = opts && typeof opts === 'object' ? opts : {};
  const remotes = listOffers(map)
    .filter((o) => o.documentId === id || o.sha256 === id)
    .map((o) => enrichAlias(o, options.aliases));
  const offers = remotes.slice();
  const local = options.localDoc ? localOffer(options.localDoc, options.self || {}) : null;
  if (local) offers.push(local);
  return sortOffersByPrice(offers);
}

function cheapestRemotePriceSats (offers) {
  let best = Number.POSITIVE_INFINITY;
  for (const o of (Array.isArray(offers) ? offers : [])) {
    if (!o || o.local === true) continue;
    const n = priceSats(o);
    if (n < best) best = n;
  }
  return best;
}

/**
 * Drop operator-only reseller fields from a catalog / GET row.
 * @param {object} row
 * @returns {object}
 */
function omitPrivateMarketFields (row) {
  if (!row || typeof row !== 'object') return row;
  if (row.costBasisSats == null && row.local !== false) return row;
  const out = Object.assign({}, row);
  delete out.costBasisSats;
  if (out.local === false) {
    delete out.contentBase64;
    delete out.ciphertext;
    delete out.content;
  }
  return out;
}

function catalogRowFromOffers (documentId, group) {
  const sorted = sortOffersByPrice(group);
  const best = sorted[0] || {};
  return {
    id: documentId,
    sha256: best.sha256 || documentId,
    name: best.name || 'document',
    mime: best.mime || 'application/octet-stream',
    size: best.size != null ? best.size : null,
    purchasePriceSats: Number.isFinite(priceSats(best)) ? priceSats(best) : 0,
    published: false,
    local: false,
    source: 'peer',
    created: best.receivedAt || null,
    offerCount: group.length,
    peerCount: group.length,
    peerPubkey: best.peerPubkey || null,
    peerAlias: best.peerAlias || null,
    peerAddress: best.peerAddress || null,
    bestPeerPriceSats: Number.isFinite(priceSats(best)) ? priceSats(best) : null
  };
}

/**
 * Merge this node's catalog with remote inventory rows (one row per file id).
 * @param {object[]} localDocs
 * @param {object[]} offers
 * @param {Object} [opts]
 * @returns {object[]}
 */
function mergeCatalog (localDocs, offers, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const byId = new Map();
  for (const doc of (Array.isArray(localDocs) ? localDocs : [])) {
    if (!doc || !doc.id) continue;
    byId.set(String(doc.id).toLowerCase(), Object.assign({}, doc, {
      local: doc.local !== false,
      source: doc.source || 'local'
    }));
  }
  const groups = new Map();
  for (const offer of (Array.isArray(offers) ? offers : [])) {
    const id = normalizeDocumentId(offer.documentId || offer.sha256);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(enrichAlias(offer, options.aliases));
  }
  for (const [id, group] of groups) {
    const existing = byId.get(id);
    const bestRemote = cheapestRemotePriceSats(group);
    if (existing) {
      existing.peerCount = group.length;
      existing.offerCount = group.length + 1;
      existing.offers = sortOffersByPrice(group.concat(
        existing.local !== false ? [localOffer(existing, options.self || {})].filter(Boolean) : []
      ));
      if (Number.isFinite(bestRemote)) existing.bestPeerPriceSats = bestRemote;
    } else if (options.includeRemoteOnly !== false) {
      byId.set(id, catalogRowFromOffers(id, group));
    }
  }
  return Array.from(byId.values()).map(omitPrivateMarketFields);
}

/**
 * Whether this node should publish or raise a local listing.
 * Honest fulfillment requires a local blob; remote-only rows stay in the offer book.
 *
 * @param {Object} opts
 * @param {boolean} opts.hasLocalFile
 * @param {boolean} [opts.published]
 * @param {number} [opts.publishedPriceSats]
 * @param {object[]} [opts.remoteOffers]
 * @param {Object} [opts.policy]
 * @returns {Object}
 */
function republishDecision (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const policy = o.policy && typeof o.policy === 'object' ? o.policy : {};
  if (!policy.republishWithMarkup) {
    return { action: 'skip', reason: 'disabled' };
  }
  if (!o.hasLocalFile) {
    return { action: 'skip', reason: 'no-local-file' };
  }
  const remotes = (Array.isArray(o.remoteOffers) ? o.remoteOffers : []).filter((row) => row && row.local !== true);
  if (!remotes.length) {
    return { action: 'skip', reason: 'no-remote-offers' };
  }
  const cost = cheapestRemotePriceSats(remotes);
  if (!Number.isFinite(cost)) {
    return { action: 'skip', reason: 'no-cost' };
  }
  const listPrice = markupListPrice(cost, policy);
  const existing = Number(o.publishedPriceSats);
  const hasExistingPrice = Number.isFinite(existing) && existing > 0;
  const isPublished = o.published === true || (typeof o.published === 'string' && o.published.length > 0);
  if (isPublished && !hasExistingPrice) {
    return {
      action: 'skip',
      reason: 'unpriced-published',
      costBasisSats: cost,
      listPrice
    };
  }
  if (hasExistingPrice && existing >= listPrice) {
    if (policy.neverLowerExistingPrice !== false || existing === listPrice) {
      return {
        action: 'skip',
        reason: 'already-at-or-above-markup',
        costBasisSats: cost,
        listPrice,
        purchasePriceSats: existing
      };
    }
    return {
      action: 'raise',
      purchasePriceSats: listPrice,
      costBasisSats: cost,
      previousPriceSats: existing
    };
  }
  if (hasExistingPrice && existing < listPrice) {
    return {
      action: 'raise',
      purchasePriceSats: listPrice,
      costBasisSats: cost,
      previousPriceSats: existing
    };
  }
  return {
    action: 'publish',
    purchasePriceSats: listPrice,
    costBasisSats: cost
  };
}

/**
 * Ask every live TCP peer for a documents inventory snapshot.
 * @param {Object} peer Fabric Peer
 * @returns {{ requested: number, peers: string[] }}
 */
function requestConnectedInventories (peer) {
  if (!peer || typeof peer.requestPeerInventory !== 'function') {
    return { requested: 0, peers: [] };
  }
  const addrs = Object.keys(peer.connections || {});
  const peers = [];
  for (const addr of addrs) {
    const conn = peer.connections[addr];
    if (!conn || typeof conn._writeFabric !== 'function') continue;
    try {
      if (peer.requestPeerInventory(addr, { kind: 'documents' })) peers.push(addr);
    } catch (_) { /* skip broken sockets */ }
  }
  return { requested: peers.length, peers };
}

module.exports = {
  COLLECTION,
  envFlag,
  normalizeDocumentId,
  peerKeyFromHex,
  peerKey,
  offerRecordId,
  priceSats,
  formatPrice,
  peerLabel,
  normalizeMarketPolicy,
  markupListPrice,
  itemsFromInventoryMessage,
  compactInventoryHtlc,
  normalizeInventoryItem,
  listOffers,
  replacePeerOffers,
  localOffer,
  sortOffersByPrice,
  offersForDocument,
  cheapestRemotePriceSats,
  mergeCatalog,
  omitPrivateMarketFields,
  republishDecision,
  requestConnectedInventories
};
