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

/**
 * Stable cryptographic identity for a peer row (compressed pubkey hex, else bech32 id).
 * Empty when the row is still address-keyed / pre-handshake.
 * @param {object|null|undefined} peer
 * @returns {string}
 */
function fabricPeerCryptoIdentityKey (peer) {
  const hex = fabricPeerPubkeyHex(peer);
  if (hex) return `pk:${hex}`;
  const b32 = fabricPeerBech32Id(peer);
  if (b32 && isLikelyFabricBech32Id(b32)) return `id:${b32}`;
  return '';
}

/**
 * True when `s` is a durable peer identity, not a TCP host:port placeholder.
 * @param {string} s
 * @returns {boolean}
 */
function looksLikePeerIdentityId (s) {
  const t = String(s || '').trim();
  if (!t || t.includes(':')) return false;
  if (isLikelyCompressedPubkeyHex(t) || isLikelyFabricBech32Id(t)) return true;
  return /^[0-9a-f]{16,}$/i.test(t);
}

function sameLogicalFabricPeer (a, b) {
  if (!a || !b) return false;
  const ca = fabricPeerCryptoIdentityKey(a);
  const cb = fabricPeerCryptoIdentityKey(b);
  // Distinct signed identities must never collapse — even when they share a TCP host:port
  // (reconnect, NAT, two nodes on one machine). Collapsing mixes P2P_PEER_ALIAS labels.
  if (ca && cb && ca !== cb) return false;
  const aid = String(a.id || '').trim();
  const bid = String(b.id || '').trim();
  const aad = String(a.address || '').trim();
  const bad = String(b.address || '').trim();
  if (aid && bid && aid === bid) return true;
  const an = aad ? normalizeFabricPeerAddress(aad) : '';
  const bn = bad ? normalizeFabricPeerAddress(bad) : '';
  if (an && bn && an === bn) {
    if (aid && bid && aid !== bid && looksLikePeerIdentityId(aid) && looksLikePeerIdentityId(bid)) {
      return false;
    }
    return true;
  }
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

/**
 * Drop a disconnected row's mesh alias when it is identical to a connected peer
 * at the same TCP address (stale registry copy from a previous occupant).
 * @param {object[]} peers
 * @returns {object[]}
 */
function reclaimSharedAddressAliases (peers) {
  const arr = Array.isArray(peers) ? peers : [];
  const liveAliasByAddr = new Map();
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p || p.status !== 'connected') continue;
    const alias = p.alias && String(p.alias).trim();
    const addr = p.address && String(p.address).trim();
    if (!alias || !addr || addr.toLowerCase().startsWith('webrtc:')) continue;
    liveAliasByAddr.set(normalizeFabricPeerAddress(addr), alias);
  }
  if (!liveAliasByAddr.size) return arr;
  return arr.map((p) => {
    if (!p || p.status === 'connected') return p;
    const addr = p.address && String(p.address).trim();
    if (!addr || addr.toLowerCase().startsWith('webrtc:')) return p;
    const stolen = liveAliasByAddr.get(normalizeFabricPeerAddress(addr));
    const alias = p.alias && String(p.alias).trim();
    if (!stolen || !alias || alias !== stolen) return p;
    const next = { ...p, alias: null };
    const nick = p.nickname && String(p.nickname).trim();
    if (nick && nick === stolen) next.nickname = null;
    return next;
  });
}

/**
 * Choose alias or nickname when merging two rows of the same logical peer.
 * Prefer a crypto-identified row over an address-keyed placeholder, then the
 * connected row, then the more recently seen value. Never invent a label.
 * @param {*} aVal
 * @param {*} bVal
 * @param {object} a
 * @param {object} b
 * @returns {string|null}
 * @private
 */
function pickMergedPeerLabel (aVal, bVal, a, b) {
  const sa = aVal != null && String(aVal).trim() ? String(aVal).trim() : '';
  const sb = bVal != null && String(bVal).trim() ? String(bVal).trim() : '';
  if (sa && sb && sa !== sb) {
    const aCrypto = !!fabricPeerCryptoIdentityKey(a);
    const bCrypto = !!fabricPeerCryptoIdentityKey(b);
    if (aCrypto !== bCrypto) return aCrypto ? sa : sb;
    const aConn = !!(a && a.status === 'connected');
    const bConn = !!(b && b.status === 'connected');
    if (aConn !== bConn) return aConn ? sa : sb;
    const ra = fabricPeerRecencyMs(a);
    const rb = fabricPeerRecencyMs(b);
    if (rb !== ra) return rb > ra ? sb : sa;
  }
  return sa || sb || null;
}

