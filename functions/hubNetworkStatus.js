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

module.exports = { isHubNetworkStatusShape };
