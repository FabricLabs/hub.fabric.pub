'use strict';

/**
 * When the WebSocket is slow, pull {@link GetNetworkStatus} over same-origin HTTP JSON-RPC
 * and merge into Bridge state (dispatches `networkStatusUpdate` like the WS path).
 *
 * @param {{ applyHubNetworkStatusPayload?: (result: object) => boolean }} bridgeInstance
 * @param {string} origin - e.g. `window.location.origin`
 * @returns {Promise<boolean>} whether payload was applied
 */
async function hydrateHubNetworkStatusViaHttp (bridgeInstance, origin) {
  if (!bridgeInstance || typeof bridgeInstance.applyHubNetworkStatusPayload !== 'function') return false;
  const root = String(origin || '').trim().replace(/\/+$/, '');
  if (!root) return false;
  let res;
  try {
    res = await fetch(`${root}/services/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetNetworkStatus', params: [] })
    });
  } catch (_) {
    return false;
  }
  const body = await res.json().catch(() => null);
  if (!body || body.result == null) return false;
  return !!bridgeInstance.applyHubNetworkStatusPayload(body.result);
}

module.exports = { hydrateHubNetworkStatusViaHttp };
