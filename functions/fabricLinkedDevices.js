'use strict';

/**
 * Browser-local linked-device roster + IdentityCrossSign publish/revoke.
 * Pairing remains /device-links; this is the network-visible BIP340 proof.
 */

const Key = require('@fabric/core/types/key');
const {
  readStorageJSON,
  writeStorageJSON
} = require('./fabricBrowserState');
const { signCrossSign } = require('./identityCrossSignVerify');
const { REVOKE_TYPE } = require('./identityCrossSign');

const STORAGE_LINKED_DEVICES = 'fabric.linkedDevices';

function readLinkedDevices () {
  try {
    if (typeof window === 'undefined') return [];
    const j = readStorageJSON(STORAGE_LINKED_DEVICES, []);
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function writeLinkedDevices (list) {
  try {
    if (typeof window === 'undefined') return;
    writeStorageJSON(STORAGE_LINKED_DEVICES, Array.isArray(list) ? list : []);
  } catch (e) { /* ignore */ }
}

function mergeLinkedDevice (entry) {
  try {
    if (typeof window === 'undefined' || !entry) return;
    let list = readLinkedDevices();
    if (entry.peerFabricId) {
      list = list.filter((d) => !(d && d.peerFabricId === entry.peerFabricId));
    } else {
      list = list.filter((d) => !(d && d.kind === entry.kind && d.hubOrigin === entry.hubOrigin));
    }
    list.push(entry);
    writeLinkedDevices(list);
  } catch (e) { /* ignore */ }
}

function peerIdOf (device) {
  if (!device || typeof device !== 'object') return '';
  return String(device.peerFabricId || device.pubkey || device.id || device.peerPubkey || '');
}

function removeLinkedDevice (peerFabricId) {
  const id = String(peerFabricId || '');
  const next = readLinkedDevices().filter((d) => peerIdOf(d) !== id);
  writeLinkedDevices(next);
  return next;
}

async function publishHubIdentityCrossSign (key, peerPubkey, nonce, kind) {
  if (!peerPubkey || !nonce) return { ok: false, error: 'peerPubkey and nonce required' };
  try {
    const obj = signCrossSign(key, { peerPubkey, nonce }, kind);
    const res = await fetch('/identity/cross-sign', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
      cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

function unlockedHubKey () {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const unlocked = JSON.parse(window.sessionStorage.getItem('fabric.identity.unlocked') || 'null');
    if (!unlocked || !unlocked.xprv) return null;
    return new Key({ xprv: unlocked.xprv });
  } catch (_) {
    return null;
  }
}

/**
 * Publish IdentityCrossSignRevoke then drop the local roster row.
 * @param {object} device linked-device row
 * @param {object} [keyOpt] unlocked Fabric Key (IdentityManager); else session unlock
 */
async function revokeLinkedDevice (device, keyOpt) {
  const peerPubkey = device && (device.peerPubkey || device.pubkey);
  const nonce = device && device.nonce;
  const peerFabricId = peerIdOf(device);
  if (!nonce || !peerPubkey) {
    return { ok: false, error: 'No pairing nonce — complete fabric://link again before revoking.' };
  }
  const key = keyOpt || unlockedHubKey();
  if (!key) {
    return { ok: false, error: 'Unlock your Fabric identity before revoking a device.' };
  }
  const posted = await publishHubIdentityCrossSign(key, peerPubkey, nonce, REVOKE_TYPE);
  if (!posted.ok) return posted;
  removeLinkedDevice(peerFabricId);
  return { ok: true };
}

module.exports = {
  STORAGE_LINKED_DEVICES,
  readLinkedDevices,
  writeLinkedDevices,
  mergeLinkedDevice,
  removeLinkedDevice,
  peerIdOf,
  publishHubIdentityCrossSign,
  unlockedHubKey,
  revokeLinkedDevice
};
