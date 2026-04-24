'use strict';

/**
 * True when `obj` looks like a {@link GetNetworkStatus} payload from the Hub
 * (as stored on Bridge `networkStatus` / `lastNetworkStatus`).
 */
function isHubNetworkStatusShape (obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.network && typeof obj.network === 'object') return true;
  if (Array.isArray(obj.peers)) return true;
  if (typeof obj.fabricPeerId === 'string' && obj.fabricPeerId.trim()) return true;
  if (obj.bitcoin && typeof obj.bitcoin === 'object') return true;
  if (obj.setup && typeof obj.setup === 'object' && ('configured' in obj.setup || 'needsSetup' in obj.setup)) {
    return true;
  }
  if (obj.publishedDocuments && typeof obj.publishedDocuments === 'object') return true;
  if (obj.state && typeof obj.state === 'object' && (obj.state.status != null || obj.state.services)) {
    return true;
  }
  return false;
}

/**
 * When {@link GetNetworkStatus} has not arrived yet, explain whether the WebSocket is open
 * (avoids implying the hub is down when the socket is up but RPC is slow).
 * @param {object|null|undefined} bridgeInstance Bridge component instance (`bridgeRef.current`)
 * @returns {string|null} User-facing line, or null to use a generic default
 */
function bridgeWebSocketLoadingHint (bridgeInstance) {
  if (!bridgeInstance || typeof bridgeInstance.getConnectionStatus !== 'function') return null;
  try {
    const cs = bridgeInstance.getConnectionStatus();
    const ws = cs && cs.websocket;
    if (!ws) return null;
    if (ws.connected && ws.readyState === 1) {
      return 'WebSocket connected — waiting for network status from the hub.';
    }
    if (ws.readyState === 0) {
      return 'Opening WebSocket to the hub…';
    }
    return 'Reconnecting to the hub…';
  } catch (_) {
    return null;
  }
}

module.exports = { isHubNetworkStatusShape, bridgeWebSocketLoadingHint };
