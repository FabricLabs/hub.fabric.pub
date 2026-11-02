'use strict';

const t = require('../locales/en');

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
 * WebSocket phase while {@link GetNetworkStatus} has not arrived yet.
 * @param {object|null|undefined} bridgeInstance Bridge component instance (`bridgeRef.current`)
 * @returns {'connected'|'opening'|'reconnecting'|null}
 */
function bridgeConnectionPhase (bridgeInstance) {
  if (!bridgeInstance || typeof bridgeInstance.getConnectionStatus !== 'function') return null;
  try {
    const cs = bridgeInstance.getConnectionStatus();
    const ws = cs && cs.websocket;
    if (!ws) return null;
    if (ws.connected && ws.readyState === 1) return 'connected';
    if (ws.readyState === 0) return 'opening';
    return 'reconnecting';
  } catch (_) {
    return null;
  }
}

/**
 * When {@link GetNetworkStatus} has not arrived yet, explain whether the WebSocket is open
 * (avoids implying the hub is down when the socket is up but RPC is slow).
 * @param {object|null|undefined} bridgeInstance Bridge component instance (`bridgeRef.current`)
 * @returns {string|null} User-facing line, or null to use a generic default
 */
function bridgeWebSocketLoadingHint (bridgeInstance) {
  const phase = bridgeConnectionPhase(bridgeInstance);
  return phase ? t.shell.connection[phase] : null;
}

/** Status fields dropped, in order, when the whole status won't fit one Fabric frame. */
const NETWORK_STATUS_HEAVY_FIELDS = Object.freeze([
  'fabricMessages',
  'messages',
  'state',
  'documents',
  'publishedDocuments',
  'webrtcPeers'
]);

/** Status fields never dropped: who the Hub is and whether it is set up. */
const NETWORK_STATUS_KEPT_FIELDS = Object.freeze([
  'clock',
  'contract',
  'fabricPeerId',
  'fabricIdentityId',
  'setup',
  'network',
  'pubkey',
  'truncated',
  'peersTotal'
]);

/**
 * Fit a {@link GetNetworkStatus} payload into `maxBytes` of JSON by dropping
 * {@link NETWORK_STATUS_HEAVY_FIELDS} in order. Dropped names are listed in
 * `truncated`, so clients keep their last copy of those fields
 * ({@link mergeTruncatedNetworkStatus}) and fetch them with their own calls.
 * Still too large, it keeps the first `peers` (with `peersTotal`), then drops
 * the largest remaining fields outside {@link NETWORK_STATUS_KEPT_FIELDS}.
 * @param {object} status
 * @param {number} maxBytes JSON byte budget (frame body minus the JSONCall envelope)
 * @returns {object} `status` itself when it fits, else a trimmed copy
 */
function fitHubNetworkStatus (status, maxBytes) {
  const size = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (!status || typeof status !== 'object' || size(status) <= maxBytes) return status;
  const out = Object.assign({}, status);
  const truncated = [];
  const drop = (field) => {
    delete out[field];
    truncated.push(field);
    out.truncated = truncated.slice();
  };
  for (const field of NETWORK_STATUS_HEAVY_FIELDS) {
    if (!(field in out)) continue;
    drop(field);
    if (size(out) <= maxBytes) return out;
  }
  if (Array.isArray(status.peers) && status.peers.length) {
    out.peersTotal = status.peers.length;
    let keep = status.peers.length;
    while (keep > 0 && size(out) > maxBytes) {
      keep = Math.floor(keep / 2);
      out.peers = status.peers.slice(0, keep);
    }
    if (size(out) <= maxBytes) return out;
  }
  const rest = Object.keys(out)
    .filter((field) => !NETWORK_STATUS_KEPT_FIELDS.includes(field))
    .map((field) => ({ field, bytes: out[field] === undefined ? 0 : size(out[field]) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const { field } of rest) {
    drop(field);
    if (size(out) <= maxBytes) return out;
  }
  return out;
}

/**
 * Keep `previous` values for the fields a trimmed status left out.
 * @param {object} next status from the Hub (may carry `truncated`)
 * @param {object|null} previous last applied status
 * @returns {object}
 */
function mergeTruncatedNetworkStatus (next, previous) {
  if (!next || !Array.isArray(next.truncated) || !previous || typeof previous !== 'object') return next;
  const merged = Object.assign({}, next);
  for (const field of next.truncated) {
    if (field in previous) merged[field] = previous[field];
  }
  return merged;
}

module.exports = {
  NETWORK_STATUS_HEAVY_FIELDS,
  isHubNetworkStatusShape,
  bridgeConnectionPhase,
  bridgeWebSocketLoadingHint,
  fitHubNetworkStatus,
  mergeTruncatedNetworkStatus
};
