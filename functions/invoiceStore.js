'use strict';

const Actor = require('@fabric/core/types/actor');
const { createFabricBrowserStore } = require('./fabricBrowserStore');

const INVOICES_KEY = 'fabric.bitcoin.invoices';
const FABRIC_STATE_KEY = 'fabric:state';

function getStore () {
  return createFabricBrowserStore({
    storageKey: FABRIC_STATE_KEY,
    initialState: { invoices: [] }
  });
}

/**
 * Load all invoices from localStorage. Not in global state.
 * @returns {Array<{id:string,address:string,amountSats:number,memo?:string,label?:string,createdAt:string,network?:string}>}
 */
function loadInvoices () {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const store = getStore();
    const unified = store.GET('/invoices');
    if (Array.isArray(unified)) {
      return unified.map((inv) => ({
        ...inv,
        txids: Array.isArray(inv.txids) ? inv.txids : []
      }));
    }
    const raw = window.localStorage.getItem(INVOICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map((inv) => ({
      ...inv,
      txids: Array.isArray(inv.txids) ? inv.txids : []
    }));
    store.PUT('/invoices', migrated);
    return migrated;
  } catch (e) {
    return [];
  }
}

/**
 * Save invoices to localStorage.
 * @param {Array} invoices
 */
function saveInvoices (invoices = []) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const normalized = Array.isArray(invoices) ? invoices : [];
      getStore().PUT('/invoices', normalized);
      // Keep legacy key for compatibility with older builds.
      window.localStorage.setItem(INVOICES_KEY, JSON.stringify(normalized));
    }
  } catch (e) {}
}

/**
 * Create a new invoice and store it locally.
 * @param {{address:string,amountSats:number,memo?:string,label?:string,network?:string}} invoice
 * @returns {{id:string,...}} The stored invoice with id
 */
function createInvoice (invoice = {}) {
  const address = String(invoice.address || '').trim();
  const amountSats = Number(invoice.amountSats || 0);
  if (!address || !Number.isFinite(amountSats) || amountSats <= 0) return null;

  const id = `inv_${new Actor({
    type: 'HubEphemeralId',
    purpose: 'fabric.bitcoin.invoice',
    nonce: Actor.randomBytes(8).toString('hex'),
    at: new Date().toISOString()
  }).id}`;
  const entry = {
    id,
    address,
    amountSats,
    memo: String(invoice.memo || '').trim(),
    label: String(invoice.label || '').trim(),
    createdAt: new Date().toISOString(),
    network: String(invoice.network || 'regtest').toLowerCase(),
    txids: []
  };

  const list = loadInvoices();
  list.unshift(entry);
  saveInvoices(list);
  return entry;
}

/**
 * Delete an invoice by id.
 * @param {string} id
 * @returns {boolean} true if removed
 */
function deleteInvoice (id) {
  const before = loadInvoices();
  const list = before.filter((inv) => inv.id !== id);
  if (list.length === before.length) return false;
  saveInvoices(list);
  return true;
}

/**
 * Get a single invoice by id.
 * @param {string} id
 * @returns {Object|null}
 */
function getInvoice (id) {
  return loadInvoices().find((inv) => inv.id === id) || null;
}

/**
 * Record a payment (txid) on an invoice. Appends to txids array.
 * @param {string} id - Invoice id
 * @param {string} txid - Transaction ID of the payment
 * @returns {boolean} true if updated
 */
function addPaymentToInvoice (id, txid) {
  const txidStr = String(txid || '').trim();
  if (!txidStr) return false;
  const list = loadInvoices();
  const inv = list.find((i) => i.id === id);
  if (!inv) return false;
  const txids = Array.isArray(inv.txids) ? [...inv.txids] : [];
  if (txids.includes(txidStr)) return true; // already recorded
  txids.push(txidStr);
  inv.txids = txids;
  saveInvoices(list);
  return true;
}

module.exports = {
  loadInvoices,
  saveInvoices,
  createInvoice,
  deleteInvoice,
  getInvoice,
  addPaymentToInvoice
};
