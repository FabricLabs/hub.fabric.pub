'use strict';

const crypto = require('crypto');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const Message = require('@fabric/core/types/message');
const SetupService = require('../services/setup');
const { mergeFabricPeersWithWebRtcRegistry } = require('./mergeFabricPeersWithWebRtcRegistry');
const { buildFederationVaultFromPolicy } = require('./federationVault');

try {
  if (typeof ecc.__initializeContext === 'function') ecc.__initializeContext();
} catch (_) {}
bitcoin.initEccLib(ecc);

const STORE_PATH = 'fabric/collaboration.json';
const MAX_CONTACTS = 500;
const MAX_INVITATIONS = 200;
const MAX_GROUPS = 100;
const DEFAULT_INVITE_TTL_MS = 14 * 24 * 3600 * 1000;
const COLLAB_INVITE_PREFIX = '[COLLAB_INVITATION] ';
/** 16 bytes hex from {@link newId} (prefix + 32 hex chars) */
const COLLAB_ID_SUFFIX_HEX_LEN = 32;
const CONTACT_ID_RE = new RegExp(`^cnt_[0-9a-f]{${COLLAB_ID_SUFFIX_HEX_LEN}}$`, 'i');
const INVITATION_ID_RE = new RegExp(`^inv_[0-9a-f]{${COLLAB_ID_SUFFIX_HEX_LEN}}$`, 'i');
const GROUP_ID_RE = new RegExp(`^grp_[0-9a-f]{${COLLAB_ID_SUFFIX_HEX_LEN}}$`, 'i');
const TAPROOT_INTERNAL_NUMS = Buffer.from(
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0',
  'hex'
);

