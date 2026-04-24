'use strict';

/**
 * Desktop / tooling probes in two families:
 *
 * 1. **HTTP** — `OPTIONS /` on one or more origins to read the target node’s HTTP **application** JSON
 *    (`@fabric/http` HTTPServer sends `{ name, description, resources }` where `resources` is the resource
 *    definition map — same contract early clients consumed via `@fabric/core` `Remote` (`types/remote.js`)
 *    `enumerate()` / `_OPTIONS('/')`).
 *    Optional future fields: top-level `services` (service definitions), `methods` (RPC names).
 * 2. **Fabric P2P** — TCP reachability + NOISE handshake on the Fabric listen port (default 7777).
 */

const { isSampleHubHttpServerOptions } = require('@fabric/http/sampleHubOptions');

const DEFAULT_OPTIONS_TIMEOUT_MS = 3500;
const DEFAULT_FABRIC_P2P_PORT = 7777;

function resourcesHaveServicesRoutes (resources) {
  if (!resources || typeof resources !== 'object') return false;
  for (const key of Object.keys(resources)) {
    const entry = resources[key];
    if (!entry || typeof entry !== 'object') continue;
    const routes = entry.routes;
    if (!routes || typeof routes !== 'object') continue;
    for (const rk of Object.keys(routes)) {
      const pathStr = routes[rk];
      if (typeof pathStr === 'string' && pathStr.startsWith('/services')) return true;
    }
  }
  return false;
}

function isFabricHubOptionsPayload (j) {
  if (!j || typeof j !== 'object') return false;
  if (isSampleHubHttpServerOptions(j)) return false;
  const name = String(j.name || '');
  if (name === 'hub.fabric.pub') return true;
  if (/fabric\s*hub/i.test(name) && j.resources && typeof j.resources === 'object') return true;
  if (resourcesHaveServicesRoutes(j.resources)) return true;
  return false;
}

/**
 * True when JSON matches `GET /settings` from this repo’s Hub (`{ success, settings, configured, needsSetup }`).
 * Used to avoid treating another HTTP server on loopback (OPTIONS looks Fabric-like) as the Hub.
 * @param {object|null} j
 * @returns {boolean}
 */
function isFabricHubSettingsListPayload (j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  if (j.success !== true) return false;
  const settings = j.settings;
  if (settings == null || typeof settings !== 'object' || Array.isArray(settings)) return false;
  if (typeof j.configured !== 'boolean' || typeof j.needsSetup !== 'boolean') return false;
  if (j.needsSetup !== !j.configured) return false;
  return true;
}

const DEFAULT_SETTINGS_GET_TIMEOUT_MS = 5000;

/**
 * @param {string} originBase — e.g. `http://127.0.0.1:8080`
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, status: number, error?: string, json?: object|null }>}
 */
