'use strict';

/**
 * Browser helpers for Hub sidechain / statechain + distributed epoch HTTP surfaces.
 * Uses same-origin `/services/rpc` and `/services/distributed/*` (works for LAN hubs
 * like `http://192.168.50.5:8080` when the UI is loaded from that origin).
 */

/**
 * @param {string} method
 * @param {unknown[]} [params]
 * @returns {Promise<{ ok: boolean, result?: unknown, error?: string }>}
 */
async function hubJsonRpc (method, params = []) {
  try {
    const res = await fetch('/services/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    let body = {};
    try {
      body = await res.json();
    } catch (_) {}
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || res.statusText || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    if (body && body.error) {
      return { ok: false, error: body.error.message || 'RPC error' };
    }
    return { ok: true, result: body && body.result != null ? body.result : null };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * @param {string} path
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
async function fetchDistributedJson (path) {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) {
      return { ok: false, error: (data && data.message) || res.statusText || `HTTP ${res.status}` };
    }
    return { ok: true, data: data && typeof data === 'object' ? data : {} };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
async function fetchDistributedEpoch () {
  return fetchDistributedJson('/services/distributed/epoch');
}

/**
 * @returns {Promise<{ ok: boolean, data?: object, error?: string }>}
 */
async function fetchDistributedManifest () {
  return fetchDistributedJson('/services/distributed/manifest');
}

/**
 * @returns {Promise<{ ok: boolean, state?: object, error?: string }>}
 */
async function getSidechainState () {
  const out = await hubJsonRpc('GetSidechainState', []);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') {
    return { ok: false, error: r.message || 'GetSidechainState failed' };
  }
  return { ok: true, state: r };
}

/**
 * @param {{ limit?: number, includePatches?: boolean }} [opts]
 */
async function getSidechainJournal (opts = {}) {
  const out = await hubJsonRpc('GetSidechainJournal', [opts]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') {
    return { ok: false, error: r.message || 'GetSidechainJournal failed' };
  }
  return { ok: true, journal: r };
}

/**
 * @param {{ limit?: number, includeContent?: boolean }} [opts]
 */
async function getSidechainSnapshots (opts = {}) {
  const out = await hubJsonRpc('GetSidechainSnapshots', [opts]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') {
    return { ok: false, error: r.message || 'GetSidechainSnapshots failed' };
  }
  return { ok: true, snapshots: r };
}

/**
 * Submit an RFC6902 patch sequence to Hub sidechain STATE.
 * Multi-op arrays are first-class on the Hub RPC path. When encoding the same
 * proposal as a typed `SIDECHAIN_STATE_PATCH` Message (P2P / activity), use
 * `@fabric/http/functions/messageBodyJsonBridge` so `patchesCanonical` preserves
 * the full sequence (not only a collapsed `/registry` catalog write).
 *
 * @param {{ patches: object[], basisClock: number, adminToken?: string|null, federationWitness?: object|null }} p
 */
async function submitSidechainStatePatch (p) {
  const out = await hubJsonRpc('SubmitSidechainStatePatch', [p]);
  if (!out.ok) return { ok: false, error: out.error };
  const r = out.result;
  if (r && r.status === 'error') {
    return { ok: false, error: r.message || 'patch rejected' };
  }
  return { ok: true, result: r };
}

module.exports = {
  hubJsonRpc,
  fetchDistributedJson,
  fetchDistributedEpoch,
  fetchDistributedManifest,
  getSidechainState,
  getSidechainJournal,
  getSidechainSnapshots,
  submitSidechainStatePatch
};
