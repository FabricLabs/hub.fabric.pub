'use strict';

const { isLikelyBip32ExtendedKey } = require('./isLikelyBip32ExtendedKey');

function normalizeFabricPeerAddress (a) {
  const s = String(a || '').trim();
  if (!s) return '';
  return s.includes(':') ? s : `${s}:7777`;
}

/**
 * Normalize user-entered Fabric TCP peer addresses: trim, strip http(s)/ws(s)/fabric:// prefixes,
 * drop path/query fragments (paste from browser), then apply {@link normalizeFabricPeerAddress}.
 * Hub validates with `^[^:]+:\d+$` (host must not contain unbracketed colons except the port separator).
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizePeerAddressInput (raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^fabric:\/\//i, '')
    .replace(/^tcp:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash !== -1) s = s.slice(0, slash);
  const q = s.indexOf('?');
  if (q !== -1) s = s.slice(0, q);
  const h = s.indexOf('#');
  if (h !== -1) s = s.slice(0, h);
  s = s.trim();
  if (!s) return '';
  return normalizeFabricPeerAddress(s);
}

/**
 * @param {object|null|undefined} p
 * @returns {string}
 */
function extractPeerXpub (p) {
  if (!p || typeof p !== 'object') return '';
  const m = p.metadata && typeof p.metadata === 'object' ? p.metadata : {};
  const cands = [m.xpub, p.xpub];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c && isLikelyBip32ExtendedKey(String(c))) return String(c).trim();
  }
  return '';
}

/**
 * @param {string} s
 * @param {number} [head]
 * @param {number} [tail]
 * @returns {string}
 */
