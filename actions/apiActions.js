'use strict';

const fetch = require('node-fetch');

/** Reject protocol-relative and cross-origin absolute URLs (Codacy / SSRF hygiene for client-side fetch). */
function assertClientFetchPath (input) {
  const s = String(input || '');
  if (!s) throw new TypeError('path required');
  if (s.startsWith('//')) throw new TypeError('protocol-relative URL refused');
  if (/^https?:\/\//i.test(s)) {
    if (typeof window === 'undefined' || !window.location) return s;
    const u = new URL(s, window.location.href);
    if (u.origin !== window.location.origin) {
      throw new TypeError('cross-origin URL refused');
    }
  }
  return s;
}

async function fetchFromAPI (path, params = {},token = null) {
  const safe = assertClientFetchPath(path);
  const response = await fetch(safe, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': (token) ? `Bearer ${token}` : undefined
    }
  });

  return await response.json();
}

async function patchAPI (path, params, token = null) {
  const safe = assertClientFetchPath(path);
  const response = await fetch(safe, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': (token) ? `Bearer ${token}` : undefined
    },
    body: JSON.stringify([
      { op: 'replace', path: '/', value: params }
    ])
  });

  return await response.json();
}

async function postAPI (path, params, token = null) {
  const safe = assertClientFetchPath(path);
  const response = await fetch(safe, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': (token) ? `Bearer ${token}` : undefined
    },
    body: params
  });

  return await response.json();
}

module.exports = {
  fetchFromAPI,
  patchAPI,
  postAPI
};