/**
 * Coerce a peer timestamp (epoch ms, numeric string, or ISO date) to milliseconds.
 * @param {*} value
 * @returns {number}
 * @private
 */
function coercePeerTimestampMs (value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) && t > 0 ? t : 0;
  }
  const s = String(value).trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Latest known activity time for a Fabric peer row (TCP registry, live socket, or mesh).
 * @param {object|null|undefined} peer
 * @returns {number}
 */
function fabricPeerRecencyMs (peer) {
  if (!peer || typeof peer !== 'object') return 0;
  const meta = peer.metadata && typeof peer.metadata === 'object' ? peer.metadata : {};
  const conn = peer.connection && typeof peer.connection === 'object' ? peer.connection : {};
  const values = [
    peer.lastSeen,
    peer.lastMessage,
    peer.connectedAt,
    peer.registeredAt,
    peer.firstSeen,
    peer.meshLastAt,
    meta.meshLastAt,
    conn.lastMessage,
    conn.lastSeen
  ];
  let best = 0;
  for (let i = 0; i < values.length; i++) {
    const n = coercePeerTimestampMs(values[i]);
    if (n > best) best = n;
  }
  return best;
}

/**
 * Sort Fabric peer rows with the most recently seen / messaged first.
 * @param {object[]} peers
 * @returns {object[]}
 */
function sortFabricPeersMostRecentFirst (peers) {
  const arr = Array.isArray(peers) ? peers.slice() : [];
  arr.sort((a, b) => {
    const rb = fabricPeerRecencyMs(b);
    const ra = fabricPeerRecencyMs(a);
    if (rb !== ra) return rb - ra;
    const ac = (a && a.status) === 'connected' ? 1 : 0;
    const bc = (b && b.status) === 'connected' ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return fabricPeerPrimaryLabel(a).localeCompare(fabricPeerPrimaryLabel(b));
  });
  return arr;
}

/**
 * Session byte total for Fabric (or Bitcoin-shaped) peer rows.
 * @param {object} peer
 * @returns {number}
 */
function fabricPeerSessionBytes (peer) {
  const inn = Number(peer && peer.bytesIn);
  const out = Number(peer && peer.bytesOut);
  return (Number.isFinite(inn) ? inn : 0) + (Number.isFinite(out) ? out : 0);
}

/**
 * Rolling L1-window bytes (in + out) for a Fabric peer row.
 * @param {object} peer
 * @returns {number}
 */
function fabricPeerWindowBytes (peer) {
  if (peer && Number.isFinite(Number(peer.windowBytes))) return Math.max(0, Number(peer.windowBytes));
  const inn = Number(peer && peer.windowBytesIn);
  const out = Number(peer && peer.windowBytesOut);
  return (Number.isFinite(inn) ? inn : 0) + (Number.isFinite(out) ? out : 0);
}

/**
 * Sort Fabric peer rows by a Hub table column.
 * @param {object[]} peers
 * @param {string} [column] `seen` (default), `id`, `connection`, `status`, `bytes`, `bytesIn`, `bytesOut`, `window`, `budget`
 * @param {string} [direction] `ascending` or `descending` (default)
 * @returns {object[]}
 */