function shortenPublicId (s, head = 10, tail = 8) {
  const str = String(s || '').trim();
  if (!str) return '';
  if (str.length <= head + tail + 1) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function sameLogicalFabricPeer (a, b) {
  if (!a || !b) return false;
  const aid = String(a.id || '').trim();
  const bid = String(b.id || '').trim();
  const aad = String(a.address || '').trim();
  const bad = String(b.address || '').trim();
  if (aid && bid && aid === bid) return true;
  const an = aad ? normalizeFabricPeerAddress(aad) : '';
  const bn = bad ? normalizeFabricPeerAddress(bad) : '';
  if (an && bn && an === bn) return true;
  if (aid && (aid === bad || aid === bn)) return true;
  if (bid && (bid === aad || bid === an)) return true;
  const xa = extractPeerXpub(a);
  const xb = extractPeerXpub(b);
  if (xa && xb && xa === xb) return true;
  const ma = a && a.metadata && a.metadata.fabricPeerId != null ? String(a.metadata.fabricPeerId).trim() : '';
  const mb = b && b.metadata && b.metadata.fabricPeerId != null ? String(b.metadata.fabricPeerId).trim() : '';
  if (ma && mb && ma === mb) return true;
  return false;
}

function mergeFabricPeerRows (a, b) {
  const connected = (a && a.status) === 'connected' || (b && b.status) === 'connected';
  const status = connected ? 'connected' : ((a && a.status) || (b && b.status) || 'unknown');
  const sa = Number(a && a.score);
  const sb = Number(b && b.score);
  const score = (Number.isFinite(sa) && Number.isFinite(sb))
    ? Math.max(sa, sb)
    : (Number.isFinite(sa) ? sa : (Number.isFinite(sb) ? sb : (a && a.score != null ? a.score : b && b.score)));
  const ma = Number(a && a.misbehavior);
  const mb = Number(b && b.misbehavior);
  const misbehavior = (Number.isFinite(ma) || Number.isFinite(mb))
    ? Math.max(Number.isFinite(ma) ? ma : 0, Number.isFinite(mb) ? mb : 0)
    : (a && a.misbehavior != null ? a.misbehavior : b && b.misbehavior);
  const na = a && a.nickname && String(a.nickname).trim();
  const nb = b && b.nickname && String(b.nickname).trim();
  const nickname = na || nb || null;
  const id = (a && a.id) || (b && b.id);
  const address = (a && a.address) || (b && b.address);
  const metaA = a && a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const metaB = b && b.metadata && typeof b.metadata === 'object' ? b.metadata : {};
  const metadata = { ...metaB, ...metaA };
  return {
    ...b,
    ...a,
    id: id || a.id || b.id,
    address: address || a.address || b.address,
    status,
    score,
    misbehavior,
    nickname: nickname || a.nickname || b.nickname,
    metadata
  };
}

/**
 * Collapse duplicate Fabric TCP peer snapshots (same id, same host:port, or same xpub).
 * @param {object[]} peers
 * @returns {object[]}
 */
function dedupeFabricPeers (peers) {
  const arr = Array.isArray(peers) ? peers.filter((p) => p && typeof p === 'object') : [];
  const out = [];
  const consumed = new Set();
  for (let i = 0; i < arr.length; i++) {
    if (consumed.has(i)) continue;
    let merged = { ...arr[i] };
    for (let j = i + 1; j < arr.length; j++) {
      if (consumed.has(j)) continue;
      if (sameLogicalFabricPeer(merged, arr[j])) {
        merged = mergeFabricPeerRows(merged, arr[j]);
        consumed.add(j);
      }
    }
    out.push(merged);
    consumed.add(i);
  }
  return out;
}

const FABRIC_IDENTITY_HRP_PREFIX = 'id1';

/**
 * @param {string} s
 * @returns {boolean}
 */
function isLikelyFabricBech32Id (s) {
  const t = String(s || '').trim();
  if (!t.startsWith(FABRIC_IDENTITY_HRP_PREFIX)) return false;
  if (t.length < 16) return false;
  return /^id1[02-9ac-hj-np-z]+$/.test(t);
}

/**
 * Canonical Fabric P2P identity string (bech32m, {@link Identity#toString} / hub <code>fabricPeerId</code>) when present.
 * @param {object|null|undefined} peer
 * @returns {string}
 */
function fabricPeerBech32Id (peer) {
  if (!peer || typeof peer !== 'object') return '';
  const m = peer.metadata && typeof peer.metadata === 'object' ? peer.metadata : {};
  const fromMeta = m.fabricPeerId != null ? String(m.fabricPeerId).trim() : '';
  if (fromMeta && isLikelyFabricBech32Id(fromMeta)) return fromMeta;
  const fromId = peer.id != null ? String(peer.id).trim() : '';
  if (fromId && isLikelyFabricBech32Id(fromId)) return fromId;
  if (fromMeta) return fromMeta;
  return fromId || '';
}

/**
 * @param {object} peer - Fabric P2P row from GetNetworkStatus
 * @returns {string}
 */
function fabricPeerPrimaryLabel (peer) {
  if (!peer || typeof peer !== 'object') return '';
  const nick = peer.nickname && String(peer.nickname).trim();
  if (nick) return nick;
  const fb = fabricPeerBech32Id(peer);
  if (fb && isLikelyFabricBech32Id(fb)) return shortenPublicId(fb, 14, 12);
  const x = extractPeerXpub(peer);
  if (x) return shortenPublicId(x, 12, 10);
  if (peer.alias && String(peer.alias).trim()) return String(peer.alias).trim();
  if (fb) return shortenPublicId(fb, 14, 12);
  const id = peer.id && String(peer.id).trim();
  if (id) return shortenPublicId(id, 12, 10);
  const addr = peer.address && String(peer.address).trim();
  return addr ? shortenPublicId(addr, 14, 8) : 'peer';
}

/**
 * Merge hub signaling WebRTC entries with local mesh rows by peer id (one row per id).
 * @param {object[]} signaling
 * @param {object[]} local
 * @param {string|null} selfPeerId
 * @returns {{ id: string, signaling: object|null, local: object|null }[]}
 */
function buildWebrtcCombinedRows (signaling, local, selfPeerId) {
  const self = selfPeerId != null ? String(selfPeerId) : '';
  const byId = new Map();
  const sig = Array.isArray(signaling) ? signaling : [];
  const loc = Array.isArray(local) ? local : [];
  for (let i = 0; i < sig.length; i++) {
    const p = sig[i];
    const id = p && p.id != null ? String(p.id) : '';
    if (!id || (self && id === self)) continue;
    byId.set(id, { id, signaling: p, local: null });
  }
  for (let j = 0; j < loc.length; j++) {
    const p = loc[j];
    const id = p && p.id != null ? String(p.id) : '';
    if (!id) continue;
    const prev = byId.get(id) || { id, signaling: null, local: null };
    prev.local = p;
    byId.set(id, prev);
  }
  const rows = Array.from(byId.values());
  rows.sort((a, b) => {
    const la = a.local && a.local.status === 'connected' ? 1 : 0;
    const lb = b.local && b.local.status === 'connected' ? 1 : 0;
    if (la !== lb) return lb - la;
    const sa = a.signaling ? 1 : 0;
    const sb = b.signaling ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

/**
 * @param {object|null} signaling
 * @param {object|null} local
 * @returns {string}
 */
function webrtcRowPrimaryLabel (signaling, local) {
  const meta = signaling && signaling.metadata && typeof signaling.metadata === 'object'
    ? signaling.metadata
    : {};
  const x = meta.xpub && isLikelyBip32ExtendedKey(meta.xpub) ? String(meta.xpub).trim() : '';
  if (x) return shortenPublicId(x, 12, 10);
  const fp = meta.fabricPeerId && String(meta.fabricPeerId).trim();
  if (fp) return shortenPublicId(fp, 12, 10);
  const id = (signaling && signaling.id) || (local && local.id) || '';
  return id ? shortenPublicId(String(id), 14, 10) : 'peer';
}

const WEBRTC_TRANSPORT = 'webrtc';

/**
 * Map a combined WebRTC row into the same peer row shape the Peers page uses for TCP Fabric peers,
 * so browser mesh links appear in one list with score / status / disconnect.
 * @param {{ id: string, signaling: object|null, local: object|null }} row
 * @param {{ score?: number, misbehavior?: number }|null|undefined} rep
 * @returns {object}
 */
function webrtcCombinedRowToFabricPeerShape (row, rep) {
  const peerId = row && row.id != null ? String(row.id) : '';
  const sig = row && row.signaling;
  const loc = row && row.local;
  const meta = sig && sig.metadata && typeof sig.metadata === 'object' ? { ...sig.metadata } : {};
  meta.transport = WEBRTC_TRANSPORT;
  meta.webrtcSignalingId = peerId;
  const meshConnected = loc && loc.status === 'connected';
  const status = meshConnected ? 'connected' : (loc && loc.status) || (sig ? 'signaling' : 'unknown');
  const rs = rep && rep.score != null ? Number(rep.score) : NaN;
  const rm = rep && rep.misbehavior != null ? Number(rep.misbehavior) : NaN;
  return {
    id: peerId,
    address: `webrtc:${peerId}`,
    status,
    score: Number.isFinite(rs) ? rs : 100,
    misbehavior: Number.isFinite(rm) ? rm : 0,
    nickname: null,
    metadata: meta,
    lastSeen: (loc && loc.lastSeen) || (sig && (sig.lastSeen || sig.registeredAt || sig.connectedAt)) || null
  };
}

/**
 * @param {object[]} combined - {@link buildWebrtcCombinedRows}
 * @param {(peerId: string) => { score?: number, misbehavior?: number }|null|undefined} repLookup
 * @returns {object[]}
 */
function webrtcCombinedToFabricPeerRows (combined, repLookup) {
  const rows = Array.isArray(combined) ? combined : [];
  const fn = typeof repLookup === 'function' ? repLookup : () => null;
  return rows.map((r) => webrtcCombinedRowToFabricPeerShape(r, fn(r && r.id != null ? String(r.id) : '')));
}

/**
 * Sort TCP Fabric peers (primary first) then merge with WebRTC mesh rows by score / connection.
 * @param {object[]} tcpPeersSorted - already deduped + authority-sorted TCP rows
 * @param {object[]} webrtcAsFabric - {@link webrtcCombinedToFabricPeerRows}
 * @param {string} primaryNorm - normalized primary TCP address (optional)
 * @returns {object[]}
 */
function mergeTcpAndWebrtcPeerRows (tcpPeersSorted, webrtcAsFabric, primaryNorm) {
  const tcp = Array.isArray(tcpPeersSorted) ? tcpPeersSorted : [];
  const w = Array.isArray(webrtcAsFabric) ? webrtcAsFabric : [];
  const pn = String(primaryNorm || '').trim();
  const isMesh = (p) => !!(p && p.metadata && p.metadata.transport === WEBRTC_TRANSPORT);
  const scoreOf = (p) => {
    const s = Number(p && p.score);
    return Number.isFinite(s) ? s : 0;
  };
  const connectedRank = (p) => ((p && p.status) === 'connected' ? 1 : 0);
  const isPrimaryTcp = (p) => {
    if (!p || isMesh(p) || !pn) return false;
    const addr = normalizeFabricPeerAddress(p.address);
    return addr === pn || String(p.address || '') === pn;
  };
  const all = [...tcp, ...w];
  all.sort((a, b) => {
    const ap = isPrimaryTcp(a);
    const bp = isPrimaryTcp(b);
    if (ap !== bp) return ap ? -1 : 1;
    const sc = scoreOf(b) - scoreOf(a);
    if (sc !== 0) return sc;
    const cc = connectedRank(b) - connectedRank(a);
    if (cc !== 0) return cc;
    return fabricPeerPrimaryLabel(a).localeCompare(fabricPeerPrimaryLabel(b));
  });
  return all;
}

function isWebrtcTransportPeerRow (peer) {
  return !!(peer && peer.metadata && peer.metadata.transport === WEBRTC_TRANSPORT);
}

/**
 * Prefer a real Fabric TCP <code>host:port</code>; otherwise WebRTC signaling origin (<code>window.location.host</code> shape).
 * @param {object|null|undefined} peer
 * @param {string} [signalingHostPort]
 * @returns {string}
 */
function peerPublicConnectionTargetHostPort (peer, signalingHostPort) {
  const addr = peer && peer.address != null ? String(peer.address).trim() : '';
  if (addr && !addr.toLowerCase().startsWith('webrtc:')) {
    return normalizeFabricPeerAddress(addr);
  }
  const sig = String(signalingHostPort || '').trim();
  if (sig) return sig;
  return '';
}

/**
 * Operator “connection string”: Fabric identity (bech32m when known) @ transport endpoint (TCP host:port or signaling host:port).
 * @param {object|null|undefined} peer
 * @param {string} [signalingHostPort]
 * @returns {string}
 */
function peerConnectionPubkeyAtHostPort (peer, signalingHostPort) {
  const pk = fabricPeerBech32Id(peer);
  const target = peerPublicConnectionTargetHostPort(peer, signalingHostPort);
  if (!pk && !target) return '';
  if (!target) return pk;
  if (!pk) return `@${target}`;
  return `${pk}@${target}`;
}

/**
 * True when this row represents an active Fabric TCP session where the hub learned the peer’s bech32 id from the wire.
 * @param {object|null|undefined} peer
 * @returns {boolean}
 */
function fabricP2PIdentityConfirmed (peer) {
  if (!peer || typeof peer !== 'object') return false;
  if (isWebrtcTransportPeerRow(peer)) return false;
  return peer.status === 'connected' && !!fabricPeerBech32Id(peer);
}

/**
 * Merge rows that share the same {@link fabricPeerBech32Id} (and related keys) so TCP + mesh duplicates show one score/inventory surface.
 * @param {object[]} peers
 * @returns {object[]}
 */
function consolidateUnifiedPeersByFabricId (peers) {
  const arr = Array.isArray(peers) ? peers.filter((p) => p && typeof p === 'object') : [];
  const groups = new Map();
  for (const p of arr) {
    const fid = fabricPeerBech32Id(p);
    let key = fid || '';
    if (!key) {
      if (p.metadata && p.metadata.transport === WEBRTC_TRANSPORT) {
        const sid = p.metadata.webrtcSignalingId != null
          ? String(p.metadata.webrtcSignalingId)
          : String(p.id || '');
        key = sid ? `webrtc:${sid}` : `anon:${String(p.address || p.id || '')}`;
      } else {
        key = String(p.address || p.id || '') || `anon:${arr.indexOf(p)}`;
      }
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [];
  for (const [, rows] of groups) {
    if (!rows.length) continue;
    let merged = rows[0];
    for (let i = 1; i < rows.length; i++) merged = mergeFabricPeerRows(merged, rows[i]);
    const tcpRow = rows.find((r) => {
      const a = r && r.address != null ? String(r.address) : '';
      return a && !a.startsWith('webrtc:');
    });
    if (tcpRow && tcpRow.address) {
      merged = { ...merged, address: tcpRow.address };
      if (merged.metadata && merged.metadata.transport === WEBRTC_TRANSPORT) {
        const md = { ...merged.metadata };
        delete md.transport;
        merged = { ...merged, metadata: md };
      }
    }
    out.push(merged);
  }
  return out;
}

module.exports = {
  normalizeFabricPeerAddress,
  normalizePeerAddressInput,
  extractPeerXpub,
  shortenPublicId,
  isLikelyFabricBech32Id,
  fabricPeerBech32Id,
  peerPublicConnectionTargetHostPort,
  peerConnectionPubkeyAtHostPort,
  fabricP2PIdentityConfirmed,
  consolidateUnifiedPeersByFabricId,
  dedupeFabricPeers,
  fabricPeerPrimaryLabel,
  buildWebrtcCombinedRows,
  webrtcRowPrimaryLabel,
  webrtcCombinedRowToFabricPeerShape,
  webrtcCombinedToFabricPeerRows,
  mergeTcpAndWebrtcPeerRows,
  isWebrtcTransportPeerRow,
  WEBRTC_TRANSPORT
};
