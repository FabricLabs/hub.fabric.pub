'use strict';

const DEFAULT_FABRIC_P2P_PORT = 7777;
const DEFAULT_MESH_MAX_WEBRTC_PEERS = 32;

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLoopbackHost (host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * Canonical `http(s)://host[:port]` origin, or empty string.
 * @param {string} originBase
 * @returns {string}
 */
function normalizeHttpOrigin (originBase) {
  const raw = String(originBase || '').trim();
  if (!raw) return '';
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

/**
 * @param {string} host
 * @param {number} [port]
 * @returns {string}
 */
function formatFabricListen (host, port) {
  const h = String(host || '').trim();
  if (!h) return '';
  const p = Number(port);
  const listenPort = Number.isFinite(p) && p > 0 ? p : DEFAULT_FABRIC_P2P_PORT;
  if (h.indexOf(':') >= 0 && h.charAt(0) !== '[') {
    return `[${h}]:${listenPort}`;
  }
  return `${h}:${listenPort}`;
}

/**
 * @param {string} fabricListen
 * @returns {{ host: string, port: number }|null}
 */
function parseFabricListen (fabricListen) {
  const raw = String(fabricListen || '').trim();
  if (!raw) return null;
  const at = raw.lastIndexOf('@');
  const hostport = at >= 0 ? raw.slice(at + 1) : raw;
  try {
    const url = new URL(`tcp://${hostport}`);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : DEFAULT_FABRIC_P2P_PORT;
    if (!host || !Number.isFinite(port) || port <= 0) return null;
    return { host, port };
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} httpOrigin
 * @returns {string}
 */
function inferFabricListenFromHttp (httpOrigin) {
  const origin = normalizeHttpOrigin(httpOrigin);
  if (!origin) return '';
  try {
    const url = new URL(origin);
    return formatFabricListen(url.hostname, DEFAULT_FABRIC_P2P_PORT);
  } catch (_) {
    return '';
  }
}

/**
 * @param {string} fabricListen
 * @returns {string}
 */
function inferHttpOriginFromFabric (fabricListen) {
  const parsed = parseFabricListen(fabricListen);
  if (!parsed) return '';
  if (isLoopbackHost(parsed.host)) {
    return `http://${parsed.host}:8080`;
  }
  return `https://${parsed.host}`;
}

/**
 * @param {*} entry
 * @returns {{ http: string, fabric: string, raw: * }|null}
 */
function parseFabricHubSeedEntry (entry) {
  if (entry == null || entry === '') return null;
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    const http = normalizeHttpOrigin(entry.http || entry.origin || entry.authority || '');
    const fabric = String(entry.fabric || entry.peer || entry.p2p || '').trim();
    const parsedFabric = parseFabricListen(fabric);
    const fabricNorm = parsedFabric
      ? formatFabricListen(parsedFabric.host, parsedFabric.port)
      : fabric;
    if (!http && !fabricNorm) return null;
    return {
      http: http || inferHttpOriginFromFabric(fabricNorm),
      fabric: fabricNorm || inferFabricListenFromHttp(http),
      raw: entry
    };
  }

  const raw = String(entry).trim();
  if (!raw) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) || raw.indexOf('/') >= 0) {
    const http = normalizeHttpOrigin(raw);
    if (!http) return null;
    return { http, fabric: inferFabricListenFromHttp(http), raw };
  }

  const fabricParsed = parseFabricListen(raw);
  if (fabricParsed && fabricParsed.port === DEFAULT_FABRIC_P2P_PORT) {
    const fabric = formatFabricListen(fabricParsed.host, fabricParsed.port);
    return { http: inferHttpOriginFromFabric(fabric), fabric, raw };
  }

  const http = normalizeHttpOrigin(raw);
  if (!http) return null;
  return { http, fabric: inferFabricListenFromHttp(http), raw };
}

/**
 * @param {string} text
 * @returns {Array}
 */
function splitSeedListString (text) {
  return String(text || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {object} [source]
 * @param {object} [source.window]
 * @param {string} [source.envSeeds]
 * @returns {{ http: string, fabric: string, raw: * }[]}
 */
function collectFabricHubSeeds (source = {}) {
  const win = source.window || (typeof window !== 'undefined' ? window : null);
  let envSeeds = source.envSeeds;
  if (envSeeds == null) {
    try {
      if (typeof process !== 'undefined' && process.env && process.env.FABRIC_HUB_SEEDS) {
        envSeeds = process.env.FABRIC_HUB_SEEDS;
      }
    } catch (_) {
      envSeeds = '';
    }
  }

  const entries = [];
  if (win && Array.isArray(win.FABRIC_HUB_SEEDS)) {
    entries.push(...win.FABRIC_HUB_SEEDS);
  } else if (win && typeof win.FABRIC_HUB_SEEDS === 'string') {
    entries.push(...splitSeedListString(win.FABRIC_HUB_SEEDS));
  }
  if (envSeeds) {
    entries.push(...splitSeedListString(envSeeds));
  }
  if (win && win.FABRIC_EDGE_AUTHORITY) {
    entries.push(win.FABRIC_EDGE_AUTHORITY);
  }

  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const parsed = parseFabricHubSeedEntry(entry);
    if (!parsed || !parsed.http) continue;
    const key = parsed.http.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}

/**
 * Browser mixed-content: an HTTPS page cannot talk to http:// seeds.
 * @param {string} httpOrigin
 * @param {string} [pageProtocol] `http:` or `https:`
 * @returns {boolean}
 */
function isMixedContentSeed (httpOrigin, pageProtocol) {
  const origin = normalizeHttpOrigin(httpOrigin);
  if (!origin) return true;
  const page = String(pageProtocol || (typeof window !== 'undefined' && window.location && window.location.protocol) || '');
  if (page !== 'https:') return false;
  try {
    return new URL(origin).protocol === 'http:';
  } catch (_) {
    return true;
  }
}

/**
 * First OPTIONS-capable seed the browser can reach for WebSocket / JSON-RPC signaling.
 * @param {Array} probes
 * @param {object} [opts]
 * @param {string} [opts.pageProtocol]
 * @returns {{ http: string, fabric: string }|null}
 */
function pickPrimarySignalingSeed (probes, opts = {}) {
  const pageProtocol = opts.pageProtocol;
  const list = Array.isArray(probes) ? probes : [];
  const reachable = list.filter((p) => {
    if (!p || !p.seed || !p.seed.http) return false;
    if (isMixedContentSeed(p.seed.http, pageProtocol)) return false;
    return !!(p.hubLike || (p.features && p.features.webrtc));
  });
  if (reachable.length === 0) return null;
  return reachable[0].seed;
}

/**
 * @param {number} seedCount
 * @returns {number}
 */
function recommendedMaxWebrtcPeers (seedCount) {
  const n = Number(seedCount);
  const extra = Number.isFinite(n) && n > 0 ? n * 8 : 0;
  return Math.max(5, Math.min(64, DEFAULT_MESH_MAX_WEBRTC_PEERS + extra));
}

module.exports = {
  DEFAULT_FABRIC_P2P_PORT,
  DEFAULT_MESH_MAX_WEBRTC_PEERS,
  isLoopbackHost,
  normalizeHttpOrigin,
  formatFabricListen,
  parseFabricListen,
  inferFabricListenFromHttp,
  inferHttpOriginFromFabric,
  parseFabricHubSeedEntry,
  collectFabricHubSeeds,
  isMixedContentSeed,
  pickPrimarySignalingSeed,
  recommendedMaxWebrtcPeers
};
