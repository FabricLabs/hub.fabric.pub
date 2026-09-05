'use strict';

/**
 * Hub origin allowlist. Prefer `@fabric/http/functions/fabricHubAllowlist`
 * when it supports HTTPS suffix tokens; otherwise use the local copy so
 * `FABRIC_HUB_ALLOWLIST=*.example.com` works before the http pin is bumped.
 */

function buildLocalAllowlist () {
  const DEFAULT_FABRIC_HUB_ORIGINS = [
    'https://hub.fabric.pub',
    'https://relay.goon.vc',
    'https://goon.vc'
  ];

  function normalizeHubOrigin (raw) {
    try {
      const u = new URL(String(raw || '').trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return `${u.protocol}//${u.host}`;
    } catch (_) {
      return null;
    }
  }

  function isLoopbackHubOrigin (origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch (_) {
      return false;
    }
  }

  function normalizeHttpsHostSuffix (raw) {
    let s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith('suffix:')) s = s.slice(7).trim();
    if (s.startsWith('*.')) s = s.slice(1);
    if (!s.startsWith('.')) s = `.${s}`;
    const labels = s.slice(1).split('.').filter(Boolean);
    if (labels.length < 2) return null;
    if (!/^\.[a-z0-9.-]+$/.test(s)) return null;
    if (s.includes('..')) return null;
    return s;
  }

  function parseAllowlistToken (token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('*.') || lower.startsWith('suffix:') || (lower.startsWith('.') && !lower.includes('://'))) {
      const suffix = normalizeHttpsHostSuffix(raw);
      if (!suffix) return null;
      return { kind: 'https-suffix', suffix };
    }
    const origin = normalizeHubOrigin(raw);
    if (!origin) return null;
    return { kind: 'origin', origin };
  }

  function parseAllowlistEntries (raw) {
    const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
    const out = [];
    for (const part of parts) {
      const entry = parseAllowlistToken(part);
      if (entry) out.push(entry);
    }
    return out;
  }

  function originMatchesAllowlistEntries (origin, entries) {
    if (!origin || !Array.isArray(entries) || !entries.length) return false;
    let host = '';
    let isHttps = false;
    try {
      const u = new URL(origin);
      host = u.hostname.toLowerCase();
      isHttps = u.protocol === 'https:';
    } catch (_) {
      return false;
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.kind === 'origin' && entry.origin === origin) return true;
      if (entry.kind === 'https-suffix' && isHttps && entry.suffix) {
        const suffix = entry.suffix;
        const bare = suffix.slice(1);
        if (host === bare || host.endsWith(suffix)) return true;
      }
    }
    return false;
  }

  function allowlistFromEnv (env = process.env) {
    const raw = env.FABRIC_HUB_ALLOWLIST || '';
    return String(raw).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }

  function isAllowedFabricHub (hubBase, opts = {}) {
    const origin = normalizeHubOrigin(hubBase);
    if (!origin) return false;
    if (opts.allowLoopback !== false && isLoopbackHubOrigin(origin)) return true;
    const env = Object.prototype.hasOwnProperty.call(opts, 'env')
      ? (opts.env || {})
      : process.env;
    const entries = [
      ...parseAllowlistEntries(DEFAULT_FABRIC_HUB_ORIGINS),
      ...parseAllowlistEntries(allowlistFromEnv(env)),
      ...parseAllowlistEntries(opts.extra)
    ];
    return originMatchesAllowlistEntries(origin, entries);
  }

  function assertAllowedFabricHub (hubBase, opts = {}) {
    const origin = normalizeHubOrigin(hubBase);
    if (!origin) return { ok: false, error: 'invalid hub origin' };
    if (!isAllowedFabricHub(origin, opts)) {
      return {
        ok: false,
        error: `hub origin not allowed: ${origin} (set FABRIC_HUB_ALLOWLIST or opts.extra; HTTPS suffixes via *.example.com)`
      };
    }
    return { ok: true, hubBase: origin };
  }

  return {
    DEFAULT_FABRIC_HUB_ORIGINS,
    normalizeHubOrigin,
    isLoopbackHubOrigin,
    normalizeHttpsHostSuffix,
    parseAllowlistToken,
    parseAllowlistEntries,
    originMatchesAllowlistEntries,
    allowlistFromEnv,
    isAllowedFabricHub,
    assertAllowedFabricHub
  };
}

try {
  const upstream = require('@fabric/http/functions/fabricHubAllowlist');
  if (typeof upstream.normalizeHttpsHostSuffix === 'function') {
    module.exports = upstream;
  } else {
    module.exports = buildLocalAllowlist();
  }
} catch (_) {
  module.exports = buildLocalAllowlist();
}
