'use strict';

const { applyPatch } = require('fast-json-patch');

function cloneJSON (value) {
  return JSON.parse(JSON.stringify(value));
}

function splitPointer (path) {
  if (path == null || path === '' || path === '/') return [];
  const s = String(path);
  const raw = s.startsWith('/') ? s.slice(1) : s;
  if (!raw) return [];
  return raw.split('/').map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAtPointer (doc, path) {
  const segs = splitPointer(path);
  let cur = doc;
  for (const seg of segs) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function normalizePatchOps (input, currentState) {
  const ops = Array.isArray(input) ? input : [input];
  const normalized = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const kind = String(op.op || '').trim().toLowerCase();
    const path = String(op.path || '').trim() || '/';
    if (kind === 'add' || kind === 'replace' || kind === 'remove') {
      normalized.push({ op: kind, path, value: op.value });
      continue;
    }
    if (kind === 'set' || kind === 'put') {
      const existing = getAtPointer(currentState, path);
      normalized.push({ op: (typeof existing === 'undefined') ? 'add' : 'replace', path, value: op.value });
      continue;
    }
    if (kind === 'delete' || kind === 'unset') {
      normalized.push({ op: 'remove', path });
      continue;
    }
    if (kind === 'merge') {
      const existing = getAtPointer(currentState, path);
      const a = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
      const b = (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) ? op.value : {};
      normalized.push({ op: 'replace', path, value: { ...a, ...b } });
      continue;
    }
    if (!kind && Object.prototype.hasOwnProperty.call(op, 'value')) {
      const existing = getAtPointer(currentState, path);
      normalized.push({ op: (typeof existing === 'undefined') ? 'add' : 'replace', path, value: op.value });
    }
  }
  return normalized;
}

function createFabricBrowserStore (opts = {}) {
  const storageKey = String(opts.storageKey || 'fabric:state');
  const initialState = (opts.initialState && typeof opts.initialState === 'object') ? cloneJSON(opts.initialState) : {};
  let state = initialState;

  function hasStorage () {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch (e) {
      return false;
    }
  }

  function save () {
    if (!hasStorage()) return false;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load () {
    if (!hasStorage()) return false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      state = parsed;
      return true;
    } catch (e) {
      return false;
    }
  }

  load();

  function GET (path = '/') {
    if (path === '/' || path == null || path === '') return state;
    return getAtPointer(state, path);
  }

  function PUT (path = '/', value, options = {}) {
    if (path === '/' || path == null || path === '') {
      state = (value && typeof value === 'object') ? cloneJSON(value) : {};
      if (options.persist !== false) save();
      return state;
    }
    const ops = normalizePatchOps([{ op: 'put', path, value }], state);
    const result = applyPatch(state, ops, true, false);
    state = result.newDocument;
    if (options.persist !== false) save();
    return state;
  }

  function PATCH (ops, options = {}) {
    const normalized = normalizePatchOps(ops, state);
    if (!normalized.length) return state;
    const result = applyPatch(state, normalized, true, false);
    state = result.newDocument;
    if (options.persist !== false) save();
    return state;
  }

  function DELETE (path = '/', options = {}) {
    if (path === '/' || path == null || path === '') {
      state = {};
      if (options.persist !== false) save();
      return state;
    }
    const ops = normalizePatchOps([{ op: 'delete', path }], state);
    if (!ops.length) return state;
    const result = applyPatch(state, ops, true, false);
    state = result.newDocument;
    if (options.persist !== false) save();
    return state;
  }

  return {
    GET,
    PUT,
    PATCH,
    DELETE,
    getState: () => state,
    save,
    load
  };
}

module.exports = {
  createFabricBrowserStore,
  normalizePatchOps
};