async function probeHubSettingsList (originBase, options = {}) {
  const origin = normalizeOriginBase(originBase);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_SETTINGS_GET_TIMEOUT_MS;
  if (!origin) {
    return { ok: false, status: 0, error: 'invalid_origin' };
  }
  const url = new URL('/settings', `${origin}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, status: 0, error: 'invalid_origin' };
  }
  const ac = new AbortController();
  const extSignal = options.signal;
  const onExtAbort = () => {
    try {
      ac.abort();
    } catch (_) {}
  };
  if (extSignal) {
    if (extSignal.aborted) ac.abort();
    else extSignal.addEventListener('abort', onExtAbort, { once: true });
  }
  const tid = setTimeout(() => {
    try {
      ac.abort();
    } catch (_) {}
  }, timeoutMs);
  try {
    const res = await fetch(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ac.signal
    });
    clearTimeout(tid);
    if (extSignal) {
      try {
        extSignal.removeEventListener('abort', onExtAbort);
      } catch (_) {}
    }
    const text = await res.text();
    if (text && String(text).trim().startsWith('<')) {
      return { ok: false, status: res.status, error: 'html_body', json: null };
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    if (!res.ok || !isFabricHubSettingsListPayload(json)) {
      return {
        ok: false,
        status: res.status,
        error: 'not_hub_settings',
        json
      };
    }
    return { ok: true, status: res.status, json };
  } catch (e) {
    clearTimeout(tid);
    if (extSignal) {
      try {
        extSignal.removeEventListener('abort', onExtAbort);
      } catch (_) {}
    }
    return {
      ok: false,
      status: 0,
      error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message ? e.message : String(e))
    };
  }
}

/**
 * True when `definition` looks like an `@fabric/http` resource snapshot (routes map of path strings).
 * @param {object} definition
 * @returns {boolean}
 */
function looksLikeFabricResourceDefinition (definition) {
  if (!definition || typeof definition !== 'object') return false;
  const routes = definition.routes;
  if (!routes || typeof routes !== 'object') return false;
  return Object.values(routes).some((p) => typeof p === 'string' && p.startsWith('/'));
}

/**
 * True when JSON matches the Fabric HTTP `OPTIONS /` application shape well enough for harness tooling.
 * @param {object|null} j
 * @returns {boolean}
 */
function isFabricHttpApplicationPayload (j) {
  if (!j || typeof j !== 'object') return false;
  if (!j.resources || typeof j.resources !== 'object' || Array.isArray(j.resources)) return false;
  const keys = Object.keys(j.resources);
  if (keys.length === 0) return typeof j.name === 'string';
  return keys.some((k) => looksLikeFabricResourceDefinition(j.resources[k]));
}

/**
 * Normalize `OPTIONS /` JSON into resource and service-oriented structures for UI / codegen (cf. `Remote.enumerate`).
 * Returns `null` when the body does not look like an `@fabric/http` application document.
 * @param {object|null} json
 * @returns {{
 *   name: string,
 *   description: string,
 *   resources: object,
 *   resourceEntries: { key: string, definition: object }[],
 *   resourceNames: string[],
 *   services: object|null,
 *   serviceDefinitions: { resourceKey: string, routes: object, definition: object }[],
 *   rpcMethodNames: string[]|undefined
 * }|null}
 */
function extractFabricHttpApplicationFromOptions (json) {
  if (!isFabricHttpApplicationPayload(json)) return null;
  const name = json.name != null ? String(json.name) : '';
  const description = json.description != null ? String(json.description) : '';
  const resources = json.resources;
  const resourceEntries = Object.keys(resources).map((key) => ({
    key,
    definition: resources[key] && typeof resources[key] === 'object' ? resources[key] : {}
  }));
  let services = null;
  if (json.services && typeof json.services === 'object' && !Array.isArray(json.services)) {
    services = json.services;
  }
  const serviceDefinitions = [];
  for (const { key, definition } of resourceEntries) {
    const routes = definition.routes;
    if (!routes || typeof routes !== 'object') continue;
    const paths = Object.values(routes).filter((v) => typeof v === 'string');
    if (paths.some((p) => p.startsWith('/services'))) {
      serviceDefinitions.push({ resourceKey: key, routes, definition });
    }
  }
  const rpcMethodNames = [];
  if (Array.isArray(json.methods)) {
    for (const m of json.methods) {
      if (typeof m === 'string') rpcMethodNames.push(m);
      else if (m && typeof m.name === 'string') rpcMethodNames.push(m.name);
    }
  } else if (json.methods && typeof json.methods === 'object') {
    rpcMethodNames.push(...Object.keys(json.methods));
  }
  return {
    name,
    description,
    resources,
    resourceEntries,
    resourceNames: resourceEntries.map((e) => e.key),
    services,
    serviceDefinitions,
    rpcMethodNames: rpcMethodNames.length ? rpcMethodNames : undefined
  };
}

function normalizeOriginBase (originBase) {
  const base = String(originBase || '').trim().replace(/\/$/, '');
  if (!base) return '';
  try {
    const url = new URL('/', base.endsWith('/') ? base : `${base}/`);
    return url.origin;
  } catch (_) {
    return '';
  }
}

/**
 * HTTP probe: `OPTIONS /` and parse JSON body (Fabric HTTP node metadata when present).
 * @param {string} originBase — e.g. `http://127.0.0.1:8080`
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   origin: string,
 *   json: object|null,
 *   hubLike: boolean,
 *   fabricHttpLike: boolean,
 *   application: object|null,
 *   error?: string
 * }>}
 */
async function probeHttpInterface (originBase, options = {}) {
  const origin = normalizeOriginBase(originBase);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_OPTIONS_TIMEOUT_MS;
  if (!origin) {
    return {
      ok: false,
      status: 0,
      origin: String(originBase || ''),
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      error: 'invalid_origin'
    };
  }
  const url = new URL('/', `${origin}/`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      status: 0,
      origin: String(originBase || ''),
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      error: 'invalid_origin'
    };
  }
  const ac = new AbortController();
  const extSignal = options.signal;
  const onExtAbort = () => {
    try {
      ac.abort();
    } catch (_) {}
  };
  if (extSignal) {
    if (extSignal.aborted) ac.abort();
    else extSignal.addEventListener('abort', onExtAbort, { once: true });
  }
  const tid = setTimeout(() => {
    try {
      ac.abort();
    } catch (_) {}
  }, timeoutMs);
  try {
    const res = await fetch(url.href, {
      method: 'OPTIONS',
      headers: { Accept: 'application/json' },
      signal: ac.signal
    });
    clearTimeout(tid);
    if (extSignal) extSignal.removeEventListener('abort', onExtAbort);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    const application = extractFabricHttpApplicationFromOptions(json);
    const fabricHttpLike = !!application;
    const hubLike = res.ok && isFabricHubOptionsPayload(json);
    return {
      ok: res.ok,
      status: res.status,
      origin,
      json,
      hubLike,
      fabricHttpLike,
      application
    };
  } catch (e) {
    clearTimeout(tid);
    if (extSignal) {
      try {
        extSignal.removeEventListener('abort', onExtAbort);
      } catch (_) {}
    }
    return {
      ok: false,
      status: 0,
      origin,
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message ? e.message : String(e))
    };
  }
}

