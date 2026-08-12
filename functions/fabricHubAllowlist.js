'use strict';

/**
 * Hub origin allowlist. Prefer `@fabric/http/functions/fabricHubAllowlist`.
 * Falls back when the published http package lags.
 */
try {
  module.exports = require('@fabric/http/functions/fabricHubAllowlist');
} catch (_) {
  const DEFAULT_FABRIC_HUB_ORIGINS = [
    'https://hub.fabric.pub',
    'http://hub.fabric.pub',
    'https://relay.goon.vc',
    'http://relay.goon.vc',
    'https://goon.vc',
    'http://goon.vc'
  ];

  function normalizeHubOrigin (raw) {
    try {
      const u = new URL(String(raw || '').trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return `${u.protocol}//${u.host}`;
    } catch (__) {
      return null;
    }
  }

  function isLoopbackHubOrigin (origin) {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch (__) {
      return false;
    }
  }

  function allowlistFromEnv (env = process.env) {
    const raw = env.FABRIC_HUB_ALLOWLIST || '';
    return String(raw).split(',')
      .map((s) => normalizeHubOrigin(s))
      .filter(Boolean);
  }

  function isAllowedFabricHub (hubBase, opts = {}) {
    const origin = normalizeHubOrigin(hubBase);
    if (!origin) return false;
    if (opts.allowLoopback !== false && isLoopbackHubOrigin(origin)) return true;
    const allowed = new Set([
      ...DEFAULT_FABRIC_HUB_ORIGINS.map(normalizeHubOrigin).filter(Boolean),
      ...allowlistFromEnv(opts.env || process.env),
      ...(Array.isArray(opts.extra) ? opts.extra.map(normalizeHubOrigin).filter(Boolean) : [])
    ]);
    return allowed.has(origin);
  }

  function assertAllowedFabricHub (hubBase, opts = {}) {
    const origin = normalizeHubOrigin(hubBase);
    if (!origin) return { ok: false, error: 'invalid hub origin' };
    if (!isAllowedFabricHub(origin, opts)) {
      return {
        ok: false,
        error: `hub origin not allowed: ${origin} (set FABRIC_HUB_ALLOWLIST to add trusted hubs)`
      };
    }
    return { ok: true, hubBase: origin };
  }

  module.exports = {
    DEFAULT_FABRIC_HUB_ORIGINS,
    normalizeHubOrigin,
    isLoopbackHubOrigin,
    allowlistFromEnv,
    isAllowedFabricHub,
    assertAllowedFabricHub
  };
}