function sortFabricPeersByColumn (peers, column, direction) {
  const col = column != null ? String(column) : 'seen';
  const dir = direction === 'ascending' ? 1 : -1;
  if (!col || col === 'seen') {
    const list = sortFabricPeersMostRecentFirst(peers);
    return dir === 1 ? list.reverse() : list;
  }
  const arr = Array.isArray(peers) ? peers.slice() : [];
  const value = (p) => {
    switch (col) {
      case 'id':
        return fabricPeerPrimaryLabel(p).toLowerCase();
      case 'connection':
        return String((p && (p.address || p.host || p.url)) || '').toLowerCase();
      case 'status':
        return (p && p.status) === 'connected' ? 1 : 0;
      case 'bytesIn':
        return Number(p && p.bytesIn) || 0;
      case 'bytesOut':
        return Number(p && p.bytesOut) || 0;
      case 'bytes':
        return fabricPeerSessionBytes(p);
      case 'window':
        return fabricPeerWindowBytes(p);
      case 'budget': {
        const w = fabricPeerWindowBytes(p);
        const b = Number(p && p.budgetBytes);
        return Number.isFinite(b) && b > 0 ? w / b : 0;
      }
      default:
        return 0;
    }
  };
  arr.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'string' || typeof vb === 'string') {
      const c = String(va).localeCompare(String(vb));
      return c === 0 ? fabricPeerPrimaryLabel(a).localeCompare(fabricPeerPrimaryLabel(b)) : c * dir;
    }
    if (va !== vb) return va > vb ? dir : -dir;
    return fabricPeerPrimaryLabel(a).localeCompare(fabricPeerPrimaryLabel(b));
  });
  return arr;
}

/**
 * Prefer the later of two timestamp fields (ISO string or epoch).
 * @param {*} a
 * @param {*} b
 * @returns {*}
 * @private
 */
function laterTimestampValue (a, b) {
  const am = coercePeerTimestampMs(a);
  const bm = coercePeerTimestampMs(b);
  if (!am && !bm) return a != null ? a : b;
  return bm > am ? b : a;
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
  const nickname = pickMergedPeerLabel(a && a.nickname, b && b.nickname, a, b);
  const alias = pickMergedPeerLabel(a && a.alias, b && b.alias, a, b);
  const id = (a && a.id) || (b && b.id);
  const address = (a && a.address) || (b && b.address);
  const metaA = a && a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const metaB = b && b.metadata && typeof b.metadata === 'object' ? b.metadata : {};
  const metadata = { ...metaB, ...metaA };
  const lastSeen = laterTimestampValue(a && a.lastSeen, b && b.lastSeen);
  const lastMessage = laterTimestampValue(a && a.lastMessage, b && b.lastMessage);
  const maxNum = (x, y) => {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) return Math.max(nx, ny);
    if (Number.isFinite(nx)) return nx;
    if (Number.isFinite(ny)) return ny;
    return undefined;
  };
  const bytesIn = maxNum(a && a.bytesIn, b && b.bytesIn);
  const bytesOut = maxNum(a && a.bytesOut, b && b.bytesOut);
  const windowBytesIn = maxNum(a && a.windowBytesIn, b && b.windowBytesIn);
  const windowBytesOut = maxNum(a && a.windowBytesOut, b && b.windowBytesOut);
  const windowBytes = maxNum(a && a.windowBytes, b && b.windowBytes);
  const budgetBytes = maxNum(a && a.budgetBytes, b && b.budgetBytes);
  const budgetShare = maxNum(a && a.budgetShare, b && b.budgetShare);
  return {
    ...b,
    ...a,
    id: id || a.id || b.id,
    address: address || a.address || b.address,
    status,
    score,
    misbehavior,
    nickname: nickname || null,
    alias: alias || null,
    lastSeen,
    lastMessage,
    metadata,
    bytesIn,
    bytesOut,
    windowBytesIn,
    windowBytesOut,
    windowBytes,
    budgetBytes,
    budgetShare,
    overBudget: !!(a && a.overBudget) || !!(b && b.overBudget)
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
  return reclaimSharedAddressAliases(out);
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
 * True when <code>s</code> looks like a compressed secp256k1 pubkey hex (33 bytes).
 * @param {string} s
 * @returns {boolean}
 */
function isLikelyCompressedPubkeyHex (s) {
  const t = String(s || '').trim().toLowerCase();
  return /^(02|03)[0-9a-f]{64}$/.test(t);
}

/**
 * Dial-pin identity: compressed pubkey hex when present on the peer row.
 * Checked fields: <code>publicKey</code>, <code>pubkey</code>, hex-shaped <code>id</code>,
 * <code>metadata.fabricPeerId</code> / <code>metadata.publicKey</code>.
 * @param {object|null|undefined} peer
 * @returns {string} lowercase hex or ''
 */
function fabricPeerPubkeyHex (peer) {
  if (!peer || typeof peer !== 'object') return '';
  const m = peer.metadata && typeof peer.metadata === 'object' ? peer.metadata : {};
  const cands = [
    peer.publicKey,
    peer.pubkey,
    m.publicKey,
    m.pubkey,
    m.fabricPeerId,
    peer.id
  ];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i] != null ? String(cands[i]).trim() : '';
    if (isLikelyCompressedPubkeyHex(c)) return c.toLowerCase();
  }
  return '';
}

