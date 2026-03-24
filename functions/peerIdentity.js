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
  return !!(xa && xb && xa === xb);
}

function mergeFabricPeerRows (a, b) {
  const connected = (a && a.status) === 'connected' || (b && b.status) === 'connected';
  const status = connected ? 'connected' : ((a && a.status) || (b && b.status) || 'unknown');
  const sa = Number(a && a.score);
  const sb = Number(b && b.score);
  const score = (Number.isFinite(sa) && Number.isFinite(sb))
    ? Math.max(sa, sb)
    : (Number.isFinite(sa) ? sa : (Number.isFinite(sb) ? sb : (a && a.score != null ? a.score : b && b.score)));
  const na = a && a.nickname && String(a.nickname).trim();
  const nb = b && b.nickname && String(b.nickname).trim();
  const nickname = na || nb || null;
  const id = (a && a.id) || (b && b.id);
  const address = (a && a.address) || (b && b.address);
  return {
    ...b,
    ...a,
    id: id || a.id || b.id,
    address: address || a.address || b.address,
    status,
    score,
    nickname: nickname || a.nickname || b.nickname
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

/**
 * @param {object} peer - Fabric P2P row from GetNetworkStatus
 * @returns {string}
 */
function fabricPeerPrimaryLabel (peer) {
  if (!peer || typeof peer !== 'object') return '';
  const nick = peer.nickname && String(peer.nickname).trim();
  if (nick) return nick;
  const x = extractPeerXpub(peer);
  if (x) return shortenPublicId(x, 12, 10);
  if (peer.alias && String(peer.alias).trim()) return String(peer.alias).trim();
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

module.exports = {
  normalizeFabricPeerAddress,
  normalizePeerAddressInput,
  extractPeerXpub,
  shortenPublicId,
  dedupeFabricPeers,
  fabricPeerPrimaryLabel,
  buildWebrtcCombinedRows,
  webrtcRowPrimaryLabel
};