function hasStoreKey (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readContact (store, id) {
  const k = String(id || '').trim();
  if (!CONTACT_ID_RE.test(k) || !hasStoreKey(store.contacts, k)) return undefined;
  return store.contacts[k];
}

function emptyStore () {
  return {
    schemaVersion: 1,
    updatedAt: 0,
    contacts: {},
    invitations: {},
    groups: {}
  };
}

function loadStore (fs) {
  if (!fs || typeof fs.readFile !== 'function') return emptyStore();
  try {
    const raw = fs.readFile(STORE_PATH);
    if (!raw) return emptyStore();
    const j = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(raw.toString('utf8'));
    if (!j || typeof j !== 'object') return emptyStore();
    return Object.assign(emptyStore(), j, {
      contacts: j.contacts && typeof j.contacts === 'object' ? j.contacts : {},
      invitations: j.invitations && typeof j.invitations === 'object' ? j.invitations : {},
      groups: j.groups && typeof j.groups === 'object' ? j.groups : {}
    });
  } catch (_) {
    return emptyStore();
  }
}

async function saveStore (fs, data) {
  if (!fs || typeof fs.publish !== 'function') throw new Error('Filesystem not available');
  data.updatedAt = Date.now();
  await fs.publish(STORE_PATH, data);
}

function newId (prefix) {
  return `${prefix}${crypto.randomBytes(16).toString('hex')}`;
}

function normalizeEmail (s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

function normalizePeerIdentity (s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return '';
  return isBech32PeerId(t) ? t : '';
}

function stripHex (h) {
  let x = String(h || '').trim().toLowerCase();
  if (x.startsWith('0x')) x = x.slice(2);
  return x;
}

function xOnly32ToCompressed33 (x32) {
  const u = Uint8Array.from(x32);
  const b2 = Buffer.concat([Buffer.from([0x02]), Buffer.from(u)]);
  if (ecc.isPoint(b2)) return b2;
  const b3 = Buffer.concat([Buffer.from([0x03]), Buffer.from(u)]);
  if (ecc.isPoint(b3)) return b3;
  return null;
}

/** @returns {{ ok: true, xOnlyHex: string, compressedHex: string } | { ok: false, message: string }} */
function normalizeSecpPublicKey (hexIn) {
  const h = stripHex(hexIn);
  if (!h) return { ok: false, message: 'publicKeyHex required' };
  let buf;
  try {
    buf = Buffer.from(h, 'hex');
  } catch (_) {
    return { ok: false, message: 'invalid hex' };
  }
  if (buf.length === 32) {
    if (!ecc.isXOnlyPoint(buf)) return { ok: false, message: 'invalid x-only secp256k1 point' };
    const compressed = xOnly32ToCompressed33(buf);
    if (!compressed) return { ok: false, message: 'invalid x-only secp256k1 point' };
    return { ok: true, xOnlyHex: h, compressedHex: compressed.toString('hex') };
  }
  if (buf.length === 33) {
    if (!ecc.isPoint(buf)) return { ok: false, message: 'invalid compressed secp256k1 point' };
    const xonly = Buffer.from(ecc.xOnlyPointFromPoint(buf));
    return { ok: true, xOnlyHex: xonly.toString('hex'), compressedHex: buf.toString('hex') };
  }
  return { ok: false, message: 'publicKeyHex must be 32-byte x-only or 33-byte compressed hex' };
}

function digestToken (token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function timingSafeHexEqual (a, b) {
  try {
    const ba = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

function verifyAdminRequest (hub, req, res) {
  const token = SetupService.extractBearerToken(req);
  if (!hub.setup || typeof hub.setup.verifyAdminToken !== 'function' || !hub.setup.verifyAdminToken(token)) {
    res.status(401).json({ status: 'error', message: 'Admin token required' });
    return false;
  }
  return true;
}

function hubPublicOrigin (hub) {
  const env = String(process.env.FABRIC_HUB_PUBLIC_ORIGIN || process.env.FABRIC_EXPLORER_URL || '').replace(/\/$/, '');
  if (env) return env;
  const port = hub.http && hub.http.settings && hub.http.settings.port ? Number(hub.http.settings.port) : 8080;
  const host = hub.http && hub.http.settings && hub.http.settings.hostname ? String(hub.http.settings.hostname) : '127.0.0.1';
  const scheme = process.env.FABRIC_HUB_PUBLIC_SCHEME === 'https' ? 'https' : 'http';
  return `${scheme}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
}

function escapeHtmlAttribute (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function invitationEmailHtml (acceptUrl, declineUrl) {
  const a = escapeHtmlAttribute(acceptUrl);
  const d = escapeHtmlAttribute(declineUrl);
  return `<!doctype html><html><body>
<p>You have been invited to collaborate on a Fabric Hub.</p>
<p><a href="${a}">Accept invitation</a></p>
<p><a href="${d}">Decline</a></p>
</body></html>`;
}

function peerRegistryList (hub) {
  const known = hub.agent && typeof hub.agent.knownPeers !== 'undefined' ? hub.agent.knownPeers : [];
  return mergeFabricPeersWithWebRtcRegistry(known, hub.http && hub.http.webrtcPeerList ? hub.http.webrtcPeerList : []);
}

function findPeerByFabricId (hub, fabricPeerId) {
  const want = String(fabricPeerId || '').trim();
  if (!want) return null;
  const list = peerRegistryList(hub);
  return list.find((p) => p && (String(p.id) === want || (p.metadata && String(p.metadata.fabricPeerId) === want))) || null;
}

function isBech32PeerId (v) {
  const s = String(v || '').trim().toLowerCase();
  return s.startsWith('id1') && s.length >= 10;
}

function resolveStablePeerIdentity (peer, fallback) {
  const pId = peer && peer.id ? String(peer.id).trim() : '';
  if (isBech32PeerId(pId)) return pId;
  const metaId = peer && peer.metadata && peer.metadata.fabricPeerId ? String(peer.metadata.fabricPeerId).trim() : '';
  if (isBech32PeerId(metaId)) return metaId;
  const fb = String(fallback || '').trim();
  return isBech32PeerId(fb) ? fb : '';
}

function findContactByEmailWithPeer (store, email) {
  const want = normalizeEmail(email);
  if (!want) return null;
  const contacts = Object.values(store.contacts || {});
  return contacts.find((c) => c && normalizeEmail(c.email) === want && String(c.fabricPeerId || '').trim()) || null;
}

function broadcastInviteEventToClients (hub, event) {
  try {
    if (!hub || !hub.http || typeof hub.http.broadcast !== 'function') return;
    const body = JSON.stringify({ type: 'CollaborationInvitation', object: event });
    const msg = Message.fromVector(['GenericMessage', body]).signWithKey(hub.agent.key);
    hub.http.broadcast(msg);
  } catch (e) {
    console.warn('[HUB:COLLAB] invite broadcast failed:', e && e.message ? e.message : e);
  }
}

function relayInviteToPeer (hub, fabricPeerId, event) {
  try {
    if (!hub || typeof hub._resolvePeerAddress !== 'function' || typeof hub._sendVectorToPeer !== 'function') return false;
    const address = hub._resolvePeerAddress(fabricPeerId);
    const conns = hub.agent && hub.agent.connections;
    if (!address || !conns || !hasStoreKey(conns, address)) return false;
    const payload = {
      type: 'P2P_CHAT_MESSAGE',
      actor: { id: hub.agent.identity && hub.agent.identity.id ? hub.agent.identity.id : 'hub' },
      object: {
        content: `${COLLAB_INVITE_PREFIX}${JSON.stringify(event)}`,
        created: Date.now()
      },
      target: String(fabricPeerId)
    };
    hub._sendVectorToPeer(address, ['P2P_CHAT_MESSAGE', JSON.stringify(payload)]);
    return true;
  } catch (e) {
    console.warn('[HUB:COLLAB] invite relay failed:', e && e.message ? e.message : e);
    return false;
  }
}

/**
 * Resolve group members to x-only pubkeys (flatten nested groups). Detect cycles.
 * @param {object} store
 * @param {string} groupId
 * @param {Set<string>} [stack]
 * @returns {{ xOnlyHexList: string[], missing: Array<{ ref: string, reason: string }> }}
 */
function flattenGroupPubkeys (store, groupId, stack) {
  const s = stack || new Set();
  if (s.has(groupId)) {
    return { xOnlyHexList: [], missing: [{ ref: groupId, reason: 'group cycle' }] };
  }
  s.add(groupId);
  if (!GROUP_ID_RE.test(String(groupId || '').trim())) {
    return { xOnlyHexList: [], missing: [{ ref: String(groupId), reason: 'invalid group id' }] };
  }
  const g = hasStoreKey(store.groups, groupId) ? store.groups[groupId] : null;
  if (!g || typeof g !== 'object') {
    return { xOnlyHexList: [], missing: [{ ref: groupId, reason: 'unknown group' }] };
  }
  const members = Array.isArray(g.members) ? g.members : [];
  const xOnlyHexList = [];
  const missing = [];

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (!m || typeof m !== 'object') continue;
    const t = String(m.type || '').toLowerCase();
    if (t === 'pubkey') {
      const n = normalizeSecpPublicKey(m.publicKeyHex);
      if (!n.ok) missing.push({ ref: `members[${i}]`, reason: n.message });
      else xOnlyHexList.push(n.xOnlyHex);
    } else if (t === 'contact') {
      const c = readContact(store, m.contactId);
      if (!c) missing.push({ ref: String(m.contactId), reason: 'unknown contact' });
      else if (!c.publicKeyHex) missing.push({ ref: String(m.contactId), reason: 'contact has no publicKeyHex' });
      else {
        const n = normalizeSecpPublicKey(c.publicKeyHex);
        if (!n.ok) missing.push({ ref: String(m.contactId), reason: n.message });
        else xOnlyHexList.push(n.xOnlyHex);
      }
    } else if (t === 'group') {
      const gid = String(m.groupId || '').trim();
      if (!GROUP_ID_RE.test(gid)) {
        missing.push({ ref: gid, reason: 'invalid nested group id' });
      } else {
        const sub = flattenGroupPubkeys(store, gid, new Set(s));
        xOnlyHexList.push(...sub.xOnlyHexList);
        missing.push(...sub.missing);
      }
    } else {
      missing.push({ ref: `members[${i}]`, reason: `unknown member type ${t || '(empty)'}` });
    }
  }

  const dedup = [...new Set(xOnlyHexList)].sort();
  return { xOnlyHexList: dedup, missing };
}

function policyFingerprint (threshold, xOnlyHexList) {
  const payload = JSON.stringify({ m: threshold, keys: xOnlyHexList });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function networkForFabricName (name = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'regtest' || n === 'test') return bitcoin.networks.regtest;
  if (n === 'testnet' || n === 'signet') return bitcoin.networks.testnet;
  return bitcoin.networks.bitcoin;
}

function resolveHubBitcoinNetworkName (hub) {
  const net = hub && hub.settings && hub.settings.bitcoin && hub.settings.bitcoin.network
    ? String(hub.settings.bitcoin.network)
    : '';
  return net || String(process.env.FABRIC_BITCOIN_NETWORK || 'regtest');
}

function buildThresholdTapscriptFromXOnly (xOnlyHexList, threshold) {
  const keys = [];
  for (const hex of xOnlyHexList) {
    const s = stripHex(hex);
    if (!/^[0-9a-f]{64}$/i.test(s)) throw new Error('invalid x-only key in group policy');
    keys.push(Buffer.from(s, 'hex'));
  }
  if (!keys.length) throw new Error('at least one x-only key is required');
  const k = Math.max(1, Math.min(Number(threshold) || 1, keys.length));
  if (keys.length === 1) return bitcoin.script.compile([keys[0], bitcoin.script.OPS.OP_CHECKSIG]);
  const chunks = [keys[0], bitcoin.script.OPS.OP_CHECKSIG];
  for (let i = 1; i < keys.length; i++) {
    chunks.push(keys[i], bitcoin.script.OPS.OP_CHECKSIGADD);
  }
  chunks.push(bitcoin.script.number.encode(k), bitcoin.script.OPS.OP_NUMEQUAL);
  return bitcoin.script.compile(chunks);
}

function descriptorForThresholdPolicy (threshold, xOnlyHexList) {
  const m = Math.max(1, Math.min(Number(threshold) || 1, xOnlyHexList.length || 1));
  if ((xOnlyHexList || []).length <= 1) {
    return `tr(${String((xOnlyHexList && xOnlyHexList[0]) || '')})`;
  }
  return `tr(${TAPROOT_INTERNAL_NUMS.toString('hex')},sortedmulti_a(${m},${xOnlyHexList.join(',')}))`;
}

function compressedValidatorsFromXOnly (xOnlyHexList) {
  const out = [];
  for (const hex of xOnlyHexList || []) {
    const s = stripHex(hex);
    if (!/^[0-9a-f]{64}$/i.test(s)) throw new Error('invalid x-only key in group policy');
    const c = xOnly32ToCompressed33(Buffer.from(s, 'hex'));
    if (!c) throw new Error('could not derive compressed validator key from x-only pubkey');
    out.push(c.toString('hex'));
  }
  return [...new Set(out)].sort();
}

async function listContacts (hub) {
  const st = loadStore(hub.fs);
  return Object.values(st.contacts).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function addContact (hub, body) {
  const st = loadStore(hub.fs);
  if (Object.keys(st.contacts).length >= MAX_CONTACTS) throw new Error('contact limit reached');
  const email = body.email ? normalizeEmail(body.email) : null;
  const fabricPeerId = body.fabricPeerId ? String(body.fabricPeerId).trim() : null;
  if (!email && !fabricPeerId) throw new Error('email or fabricPeerId required');
  if (fabricPeerId && !findPeerByFabricId(hub, fabricPeerId)) {
    throw new Error('fabricPeerId not found in current peer list');
  }
  let publicKeyHex = null;
  if (body.publicKeyHex) {
    const n = normalizeSecpPublicKey(body.publicKeyHex);
    if (!n.ok) throw new Error(n.message);
    publicKeyHex = n.xOnlyHex;
  }
  const id = newId('cnt_');
  const now = Date.now();
  st.contacts[id] = {
    id,
    label: body.label ? String(body.label).slice(0, 200) : '',
    email: email || '',
    fabricPeerId: fabricPeerId || '',
    publicKeyHex: publicKeyHex || '',
    source: body.source ? String(body.source).slice(0, 64) : (fabricPeerId ? 'peer' : 'manual'),
    createdAt: now,
    updatedAt: now
  };
  await saveStore(hub.fs, st);
  return st.contacts[id];
}

async function deleteContact (hub, id) {
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!CONTACT_ID_RE.test(k) || !hasStoreKey(st.contacts, k)) throw new Error('contact not found');
  Reflect.deleteProperty(st.contacts, k);
  await saveStore(hub.fs, st);
  return { ok: true };
}

async function listInvitations (hub) {
  const st = loadStore(hub.fs);
  return Object.values(st.invitations)
    .map((inv) => ({
      id: inv.id,
      email: inv.email || '',
      recipientPeerIdentity: inv.recipientPeerIdentity || '',
      status: inv.status,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      groupId: inv.groupId || null
    }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

async function createInvitation (hub, body) {
  const st = loadStore(hub.fs);
  if (Object.keys(st.invitations).length >= MAX_INVITATIONS) throw new Error('invitation limit reached');
  const email = normalizeEmail(body.email);
  const requestedPeerId = normalizePeerIdentity(body.recipientPeerIdentity || body.fabricPeerId);
  if (!email && !requestedPeerId) throw new Error('Provide invite email or recipientPeerIdentity (id1...)');
  const ttl = Math.max(3600000, Math.min(90 * 24 * 3600000, Number(body.ttlMs || DEFAULT_INVITE_TTL_MS)));
  const groupId = body.groupId ? String(body.groupId).trim() : '';
  if (groupId && (!GROUP_ID_RE.test(groupId) || !hasStoreKey(st.groups, groupId))) throw new Error('group not found');
  const token = crypto.randomBytes(32).toString('hex');
  const id = newId('inv_');
  const now = Date.now();
  const initialPeerIdentity = requestedPeerId || '';
  st.invitations[id] = {
    id,
    email: email || '',
    recipientPeerIdentity: initialPeerIdentity || '',
    status: 'pending',
    tokenDigest: digestToken(token),
    createdAt: now,
    expiresAt: now + ttl,
    groupId: groupId || null
  };
  await saveStore(hub.fs, st);

  const origin = hubPublicOrigin(hub);
  const acceptUrl = `${origin}/services/collaboration/invitations/claim?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const declineUrl = `${origin}/services/collaboration/invitations/decline?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const contact = email ? findContactByEmailWithPeer(st, email) : null;
  const peerTarget = contact ? String(contact.fabricPeerId || '').trim() : '';
  const routePeer = peerTarget || initialPeerIdentity;
  const matchedPeer = routePeer ? findPeerByFabricId(hub, routePeer) : null;
  const peerIdentity = resolveStablePeerIdentity(matchedPeer, routePeer);
  if (peerIdentity) {
    st.invitations[id].recipientPeerIdentity = peerIdentity;
    await saveStore(hub.fs, st);
  }
  const event = {
    invitationId: id,
    groupId: st.invitations[id].groupId || null,
    acceptUrl,
    declineUrl,
    createdAt: now,
    expiresAt: st.invitations[id].expiresAt,
    recipientFabricPeerId: peerTarget || null,
    recipientPeerIdentity: peerIdentity || null
  };

  if (email && hub.email && typeof hub.email.send === 'function') {
    const from = (hub.settings && hub.settings.email && hub.settings.email.defaultFrom)
      || process.env.FABRIC_EMAIL_FROM
      || '';
    if (!from) {
      console.warn('[HUB:COLLAB] FABRIC_EMAIL_FROM / settings.email.defaultFrom missing; invitation created but email not sent');
    } else {
      try {
        await hub.email.send({
          from,
          to: email,
          subject: 'Fabric Hub invitation',
          text: `Accept: ${acceptUrl}\nDecline: ${declineUrl}`,
          html: invitationEmailHtml(acceptUrl, declineUrl)
        });
      } catch (e) {
        console.warn('[HUB:COLLAB] invitation email failed:', e && e.message ? e.message : e);
      }
    }
  }

  if (routePeer) {
    const relayed = relayInviteToPeer(hub, routePeer, event);
    if (!relayed) {
      console.warn('[HUB:COLLAB] invite peer target is not currently connected:', routePeer);
    }
  }
  broadcastInviteEventToClients(hub, event);

  return {
    id,
    email: st.invitations[id].email || '',
    recipientPeerIdentity: st.invitations[id].recipientPeerIdentity || '',
    expiresAt: st.invitations[id].expiresAt,
    groupId: st.invitations[id].groupId
  };
}

async function verifyInvitationToken (hub, id, token) {
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!INVITATION_ID_RE.test(k)) return { valid: false, reason: 'unknown invitation' };
  const inv = hasStoreKey(st.invitations, k) ? st.invitations[k] : null;
  if (!inv) return { valid: false, reason: 'unknown invitation' };
  const now = Date.now();
  if (inv.expiresAt && now > inv.expiresAt) return { valid: false, reason: 'expired' };
  if (inv.status !== 'pending') return { valid: false, reason: `status:${inv.status}` };
  const d = digestToken(token);
  if (!timingSafeHexEqual(d, inv.tokenDigest)) return { valid: false, reason: 'bad token' };
  return { valid: true, email: inv.email, groupId: inv.groupId || null };
}

async function declineInvitation (hub, id, token) {
  const v = await verifyInvitationToken(hub, id, token);
  if (!v.valid) return v;
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!INVITATION_ID_RE.test(k) || !hasStoreKey(st.invitations, k)) return { valid: false, reason: 'unknown invitation' };
  st.invitations[k].status = 'declined';
  st.invitations[k].updatedAt = Date.now();
  await saveStore(hub.fs, st);
  return { ok: true, status: 'declined' };
}

async function acceptInvitation (hub, id, token) {
  const v = await verifyInvitationToken(hub, id, token);
  if (!v.valid) return v;
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!INVITATION_ID_RE.test(k) || !hasStoreKey(st.invitations, k)) return { valid: false, reason: 'unknown invitation' };
  st.invitations[k].status = 'accepted';
  st.invitations[k].updatedAt = Date.now();
  await saveStore(hub.fs, st);
  return { ok: true, status: 'accepted' };
}

async function deleteInvitation (hub, id) {
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!INVITATION_ID_RE.test(k) || !hasStoreKey(st.invitations, k)) throw new Error('invitation not found');
  Reflect.deleteProperty(st.invitations, k);
  await saveStore(hub.fs, st);
  return { ok: true };
}

async function listGroups (hub) {
  const st = loadStore(hub.fs);
  return Object.values(st.groups).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    threshold: g.threshold,
    memberCount: Array.isArray(g.members) ? g.members.length : 0,
    childGroupRefs: (Array.isArray(g.members) ? g.members : []).filter((m) => m && String(m.type).toLowerCase() === 'group').length,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt
  })).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function createGroup (hub, body) {
  const st = loadStore(hub.fs);
  if (Object.keys(st.groups).length >= MAX_GROUPS) throw new Error('group limit reached');
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name required');
  const id = newId('grp_');
  const now = Date.now();
  const threshold = Math.max(1, Math.min(99, Number(body.threshold || 1)));
  st.groups[id] = {
    id,
    name: name.slice(0, 200),
    description: body.description ? String(body.description).slice(0, 2000) : '',
    threshold,
    members: [],
    createdAt: now,
    updatedAt: now
  };
  await saveStore(hub.fs, st);
  return st.groups[id];
}

async function getGroup (hub, id) {
  const st = loadStore(hub.fs);
  const g = st.groups[id];
  if (!g) throw new Error('group not found');
  return g;
}

async function updateGroup (hub, id, body) {
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!GROUP_ID_RE.test(k) || !hasStoreKey(st.groups, k)) throw new Error('group not found');
  const g = st.groups[k];
  if (!g) throw new Error('group not found');
  if (body.name != null) g.name = String(body.name).trim().slice(0, 200);
  if (body.description != null) g.description = String(body.description).slice(0, 2000);
  if (body.threshold != null) g.threshold = Math.max(1, Math.min(99, Number(body.threshold)));
  g.updatedAt = Date.now();
  await saveStore(hub.fs, st);
  return g;
}

async function deleteGroup (hub, id) {
  const st = loadStore(hub.fs);
  const k = String(id || '').trim();
  if (!GROUP_ID_RE.test(k) || !hasStoreKey(st.groups, k)) throw new Error('group not found');
  for (const g of Object.values(st.groups)) {
    if (!g || !Array.isArray(g.members)) continue;
    for (const m of g.members) {
      if (m && String(m.type).toLowerCase() === 'group' && String(m.groupId) === k) {
        throw new Error('group is referenced as nested member of another group');
      }
    }
  }
  Reflect.deleteProperty(st.groups, k);
  await saveStore(hub.fs, st);
  return { ok: true };
}

async function addGroupMember (hub, groupId, body) {
  const st = loadStore(hub.fs);
  const gid = String(groupId || '').trim();
  if (!GROUP_ID_RE.test(gid) || !hasStoreKey(st.groups, gid)) throw new Error('group not found');
  const g = st.groups[gid];
  if (!g) throw new Error('group not found');
  const t = String(body.type || '').toLowerCase();
  const members = Array.isArray(g.members) ? g.members : [];
  if (t === 'pubkey') {
    const n = normalizeSecpPublicKey(body.publicKeyHex);
    if (!n.ok) throw new Error(n.message);
    members.push({
      type: 'pubkey',
      publicKeyHex: n.xOnlyHex,
      label: body.label ? String(body.label).slice(0, 200) : ''
    });
  } else if (t === 'contact') {
    const cid = String(body.contactId || '').trim();
    if (!readContact(st, cid)) throw new Error('contact not found');
    members.push({ type: 'contact', contactId: cid });
  } else if (t === 'group') {
    const nested = String(body.groupId || '').trim();
    if (!nested || nested === gid) throw new Error('invalid nested group');
    if (!GROUP_ID_RE.test(nested) || !hasStoreKey(st.groups, nested)) throw new Error('nested group not found');
    members.push({ type: 'group', groupId: nested });
  } else {
    throw new Error('member type must be pubkey, contact, or group');
  }
  g.members = members;
  g.updatedAt = Date.now();
  await saveStore(hub.fs, st);
  return g;
}

async function removeGroupMember (hub, groupId, index) {
  const st = loadStore(hub.fs);
  const gid = String(groupId || '').trim();
  if (!GROUP_ID_RE.test(gid) || !hasStoreKey(st.groups, gid)) throw new Error('group not found');
  const g = st.groups[gid];
  if (!g) throw new Error('group not found');
  const members = Array.isArray(g.members) ? g.members : [];
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= members.length) throw new Error('invalid member index');
  members.splice(i, 1);
  g.members = members;
  g.updatedAt = Date.now();
  await saveStore(hub.fs, st);
  return g;
}

const COMPRESSED_PUBKEY_HEX_RE = /^0[23][0-9a-fA-F]{64}$/;

/**
 * Create a new collaboration group or replace an existing group’s members with the same
 * compressed validator pubkeys used for distributed federation (single deposit / vault story).
 */
async function upsertCollaborationGroupFromFederationValidators (hub, body) {
  const raw = Array.isArray(body.validators) ? body.validators : [];
  const normalized = [];
  const seen = new Set();
  for (const h of raw) {
    const n = normalizeSecpPublicKey(String(h || '').trim());
    if (!n.ok) throw new Error(n.message);
    if (!COMPRESSED_PUBKEY_HEX_RE.test(n.compressedHex)) {
      throw new Error('each validator must be a 33-byte compressed secp256k1 public key (02/03…)');
    }
    const key = n.compressedHex.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(n.compressedHex);
  }
  normalized.sort((a, b) => Buffer.from(a, 'hex').compare(Buffer.from(b, 'hex')));
  if (!normalized.length) throw new Error('validators array required');

  let thr = Number(body.threshold);
  if (!Number.isFinite(thr) || thr < 1) thr = 1;
  if (thr > normalized.length) thr = normalized.length;

  const groupId = body.groupId ? String(body.groupId).trim() : '';
  if (groupId) {
    if (!GROUP_ID_RE.test(groupId)) throw new Error('group not found');
    const st = loadStore(hub.fs);
    if (!hasStoreKey(st.groups, groupId)) throw new Error('group not found');
    const g = st.groups[groupId];
    if (!g) throw new Error('group not found');
    const members = Array.isArray(g.members) ? g.members : [];
    for (const m of members) {
      const t = String(m.type || '').toLowerCase();
      if (t !== 'pubkey') {
        throw new Error('Cannot replace members: group contains contacts or nested groups. Remove them first or create a new group.');
      }
    }
    let clearGuard = 0;
    const maxRemovals = 5000;
    while (clearGuard < maxRemovals) {
      const cur = loadStore(hub.fs).groups[groupId];
      const len = Array.isArray(cur && cur.members) ? cur.members.length : 0;
      if (!len) break;
      clearGuard++;
      await removeGroupMember(hub, groupId, 0);
    }
    if (clearGuard >= maxRemovals) {
      throw new Error('Could not clear group members: aborting');
    }
    const patch = { threshold: thr };
    if (body.name != null && String(body.name).trim()) {
      patch.name = String(body.name).trim().slice(0, 200);
    }
    await updateGroup(hub, groupId, patch);
    for (const pk of normalized) {
      await addGroupMember(hub, groupId, { type: 'pubkey', publicKeyHex: pk });
    }
    const group = await getGroup(hub, groupId);
    return { groupId, updated: true, group };
  }

  const name = body.name != null && String(body.name).trim()
    ? String(body.name).trim().slice(0, 200)
    : 'Federation validators';
  const created = await createGroup(hub, { name, threshold: thr });
  for (const pk of normalized) {
    await addGroupMember(hub, created.id, { type: 'pubkey', publicKeyHex: pk });
  }
  const group = await getGroup(hub, created.id);
  return { groupId: created.id, updated: false, group };
}

async function multisigPreview (hub, groupId) {
  const st = loadStore(hub.fs);
  const k = String(groupId || '').trim();
  if (!GROUP_ID_RE.test(k) || !hasStoreKey(st.groups, k)) throw new Error('group not found');
  const { xOnlyHexList, missing } = flattenGroupPubkeys(st, k);
  const g = st.groups[k];
  const m = Math.max(1, Math.min(xOnlyHexList.length || 1, Number(g.threshold || 1)));
  const fingerprint = xOnlyHexList.length ? policyFingerprint(m, xOnlyHexList) : null;
  let receiveAddress = '';
  let receiveScriptHex = '';
  let receiveDescriptor = '';
  let receiveReady = false;
  let federationPolicy = {
    ready: false,
    validatorsCompressedSorted: [],
    threshold: m,
    vaultAddress: '',
    note: 'Complete group key material to derive federation policy.'
  };
  if (xOnlyHexList.length && !missing.length) {
    try {
      const tapscript = buildThresholdTapscriptFromXOnly(xOnlyHexList, m);
      const netName = resolveHubBitcoinNetworkName(hub);
      const pay = bitcoin.payments.p2tr({
        internalPubkey: TAPROOT_INTERNAL_NUMS,
        scriptTree: { output: tapscript },
        network: networkForFabricName(netName)
      });
      receiveAddress = pay && pay.address ? String(pay.address) : '';
      receiveScriptHex = tapscript.toString('hex');
      receiveDescriptor = descriptorForThresholdPolicy(m, xOnlyHexList);
      receiveReady = !!receiveAddress;
    } catch (_) {}
    try {
      const validatorsCompressedSorted = compressedValidatorsFromXOnly(xOnlyHexList);
      const vault = buildFederationVaultFromPolicy({
        validatorPubkeysHex: validatorsCompressedSorted,
        threshold: m,
        networkName: resolveHubBitcoinNetworkName(hub)
      });
      federationPolicy = {
        ready: true,
        validatorsCompressedSorted,
        threshold: m,
        vaultAddress: vault && vault.address ? String(vault.address) : '',
        note: 'This group can be applied directly as the distributed federation validator policy.'
      };
    } catch (e) {
      federationPolicy = {
        ready: false,
        validatorsCompressedSorted: [],
        threshold: m,
        vaultAddress: '',
        note: e && e.message ? e.message : 'Could not derive federation policy from this group.'
      };
    }
  }
  return {
    groupId: k,
    threshold: m,
    uniquePubkeys: xOnlyHexList.length,
    xOnlyPubkeysSorted: xOnlyHexList,
    missing,
    policyFingerprint: fingerprint,
    receiveReady,
    receiveAddress,
    receiveScriptHex,
    receiveDescriptor,
    federationPolicy,
    schnorrCompatibility: {
      profile: 'BIP340/341/342',
      keyEncoding: 'x-only pubkeys, lexicographically sorted',
      spendPolicy: xOnlyHexList.length > 1 ? 'OP_CHECKSIGADD threshold tapscript' : 'single-key OP_CHECKSIG tapscript',
      references: [
        'https://blog.blockstream.com/reducing-bitcoin-transaction-sizes-with-x-only-pubkeys/',
        'https://bips.dev/342/'
      ]
    },
    note: receiveReady
      ? 'Address derived with Taproot script path semantics compatible with BIP340/341/342.'
      : 'Add valid group pubkeys to generate a Taproot receive address.'
  };
}

function registerHttp (hub) {
  const json = (req, res, fn) => {
    return hub.http.jsonOnly(req, res, fn);
  };

  hub.http._addRoute('GET', '/services/collaboration', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const st = loadStore(hub.fs);
    res.json({
      status: 'success',
      storePath: STORE_PATH,
      counts: {
        contacts: Object.keys(st.contacts).length,
        invitations: Object.keys(st.invitations).length,
        groups: Object.keys(st.groups).length
      }
    });
  }));

  hub.http._addRoute('GET', '/services/collaboration/contacts', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    res.json({ status: 'success', contacts: await listContacts(hub) });
  }));

  hub.http._addRoute('POST', '/services/collaboration/contacts', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const c = await addContact(hub, req.body || {});
    res.json({ status: 'success', contact: c });
  }));

  hub.http._addRoute('DELETE', '/services/collaboration/contacts/:id', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    await deleteContact(hub, req.params.id);
    res.json({ status: 'success' });
  }));

  hub.http._addRoute('GET', '/services/collaboration/invitations', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    res.json({ status: 'success', invitations: await listInvitations(hub) });
  }));

  hub.http._addRoute('POST', '/services/collaboration/invitations', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const out = await createInvitation(hub, req.body || {});
    res.json({ status: 'success', invitation: out });
  }));

  /* Public claim/decline (query token) — register before /invitations/:id */
  hub.http._addRoute('GET', '/services/collaboration/invitations/claim', (req, res) => json(req, res, async () => {
    const id = String(req.query.id || '').trim();
    const token = String(req.query.token || '').trim();
    const out = await acceptInvitation(hub, id, token);
    if (!out.valid && out.ok !== true) return res.status(400).json({ status: 'error', ...out });
    res.json({ status: 'success', result: out });
  }));

  hub.http._addRoute('GET', '/services/collaboration/invitations/decline', (req, res) => json(req, res, async () => {
    const id = String(req.query.id || '').trim();
    const token = String(req.query.token || '').trim();
    const v = await verifyInvitationToken(hub, id, token);
    if (!v.valid) return res.status(400).json({ status: 'error', ...v });
    const out = await declineInvitation(hub, id, token);
    res.json({ status: 'success', result: out });
  }));

  hub.http._addRoute('DELETE', '/services/collaboration/invitations/:id', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    await deleteInvitation(hub, req.params.id);
    res.json({ status: 'success' });
  }));

  hub.http._addRoute('GET', '/services/collaboration/groups', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    res.json({ status: 'success', groups: await listGroups(hub) });
  }));

  hub.http._addRoute('POST', '/services/collaboration/groups', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const g = await createGroup(hub, req.body || {});
    res.json({ status: 'success', group: g });
  }));

  hub.http._addRoute('GET', '/services/collaboration/groups/:id/multisig-preview', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    res.json({ status: 'success', preview: await multisigPreview(hub, req.params.id) });
  }));

  hub.http._addRoute('GET', '/services/collaboration/groups/:id', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    res.json({ status: 'success', group: await getGroup(hub, req.params.id) });
  }));

  hub.http._addRoute('PATCH', '/services/collaboration/groups/:id', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const g = await updateGroup(hub, req.params.id, req.body || {});
    res.json({ status: 'success', group: g });
  }));

  hub.http._addRoute('DELETE', '/services/collaboration/groups/:id', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    await deleteGroup(hub, req.params.id);
    res.json({ status: 'success' });
  }));

  hub.http._addRoute('POST', '/services/collaboration/groups/:id/members', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const g = await addGroupMember(hub, req.params.id, req.body || {});
    res.json({ status: 'success', group: g });
  }));

  hub.http._addRoute('DELETE', '/services/collaboration/groups/:id/members/:index', (req, res) => json(req, res, async () => {
    if (!verifyAdminRequest(hub, req, res)) return;
    const g = await removeGroupMember(hub, req.params.id, req.params.index);
    res.json({ status: 'success', group: g });
  }));
}

function registerRpc (hub) {
  const admin = (params) => {
    const p = params && params[0] && typeof params[0] === 'object' ? params[0] : {};
    const token = String(p.adminToken || '').trim();
    if (!hub.setup || !hub.setup.verifyAdminToken(token)) {
      return { status: 'error', message: 'Admin token required' };
    }
    return { ok: true, p };
  };

  hub.http._registerMethod('ListCollaborationContacts', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    return { type: 'ListCollaborationContactsResult', status: 'success', contacts: await listContacts(hub) };
  });

  hub.http._registerMethod('AddCollaborationContact', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const c = await addContact(hub, a.p);
      return { type: 'AddCollaborationContactResult', status: 'success', contact: c };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('RemoveCollaborationContact', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const id = String(a.p.id || '').trim();
      await deleteContact(hub, id);
      return { type: 'RemoveCollaborationContactResult', status: 'success' };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('ListCollaborationInvitations', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    return { type: 'ListCollaborationInvitationsResult', status: 'success', invitations: await listInvitations(hub) };
  });

  hub.http._registerMethod('CreateCollaborationInvitation', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const invitation = await createInvitation(hub, a.p);
      return { type: 'CreateCollaborationInvitationResult', status: 'success', invitation };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('RemoveCollaborationInvitation', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      await deleteInvitation(hub, String(a.p.id || '').trim());
      return { type: 'RemoveCollaborationInvitationResult', status: 'success' };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('ListCollaborationGroups', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    return { type: 'ListCollaborationGroupsResult', status: 'success', groups: await listGroups(hub) };
  });

  hub.http._registerMethod('CreateCollaborationGroup', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const group = await createGroup(hub, a.p);
      return { type: 'CreateCollaborationGroupResult', status: 'success', group };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('GetCollaborationGroup', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const group = await getGroup(hub, String(a.p.id || '').trim());
      return { type: 'GetCollaborationGroupResult', status: 'success', group };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('UpdateCollaborationGroup', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const id = String(a.p.id || '').trim();
      const group = await updateGroup(hub, id, a.p);
      return { type: 'UpdateCollaborationGroupResult', status: 'success', group };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('DeleteCollaborationGroup', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      await deleteGroup(hub, String(a.p.id || '').trim());
      return { type: 'DeleteCollaborationGroupResult', status: 'success' };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('AddCollaborationGroupMember', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const groupId = String(a.p.groupId || '').trim();
      const group = await addGroupMember(hub, groupId, a.p);
      return { type: 'AddCollaborationGroupMemberResult', status: 'success', group };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('RemoveCollaborationGroupMember', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const groupId = String(a.p.groupId || '').trim();
      const index = Number(a.p.index);
      const group = await removeGroupMember(hub, groupId, index);
      return { type: 'RemoveCollaborationGroupMemberResult', status: 'success', group };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('GetCollaborationGroupMultisigPreview', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const preview = await multisigPreview(hub, String(a.p.groupId || a.p.id || '').trim());
      return { type: 'GetCollaborationGroupMultisigPreviewResult', status: 'success', preview };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });

  hub.http._registerMethod('UpsertCollaborationGroupFromFederationValidators', async (...params) => {
    const a = admin(params);
    if (!a.ok) return a;
    try {
      const out = await upsertCollaborationGroupFromFederationValidators(hub, a.p || {});
      return {
        type: 'UpsertCollaborationGroupFromFederationValidatorsResult',
        status: 'success',
        groupId: out.groupId,
        updated: out.updated,
        group: out.group
      };
    } catch (e) {
      return { status: 'error', message: e.message || String(e) };
    }
  });
}

module.exports = {
  STORE_PATH,
  loadStore,
  saveStore,
  emptyStore,
  normalizeSecpPublicKey,
  flattenGroupPubkeys,
  policyFingerprint,
  upsertCollaborationGroupFromFederationValidators,
  registerHttp,
  registerRpc
};