/**
 * Left-hand side for a native peering string: hex pubkey preferred, else bech32/id.
 * @param {object|null|undefined} peer
 * @returns {string}
 */
function fabricPeerDialIdentity (peer) {
  return fabricPeerPubkeyHex(peer) || fabricPeerBech32Id(peer) || '';
}

/**
 * @param {object} peer - Fabric P2P row from GetNetworkStatus
 * @returns {string}
 */
function fabricPeerPrimaryLabel (peer) {
  if (!peer || typeof peer !== 'object') return '';
  // Mesh-advertised P2P_PEER_ALIAS, then operator-local nickname.
  const alias = peer.alias && String(peer.alias).trim();
  if (alias) return alias;
  const nick = peer.nickname && String(peer.nickname).trim();
  if (nick) return nick;
  const fb = fabricPeerBech32Id(peer);
  if (fb && isLikelyFabricBech32Id(fb)) return shortenPublicId(fb, 14, 12);
  const x = extractPeerXpub(peer);
  if (x) return shortenPublicId(x, 12, 10);
  if (fb) return shortenPublicId(fb, 14, 12);
  const id = peer.id && String(peer.id).trim();
  if (id) return shortenPublicId(id, 12, 10);
  const addr = peer.address && String(peer.address).trim();
  return addr ? shortenPublicId(addr, 14, 8) : 'peer';
}

/**
 * Registry patch for an inbound signed {@link P2P_PEER_ALIAS}.
 * Writes mesh <code>alias</code> only — never the operator's node-local nickname.
 * @param {string} signer
 * @param {string} alias
 * @returns {{ id: string, alias: string }|null}
 */
function peerMeshAliasRegistryPatch (signer, alias) {
  const id = String(signer || '').trim();
  const name = String(alias || '').trim().slice(0, 64);
  if (!id || !name) return null;
  return { id, alias: name };
}

/**
 * Registry patch for SetPeerNickname.
 * Remote peers: nickname only (leave mesh alias). Self: nickname is also the advertised alias.
 * @param {string} key
 * @param {string|null|undefined} nickname
 * @param {boolean} [isSelf]
 * @returns {{ id: string, nickname: string|null, alias?: string|null }|null}
 */
function peerNicknameRegistryPatch (key, nickname, isSelf) {
  const id = String(key || '').trim();
  if (!id) return null;
  const clean = nickname == null ? null : (String(nickname).trim().slice(0, 64) || null);
  if (isSelf) return { id, nickname: clean, alias: clean };
  return { id, nickname: clean };
}

/**
 * Locate a peer row by cryptographic id first, then TCP address.
 * Shared host:port must not steal another identity's alias.
 * @param {object[]} peers
 * @param {string} actorId
 * @returns {object|null}
 */
function findFabricPeerRow (peers, actorId) {
  const arr = Array.isArray(peers) ? peers : [];
  const id = actorId != null ? String(actorId).trim() : '';
  if (!id) return null;
  const identityHits = arr.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    if (p.id != null && String(p.id) === id) return true;
    const hex = fabricPeerPubkeyHex(p);
    if (hex && hex === id.toLowerCase()) return true;
    const b32 = fabricPeerBech32Id(p);
    if (b32 && b32 === id) return true;
    return false;
  });
  if (identityHits.length) {
    return identityHits.find((p) => p && p.status === 'connected') || identityHits[0];
  }
  const want = normalizeFabricPeerAddress(id);
  const addrHits = arr.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const addr = p.address != null ? String(p.address).trim() : '';
    if (!addr) return false;
    return addr === id || normalizeFabricPeerAddress(addr) === want;
  });
  if (!addrHits.length) return null;
  return addrHits.find((p) => p && p.status === 'connected') || addrHits[0];
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
 * Concatenate TCP Fabric peers with WebRTC mesh rows and sort most recently seen first.
 * @param {object[]} tcpPeersSorted - already deduped TCP rows
 * @param {object[]} webrtcAsFabric - {@link webrtcCombinedToFabricPeerRows}
 * @param {string} [_primaryNorm] - unused; kept so callers can still pass the saved primary address
 * @returns {object[]}
 */
