'use strict';

const {
  isFabricHubOptionsPayload,
  isFabricHttpApplicationPayload,
  extractFabricHttpApplicationFromOptions,
  fabricHubOptionsFeatures
} = require('./fabricHttpOptions');
const { normalizeHttpOrigin, isMixedContentSeed } = require('./fabricHubSeeds');

const DEFAULT_OPTIONS_TIMEOUT_MS = 3500;

/**
 * @param {number} [timeoutMs]
 * @returns {{ controller: AbortController, cancel: Function }}
 */
function abortAfter (timeoutMs) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_OPTIONS_TIMEOUT_MS;
  let timer = null;
  if (controller && typeof setTimeout === 'function') {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
    }, ms);
  }
  return {
    controller,
    cancel: () => {
      if (timer) clearTimeout(timer);
    }
  };
}

/**
 * HTTP `OPTIONS /` feature detection for a seed origin (browser-safe).
 * @param {string} originBase
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>}
 */
async function probeSeedOptions (originBase, options = {}) {
  const origin = normalizeHttpOrigin(originBase);
  if (!origin) {
    return {
      ok: false,
      status: 0,
      origin: String(originBase || ''),
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      features: { webrtc: false, rpc: false, peering: false, documents: false },
      error: 'invalid_origin'
    };
  }
  if (isMixedContentSeed(origin, options.pageProtocol)) {
    return {
      ok: false,
      status: 0,
      origin,
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      features: { webrtc: false, rpc: false, peering: false, documents: false },
      error: 'mixed_content'
    };
  }

  const { controller, cancel } = abortAfter(options.timeoutMs);
  try {
    const res = await fetch(`${origin}/`, {
      method: 'OPTIONS',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
      cache: 'no-store',
      credentials: 'omit'
    });
    cancel();
    const text = await res.text();
    let json = null;
    if (text && !String(text).trim().startsWith('<')) {
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = null;
      }
    }
    const hubLike = !!(res.ok && isFabricHubOptionsPayload(json));
    const fabricHttpLike = isFabricHttpApplicationPayload(json);
    return {
      ok: !!res.ok,
      status: res.status,
      origin,
      json,
      hubLike,
      fabricHttpLike,
      application: extractFabricHttpApplicationFromOptions(json),
      features: fabricHubOptionsFeatures(json)
    };
  } catch (e) {
    cancel();
    const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    return {
      ok: false,
      status: 0,
      origin,
      json: null,
      hubLike: false,
      fabricHttpLike: false,
      application: null,
      features: { webrtc: false, rpc: false, peering: false, documents: false },
      error: aborted ? 'timeout' : (e && e.message ? e.message : 'fetch_failed')
    };
  }
}

/**
 * Best-effort Fabric peering discovery (`GET /services/peering`).
 * The browser cannot dial TCP `:7777`; this records Hub-advertised peer capability.
 * @param {string} originBase
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, status: number, json: object|null, error?: string }>}
 */
async function probeSeedPeering (originBase, options = {}) {
  const origin = normalizeHttpOrigin(originBase);
  if (!origin) return { ok: false, status: 0, json: null, error: 'invalid_origin' };
  if (isMixedContentSeed(origin, options.pageProtocol)) {
    return { ok: false, status: 0, json: null, error: 'mixed_content' };
  }
  const { controller, cancel } = abortAfter(options.timeoutMs);
  try {
    const res = await fetch(`${origin}/services/peering`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
      cache: 'no-store',
      credentials: 'omit'
    });
    cancel();
    const json = await res.json().catch(() => null);
    const ok = !!(res.ok && json && typeof json === 'object' && !Array.isArray(json));
    return { ok, status: res.status, json: ok ? json : json };
  } catch (e) {
    cancel();
    const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    return {
      ok: false,
      status: 0,
      json: null,
      error: aborted ? 'timeout' : (e && e.message ? e.message : 'fetch_failed')
    };
  }
}

/**
 * OPTIONS + peering probe for one parsed seed.
 * @param {{ http: string, fabric: string }} seed
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function probeFabricHubSeed (seed, options = {}) {
  const http = seed && seed.http ? seed.http : '';
  const optionsProbe = await probeSeedOptions(http, options);
  let peering = { ok: false, status: 0, json: null };
  if (optionsProbe.hubLike || optionsProbe.fabricHttpLike) {
    peering = await probeSeedPeering(http, options);
  }
  return {
    seed,
    hubLike: !!optionsProbe.hubLike,
    fabricHttpLike: !!optionsProbe.fabricHttpLike,
    features: optionsProbe.features,
    options: optionsProbe,
    peering,
    fabricAttempted: true,
    fabricReachable: !!peering.ok
  };
}

/**
 * @param {Array} seeds
 * @param {object} [options]
 * @returns {Promise<Array>}
 */
async function probeFabricHubSeeds (seeds, options = {}) {
  const list = Array.isArray(seeds) ? seeds : [];
  const out = [];
  for (const seed of list) {
    out.push(await probeFabricHubSeed(seed, options));
  }
  return out;
}

module.exports = {
  DEFAULT_OPTIONS_TIMEOUT_MS,
  probeSeedOptions,
  probeSeedPeering,
  probeFabricHubSeed,
  probeFabricHubSeeds
};