/**
 * Resolve origin strings for sequential HTTP probes.
 * @param {{ bases?: string[], host?: string, ports?: number[], protocol?: string }} opts
 * @returns {string[]}
 */
function resolveHttpProbeOrigins (opts = {}) {
  if (Array.isArray(opts.bases) && opts.bases.length) {
    return opts.bases.map((b) => String(b).trim()).filter(Boolean);
  }
  const host = String(opts.host || '127.0.0.1').trim() || '127.0.0.1';
  const protocol = String(opts.protocol || 'http').replace(/:$/, '') || 'http';
  const ports = Array.isArray(opts.ports) && opts.ports.length
    ? opts.ports.map((p) => Number(p)).filter((n) => n > 0 && Number.isFinite(n))
    : [];
  return ports.map((p) => `${protocol}://${host}:${p}`);
}

/**
 * HTTP probes: try each origin in order; stop early when one returns hub-like Fabric metadata.
 * @param {{ bases?: string[], host?: string, ports?: number[], protocol?: string, timeoutMs?: number, signal?: AbortSignal }} opts
 * @returns {Promise<{ attempts: Awaited<ReturnType<typeof probeHttpInterface>>[], hit: Awaited<ReturnType<typeof probeHttpInterface>>|null, httpBase: string }>}
 *   `httpBase` is the origin of `hit` if any, else the first attempted origin.
 */
async function probeHttpInterfaces (opts = {}) {
  const origins = resolveHttpProbeOrigins(opts);
  const timeoutMs = opts.timeoutMs;
  const signal = opts.signal;
  const attempts = [];
  let hit = null;
  let httpBase = '';
  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i];
    const r = await probeHttpInterface(origin, { timeoutMs, signal });
    attempts.push(r);
    if (i === 0) httpBase = r.origin || origin;
    if (r.ok && r.hubLike) {
      hit = r;
      httpBase = r.origin || origin;
      break;
    }
  }
  if (!httpBase && attempts.length) {
    httpBase = attempts[0].origin || origins[0] || '';
  }
  return { attempts, hit, httpBase };
}

function httpProbeToLegacySummary (r) {
  if (!r) {
    return {
      ok: false,
      status: 0,
      hubLike: false,
      fabricHttpLike: false,
      name: undefined,
      resourceKeyCount: 0,
      application: null
    };
  }
  const j = r.json;
  const app = r.application;
  return {
    ok: r.ok,
    status: r.status,
    hubLike: r.hubLike,
    fabricHttpLike: r.fabricHttpLike,
    name: j && j.name,
    resourceKeyCount: j && j.resources && typeof j.resources === 'object'
      ? Object.keys(j.resources).length
      : 0,
    resourceNames: app ? app.resourceNames : undefined,
    serviceDefinitionCount: app ? app.serviceDefinitions.length : undefined,
    rpcMethodNames: app && app.rpcMethodNames,
    error: r.error,
    json: r.json,
    origin: r.origin,
    application: app
  };
}

/**
 * @deprecated Prefer {@link probeHttpInterface}; kept for callers that expect the slimmer summary shape.
 */
async function fetchOptionsMetadata (originBase) {
  return httpProbeToLegacySummary(await probeHttpInterface(originBase));
}

function tcpProbeOpen (host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const net = require('net');
    const sock = net.createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.on('error', () => resolve(false));
  });
}

/**
 * Fabric P2P probe: optional TCP open check, then NOISE + session; success = `peer` event.
 * @param {{ host?: string, port?: number, tcpTimeoutMs?: number, handshakeTimeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, host: string, port: number, tcpOpen: boolean }>}
 */
