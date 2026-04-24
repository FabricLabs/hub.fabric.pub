'use strict';

/**
 * POST JSON-RPC 2.0 to same-origin `/services/rpc` (browser / Electron shell).
 * @param {string} method
 * @param {unknown[]} [params]
 * @returns {Promise<unknown>}
 */
async function hubJsonRpc (method, params = []) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const res = await fetch(`${origin}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    throw new Error('Hub returned non-JSON');
  }
  if (!res.ok || body.error) {
    throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
  }
  return body.result;
}

module.exports = { hubJsonRpc };
