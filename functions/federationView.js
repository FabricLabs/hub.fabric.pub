'use strict';

/**
 * @fileoverview Named federation view models for list and detail pages,
 * shared by Hub and GoonCitizen. Framework free and browser safe. Input is a
 * federation view as the Hub serves it (`GET /federations/:id`): `validators`
 * (compressed cosigner keys), `threshold`, `members`, `vaultAddress`, `utxos`,
 * optional `previous` vaults, and `withdrawals` whose `signers` are x-only keys.
 */

/** @private */
const CLOSED_WITHDRAWAL = new Set(['broadcast', 'declined', 'failed']);

/**
 * X-only (32-byte hex) form of a compressed or x-only key, lowercased.
 * @param {string} key
 * @returns {string}
 */
function xOnly (key) {
  const s = String(key || '').trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(s)) return s.slice(2);
  return s;
}

/**
 * Do two keys name the same x-only key?
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameKey (a, b) {
  const x = xOnly(a);
  return !!x && x === xOnly(b);
}

/**
 * `abcdef012345…` (first `n` characters, default 12).
 * @param {string} id
 * @param {number} [n=12]
 * @returns {string}
 */
function shortId (id, n = 12) {
  const s = String(id || '');
  if (!s) return '—';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * `0123456789…abcdef` for a key.
 * @param {string} key
 * @returns {string}
 */
function shortKey (key) {
  const s = String(key || '');
  if (s.length < 18) return s || '—';
  return `${s.slice(0, 10)}…${s.slice(-6)}`;
}

/**
 * Signer keys of a federation (`validators`), its descriptor, a GoonCitizen
 * group wallet (`keys`), or a group's proposed policy.
 * @param {Object} view
 * @returns {string[]}
 */
function signerList (view) {
  if (!view) return [];
  if (Array.isArray(view.validators) && view.validators.length) return view.validators.slice();
  if (view.descriptor && Array.isArray(view.descriptor.validators)) return view.descriptor.validators.slice();
  if (Array.isArray(view.keys) && view.keys.length) return view.keys.slice();
  if (view.proposedPolicy && Array.isArray(view.proposedPolicy.validators)) return view.proposedPolicy.validators.slice();
  return [];
}

/**
 * `2 of 3`.
 * @param {Object} view
 * @returns {string}
 */
function thresholdLabel (view) {
  const n = signerList(view).length;
  const k = Math.max(1, Number(view && view.threshold) || 1);
  return n ? `${k} of ${n}` : `${k} of n`;
}

/**
 * Is `key` one of the federation's signers?
 * @param {Object} view
 * @param {string} key
 * @returns {boolean}
 */
function isSignerKey (view, key) {
  if (!key) return false;
  return signerList(view).some((v) => sameKey(v, key));
}

/**
 * Federation URL path (`/federations/<id>`).
 * @param {(Object|string)} viewOrId
 * @returns {string}
 */
function federationHref (viewOrId) {
  const id = typeof viewOrId === 'string' ? viewOrId : (viewOrId && viewOrId.id) || '';
  return `/federations/${encodeURIComponent(String(id))}`;
}

/**
 * One row per signer: key, short key, alias, status, publisher, the Hub, the viewer.
 * @param {Object} view
 * @param {string} [viewerKey] The reader's cosigner key
 * @returns {Object[]}
 */
function signerRows (view, viewerKey) {
  const members = Array.isArray(view && view.members) ? view.members : [];
  const publisher = view && view.publisher;
  const hub = view && view.self;
  return signerList(view).map((pubkey, index) => {
    const m = members.find((row) => row && sameKey(row.pubkey, pubkey)) || {};
    return {
      index,
      pubkey,
      short: shortKey(pubkey),
      alias: m.alias || null,
      url: m.url || null,
      status: m.status || null,
      publisher: !!publisher && sameKey(publisher, pubkey),
      hub: !!hub && sameKey(hub, pubkey),
      you: !!viewerKey && sameKey(viewerKey, pubkey)
    };
  });
}

/**
 * Current vault, then earlier vaults (left by a signer change) that still hold coins.
 * @param {Object} view
 * @returns {Object[]} `{ address, current, balanceSats, coins, threshold, signers, federationId }`
 */
function vaultRows (view) {
  if (!view) return [];
  const sum = (utxos) => (Array.isArray(utxos) ? utxos.reduce((s, u) => s + (Number(u && u.sats) || 0), 0) : null);
  const rows = [];
  const currentAddress = view.vaultAddress || view.address;
  if (currentAddress) {
    rows.push({
      address: currentAddress,
      current: true,
      balanceSats: view.balanceSats != null ? Number(view.balanceSats) : sum(view.utxos),
      coins: Array.isArray(view.utxos) ? view.utxos.slice() : null,
      error: view.balanceError || null,
      threshold: thresholdLabel(view),
      signers: signerList(view).length,
      federationId: view.federationId || view.id || null
    });
  }
  for (const prev of Array.isArray(view.previous) ? view.previous : []) {
    if (!prev) continue;
    const address = prev.vaultAddress || prev.address;
    if (!address) continue;
    const coins = Array.isArray(prev.utxos) ? prev.utxos.slice() : (Array.isArray(prev.coins) ? prev.coins.slice() : null);
    rows.push({
      address,
      current: false,
      balanceSats: prev.balanceSats != null ? Number(prev.balanceSats) : sum(coins),
      coins,
      error: prev.balanceError || null,
      threshold: thresholdLabel(prev),
      signers: signerList(prev).length,
      federationId: prev.id || prev.federationId || null
    });
  }
  return rows;
}

/**
 * Withdrawal rows: `n of k` signatures, who signed, whether the viewer has, and can.
 * @param {Object} view
 * @param {string} [viewerKey]
 * @returns {Object[]}
 */
function withdrawalRows (view, viewerKey) {
  const k = Math.max(1, Number(view && view.threshold) || 1);
  const list = Array.isArray(view && view.withdrawals) ? view.withdrawals : [];
  const isSigner = isSignerKey(view, viewerKey);
  return list.map((w) => {
    const signers = Array.isArray(w.signers) ? w.signers.map(xOnly) : [];
    const signedByViewer = !!viewerKey && signers.includes(xOnly(viewerKey));
    const open = !w.txid && !CLOSED_WITHDRAWAL.has(String(w.status || ''));
    return {
      requestId: w.requestId,
      requester: w.requester || null,
      destinationAddress: w.destinationAddress || null,
      amountSats: Number(w.amountSats) || 0,
      feeSats: Number(w.feeSats) || 0,
      changeSats: w.changeSats != null ? Number(w.changeSats) : null,
      input: w.input || null,
      signatures: signers.length,
      threshold: k,
      progress: `${Math.min(signers.length, k)} of ${k}`,
      ready: signers.length >= k,
      signers,
      signedBySelf: !!w.signedBySelf,
      signedByViewer,
      canSign: open && isSigner && !signedByViewer,
      status: w.status || null,
      txid: w.txid || null,
      error: w.error || null,
      createdAt: w.createdAt || null
    };
  });
}

/**
 * Header facts for a federation page or list row.
 * @param {Object} view
 * @returns {Object}
 */
function federationSummary (view) {
  const v = view || {};
  const vaults = vaultRows(v);
  return {
    id: v.id || null,
    shortId: shortId(v.id),
    name: v.name || null,
    title: v.name || shortId(v.id),
    network: v.network || null,
    threshold: thresholdLabel(v),
    signers: signerList(v).length,
    status: v.status || null,
    selfStatus: v.selfStatus || null,
    isPublisher: !!v.isPublisher,
    vaultAddress: v.vaultAddress || null,
    balanceSats: vaults.length ? vaults[0].balanceSats : null,
    openWithdrawals: (Array.isArray(v.withdrawals) ? v.withdrawals : []).filter((w) => w && !w.txid && !CLOSED_WITHDRAWAL.has(String(w.status || ''))).length,
    href: federationHref(v),
    viewer: v.viewer || null
  };
}

module.exports = {
  xOnly,
  sameKey,
  shortId,
  shortKey,
  signerList,
  thresholdLabel,
  isSignerKey,
  federationHref,
  signerRows,
  vaultRows,
  withdrawalRows,
  federationSummary
};