async function probeFabricInterface (opts = {}) {
  const host = String(opts.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(opts.port) > 0 ? Number(opts.port) : DEFAULT_FABRIC_P2P_PORT;
  const tcpTimeoutMs = Number(opts.tcpTimeoutMs) > 0 ? Number(opts.tcpTimeoutMs) : 1500;
  const handshakeTimeoutMs = Number(opts.handshakeTimeoutMs) > 0 ? Number(opts.handshakeTimeoutMs) : 7000;

  const tcpOpen = await tcpProbeOpen(host, port, tcpTimeoutMs);
  if (!tcpOpen) {
    return { ok: false, reason: 'tcp_closed', host, port, tcpOpen: false };
  }

  const Peer = require('@fabric/core/types/peer');
  const peer = new Peer({
    listen: false,
    peersDb: null,
    networking: true,
    connectTimeout: Math.min(8000, handshakeTimeoutMs),
    constraints: { peers: { max: 8 } }
  });
  const handshake = await new Promise((resolve) => {
    let settled = false;
    const finish = async (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      try {
        await peer.stop();
      } catch (_) {}
      resolve(data);
    };
    const tid = setTimeout(() => finish({ ok: false, reason: 'timeout' }), handshakeTimeoutMs);
    peer.once('peer', () => finish({ ok: true, reason: 'peer_event' }));
    peer.once('error', (err) => {
      finish({ ok: false, reason: err && err.message ? err.message : String(err) });
    });
    try {
      peer.connectTo(`${host}:${port}`);
    } catch (e) {
      finish({ ok: false, reason: e && e.message ? e.message : String(e) });
    }
  });

  return {
    ok: handshake.ok,
    reason: handshake.reason,
    host,
    port,
    tcpOpen: true
  };
}

/**
 * @param {{
 *   httpPort?: number,
 *   httpPorts?: number[],
 *   httpHost?: string,
 *   httpProtocol?: string,
 *   httpBases?: string[],
 *   p2pHost?: string,
 *   p2pPort?: number
 * }} opts
 */
async function runDesktopHubStartupProbe (opts = {}) {
  const httpHost = opts.httpHost || '127.0.0.1';
  const primaryPort = Number(opts.httpPort) || 8080;
  const httpPorts = Array.isArray(opts.httpPorts) && opts.httpPorts.length
    ? opts.httpPorts.map(Number).filter((n) => n > 0)
    : [primaryPort];
  const httpProtocol = opts.httpProtocol || 'http';

  const { attempts, hit, httpBase } = await probeHttpInterfaces({
    bases: Array.isArray(opts.httpBases) && opts.httpBases.length ? opts.httpBases : undefined,
    host: httpHost,
    ports: httpPorts,
    protocol: httpProtocol
  });

  const httpProbe = httpProbeToLegacySummary(hit || (attempts.length ? attempts[attempts.length - 1] : null));

  const trustLoopbackWithoutSettings =
    process.env.FABRIC_DESKTOP_TRUST_LOOPBACK_HUB === '1' ||
    String(process.env.FABRIC_DESKTOP_TRUST_LOOPBACK_HUB || '').toLowerCase() === 'true';

  if (hit && hit.ok && hit.hubLike) {
    if (trustLoopbackWithoutSettings) {
      return {
        useExternalHub: true,
        httpBase,
        reason: 'http_options_hub_metadata_trust_loopback',
        httpProbe,
        fabricProbe: null,
        httpAttempts: attempts
      };
    }
    const settingsHit = await probeHubSettingsList(httpBase, { timeoutMs: DEFAULT_SETTINGS_GET_TIMEOUT_MS });
    if (settingsHit.ok) {
      return {
        useExternalHub: true,
        httpBase,
        reason: 'http_options_and_get_settings',
        httpProbe,
        settingsProbe: { ok: true, status: settingsHit.status },
        fabricProbe: null,
        httpAttempts: attempts
      };
    }
    try {
      // eslint-disable-next-line no-console
      console.warn(
        '[DESKTOP] Loopback looks Fabric-like (OPTIONS) but GET /settings is not this Hub’s API — starting embedded hub instead. Error:',
        settingsHit.error || settingsHit.status,
        'If a real Hub is on this port, set FABRIC_DESKTOP_TRUST_LOOPBACK_HUB=1 to skip this check, or free the port for the embedded hub.'
      );
    } catch (_) {}
  }

  const p2pHost = opts.p2pHost || '127.0.0.1';
  const p2pPort = Number(opts.p2pPort) > 0 ? Number(opts.p2pPort) : DEFAULT_FABRIC_P2P_PORT;
  const fabricProbe = await probeFabricInterface({
    host: p2pHost,
    port: p2pPort
  });

  return {
    useExternalHub: false,
    httpBase,
    reason: 'embed_hub_process',
    httpProbe,
    fabricProbe: fabricProbe.tcpOpen ? { ok: fabricProbe.ok, reason: fabricProbe.reason } : null,
    httpAttempts: attempts,
    fabricInterface: fabricProbe
  };
}

module.exports = {
  runDesktopHubStartupProbe,
  isFabricHubOptionsPayload,
  isFabricHubSettingsListPayload,
  isFabricHttpApplicationPayload,
  extractFabricHttpApplicationFromOptions,
  fetchOptionsMetadata,
  probeHttpInterface,
  probeHttpInterfaces,
  probeHubSettingsList,
  probeFabricInterface,
  resolveHttpProbeOrigins,
  normalizeOriginBase
};
