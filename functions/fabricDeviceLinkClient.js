'use strict';

/**
 * Browser/Electron helpers for mutual device-link HTTP flow.
 * Signing is left to the caller (unlocked Key / IPC).
 *
 * Must NOT require the Hub server module (`fabricDeviceLink.js`) — that pulls
 * Node `http` via fabricDesktopAuth/httpSpaShell and breaks the SPA webpack bundle.
 */

const {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  parseDeviceLinkMessage
} = require('./fabricDeviceLinkMessages');

function deviceLinkHeaders (origin) {
  const o = String(origin || '').replace(/\/$/, '');
  const h = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (o) {
    h.Origin = o;
    h.Referer = `${o}/`;
  }
  return h;
}

/**
 * @param {object} opts
 * @param {string} opts.hubBase
 * @param {string} opts.origin
 * @param {string} opts.label
 * @param {{ id: string, xpub: string }} opts.identity
 * @param {string} opts.pubkeyHex
 * @param {string} opts.signature — BIP340 over buildDeviceLinkOfferMessage(...)
 * @param {typeof fetch} [opts.fetchImpl]
 */
async function createDeviceLinkOffer (opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const hubBase = String(opts.hubBase || '').replace(/\/$/, '');
  const origin = opts.origin || hubBase;
  const res = await fetchImpl(`${hubBase}/device-links`, {
    method: 'POST',
    headers: deviceLinkHeaders(origin),
    body: JSON.stringify({
      origin,
      label: opts.label || 'device',
      nonce: opts.nonce || undefined,
      identity: opts.identity,
      pubkeyHex: opts.pubkeyHex,
      signature: opts.signature
    }),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

async function fetchDeviceLinkSession (hubBase, sessionId, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const origin = opts.origin || base;
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}`, {
    headers: deviceLinkHeaders(origin),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

async function postDeviceLinkSignature (hubBase, sessionId, body, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const base = String(hubBase || '').replace(/\/$/, '');
  const origin = opts.origin || base;
  const res = await fetchImpl(`${base}/device-links/${encodeURIComponent(sessionId)}/signatures`, {
    method: 'POST',
    headers: deviceLinkHeaders(origin),
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, status: res.status, error: (data && data.error) || `HTTP ${res.status}` };
  }
  return { ok: true, ...data };
}

module.exports = {
  DEVICE_LINK_PREFIX,
  buildDeviceLinkOfferMessage,
  buildDeviceLinkMessage,
  parseDeviceLinkMessage,
  createDeviceLinkOffer,
  fetchDeviceLinkSession,
  postDeviceLinkSignature,
  deviceLinkHeaders
};
