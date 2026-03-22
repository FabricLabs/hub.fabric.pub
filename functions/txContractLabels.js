'use strict';

/**
 * Human-readable names for Fabric L1 / contract flows (wallet transaction labels).
 * Keys are stable machine ids; UI uses {@link summarizeContractTypes}.
 */
const CONTRACT_TYPE_DISPLAY = {
  storage_contract: 'Storage contract',
  document_purchase: 'Document purchase',
  inventory_htlc: 'Inventory HTLC',
  inventory_htlc_claim: 'HTLC seller claim',
  payjoin: 'Payjoin',
  payjoin_deposit: 'Payjoin deposit',
  bridge_payment: 'Hub wallet payment',
  faucet_payment: 'Faucet (regtest)',
  contract_proposal: 'Contract proposal',
  fabric_invoice: 'Invoice (local)',
  distribute_invoice: 'Distribute invoice'
};

function summarizeContractTypes (types) {
  if (!Array.isArray(types) || types.length === 0) return '';
  return types.map((t) => CONTRACT_TYPE_DISPLAY[t] || t).join(' · ');
}

function attachFabricContractField (tx, entry) {
  if (!entry || !Array.isArray(entry.types) || entry.types.length === 0) return tx;
  const types = [...new Set(entry.types)];
  return {
    ...tx,
    fabricContract: {
      types,
      label: summarizeContractTypes(types),
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {}
    }
  };
}

/**
 * @param {Array<object>} transactions - items with `txid`
 * @param {Object<string, { types: string[], meta?: object }>} labelMap - lower-case txid keys
 */
function mergeLabelsOntoTransactions (transactions, labelMap) {
  if (!Array.isArray(transactions)) return [];
  const map = labelMap || {};
  return transactions.map((tx) => {
    const id = tx && tx.txid ? String(tx.txid).trim().toLowerCase() : '';
    if (!id || !map[id]) return tx;
    return attachFabricContractField(tx, map[id]);
  });
}

/**
 * Client-only: map txids from locally stored invoices (see `invoiceStore.js`).
 * @param {Array<{ id?: string, txids?: string[], memo?: string }>} invoices
 * @returns {Object<string, { types: string[], meta: object }>}
 */
function buildInvoiceTxLabels (invoices) {
  const out = {};
  if (!Array.isArray(invoices)) return out;
  for (const inv of invoices) {
    if (!inv || !Array.isArray(inv.txids)) continue;
    for (const tid of inv.txids) {
      const t = String(tid || '').trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(t)) continue;
      if (!out[t]) out[t] = { types: [], meta: {} };
      if (!out[t].types.includes('fabric_invoice')) out[t].types.push('fabric_invoice');
      if (inv.id) out[t].meta.invoiceId = inv.id;
      if (inv.memo) out[t].meta.memo = String(inv.memo);
    }
  }
  return out;
}

/**
 * Merge two label maps (e.g. server `fabricContract` map + local invoices).
 * @param {Object} a
 * @param {Object} b
 */
function mergeLabelMaps (a, b) {
  const out = {};
  const add = (src) => {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src)) {
      const key = String(k).trim().toLowerCase();
      if (!out[key]) out[key] = { types: [], meta: {} };
      if (v && Array.isArray(v.types)) {
        for (const t of v.types) {
          if (!out[key].types.includes(t)) out[key].types.push(t);
        }
      }
      if (v && v.meta && typeof v.meta === 'object') Object.assign(out[key].meta, v.meta);
    }
  };
  add(a);
  add(b);
  return out;
}

/**
 * Combine server-annotated transactions with an extra label map (e.g. invoices).
 * @param {Array<object>} transactions - may already include `fabricContract`
 * @param {Object} extraByTxid - from {@link buildInvoiceTxLabels}
 */
function mergeServerAndLocalLabels (transactions, extraByTxid) {
  if (!Array.isArray(transactions)) return [];
  const extra = extraByTxid || {};
  return transactions.map((tx) => {
    const id = tx && tx.txid ? String(tx.txid).trim().toLowerCase() : '';
    if (!id) return tx;
    const loc = extra[id];
    const srv = tx.fabricContract;
    if (!loc && !srv) return tx;
    const types = [
      ...new Set([
        ...((srv && srv.types) || []),
        ...((loc && loc.types) || [])
      ])
    ];
    const meta = {
      ...((srv && srv.meta) || {}),
      ...((loc && loc.meta) || {})
    };
    return {
      ...tx,
      fabricContract: {
        types,
        label: summarizeContractTypes(types),
        meta
      }
    };
  });
}

module.exports = {
  CONTRACT_TYPE_DISPLAY,
  summarizeContractTypes,
  attachFabricContractField,
  mergeLabelsOntoTransactions,
  buildInvoiceTxLabels,
  mergeLabelMaps,
  mergeServerAndLocalLabels
};