function mergeTcpAndWebrtcPeerRows (tcpPeersSorted, webrtcAsFabric, _primaryNorm) {
  const tcp = Array.isArray(tcpPeersSorted) ? tcpPeersSorted : [];
  const w = Array.isArray(webrtcAsFabric) ? webrtcAsFabric : [];
  return sortFabricPeersMostRecentFirst(tcp.concat(w));
}

function isWebrtcTransportPeerRow (peer) {
  return !!(peer && peer.metadata && peer.metadata.transport === WEBRTC_TRANSPORT);
}

/**
 * Prefer a real Fabric TCP <code>host:port</code>; otherwise WebRTC signaling origin (<code>window.location.host</code> shape).
 * Browser clients will later dial the web origin over WebRTC using the same identity left-hand side;
 * hubs remain signaling until mesh gossip can survive hub loss.
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
 * True when the peering endpoint is WebRTC signaling (no Fabric TCP address on the row).
 * @param {object|null|undefined} peer
 * @returns {boolean}
 */
function peerPeeringEndpointIsSignaling (peer) {
  if (!peer || typeof peer !== 'object') return false;
  if (isWebrtcTransportPeerRow(peer)) return true;
  const addr = peer.address != null ? String(peer.address).trim() : '';
  return !addr || addr.toLowerCase().startsWith('webrtc:');
}

/**
 * Native Fabric peering string for clipboard / CLI dial pins:
 * <code>pubkey@host:port</code> (compressed hex when known; bech32/id fallback).
 * Endpoint is TCP <code>host:port</code>, or the web signaling host for WebRTC-only rows.
 * @param {object|null|undefined} peer
 * @param {string} [signalingHostPort]
 * @returns {string}
 */
function peerNativePeeringString (peer, signalingHostPort) {
  const pk = fabricPeerDialIdentity(peer);
  const target = peerPublicConnectionTargetHostPort(peer, signalingHostPort);
  if (!pk && !target) return '';
  if (!target) return pk;
  if (!pk) return `@${target}`;
  return `${pk}@${target}`;
}

/**
 * @deprecated Prefer {@link peerNativePeeringString} (hex-first dial pin).
 * @param {object|null|undefined} peer
 * @param {string} [signalingHostPort]
 * @returns {string}
 */
function peerConnectionPubkeyAtHostPort (peer, signalingHostPort) {
  return peerNativePeeringString(peer, signalingHostPort);
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
  isLikelyCompressedPubkeyHex,
  fabricPeerBech32Id,
  fabricPeerPubkeyHex,
  fabricPeerCryptoIdentityKey,
  fabricPeerDialIdentity,
  peerPublicConnectionTargetHostPort,
  peerPeeringEndpointIsSignaling,
  peerNativePeeringString,
  peerConnectionPubkeyAtHostPort,
  fabricP2PIdentityConfirmed,
  consolidateUnifiedPeersByFabricId,
  sameLogicalFabricPeer,
  looksLikePeerIdentityId,
  reclaimSharedAddressAliases,
  findFabricPeerRow,
  peerMeshAliasRegistryPatch,
  peerNicknameRegistryPatch,
  dedupeFabricPeers,
  fabricPeerRecencyMs,
  sortFabricPeersMostRecentFirst,
  sortFabricPeersByColumn,
  fabricPeerSessionBytes,
  fabricPeerWindowBytes,
  fabricPeerPrimaryLabel,
  buildWebrtcCombinedRows,
  webrtcRowPrimaryLabel,
  webrtcCombinedRowToFabricPeerShape,
  webrtcCombinedToFabricPeerRows,
  mergeTcpAndWebrtcPeerRows,
  isWebrtcTransportPeerRow,
  WEBRTC_TRANSPORT
};
