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
  'webrtcPeers',
  'chain'
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
 * Still too large, it keeps the first `peers`, fresh, with `peersTotal` and
 * `peersPartial: true` (not in `truncated`: an old full list would hide every
 * change), then drops the largest remaining fields outside
 * {@link NETWORK_STATUS_KEPT_FIELDS}, giving the room each frees back to `peers`.
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
  const peers = Array.isArray(status.peers) ? status.peers : [];
  // The longest prefix of `peers` that fits beside everything else in `out`.
  // A partial list is still current, so clients take it as is; `peersPartial` says it is partial.
  const fitPeers = () => {
    if (!peers.length) return;
    out.peersTotal = peers.length;
    out.peers = peers;
    delete out.peersPartial;
    if (size(out) <= maxBytes) return;
    out.peersPartial = true;
    let lo = 0;
    let hi = peers.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      out.peers = peers.slice(0, mid);
      if (size(out) <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    out.peers = peers.slice(0, lo);
  };
  fitPeers();
  if (size(out) <= maxBytes) return out;
  const rest = Object.keys(out)
    .filter((field) => !NETWORK_STATUS_KEPT_FIELDS.includes(field) && field !== 'peers' && field !== 'peersPartial')
    .map((field) => ({ field, bytes: out[field] === undefined ? 0 : size(out[field]) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const { field } of rest) {
    drop(field);
    // Room a dropped field frees goes back to the peer list first.
    fitPeers();
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

/** WebRTC registry metadata the public network status keeps (the UI and mesh read only these). */
const PUBLIC_WEBRTC_METADATA_FIELDS = Object.freeze(['fabricPeerId', 'capabilities', 'transport', 'webrtcSignalingId', 'meshSessionCount']);

/** @private */
function publicWebRtcMetadata (meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const k of PUBLIC_WEBRTC_METADATA_FIELDS) if (meta[k] !== undefined) out[k] = meta[k];
  return out;
}

/**
 * The {@link GetNetworkStatus} view for anyone but the operator (and for the
 * status pushed to every WebSocket client): browser-reported WebRTC metadata
 * (user agent, refund pubkey, …) is cut to {@link PUBLIC_WEBRTC_METADATA_FIELDS}.
 * Fabric TCP peer addresses stay: peering offers already gossip them.
 * @param {object} status
 * @returns {object}
 */
function redactNetworkStatusForPublic (status) {
  if (!status || typeof status !== 'object') return status;
  const out = Object.assign({}, status);
  if (Array.isArray(status.peers)) {
    out.peers = status.peers.map((p) => (p && p.metadata ? Object.assign({}, p, { metadata: publicWebRtcMetadata(p.metadata) }) : p));
  }
  if (Array.isArray(status.webrtcPeers)) {
    out.webrtcPeers = status.webrtcPeers.map((w) => (w && w.metadata ? Object.assign({}, w, { metadata: publicWebRtcMetadata(w.metadata) }) : w));
  }
  return out;
}

module.exports = {
  PUBLIC_WEBRTC_METADATA_FIELDS,
  redactNetworkStatusForPublic,
  NETWORK_STATUS_HEAVY_FIELDS,
  isHubNetworkStatusShape,
  bridgeConnectionPhase,
  bridgeWebSocketLoadingHint,
  fitHubNetworkStatus,
  mergeTruncatedNetworkStatus
};
