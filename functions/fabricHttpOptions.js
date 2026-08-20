'use strict';

const { isSampleHubHttpServerOptions } = require('./sampleHubOptions');

/**
 * True when a resource definition lists at least one `/services…` route.
 * @param {object|null|undefined} resources
 * @returns {boolean}
 */
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

/**
 * @param {object|null|undefined} definition
 * @returns {boolean}
 */
function looksLikeFabricResourceDefinition (definition) {
  if (!definition || typeof definition !== 'object') return false;
  const routes = definition.routes;
  if (!routes || typeof routes !== 'object') return false;
  return Object.values(routes).some((p) => typeof p === 'string' && p.startsWith('/'));
}

/**
 * True when JSON matches the Fabric HTTP `OPTIONS /` application shape well enough for clients.
 * @param {object|null} j
 * @returns {boolean}
 */
function isFabricHttpApplicationPayload (j) {
  if (!j || typeof j !== 'object') return false;
  if (j['@type'] === 'ApplicationResourceContract' && typeof j.name === 'string') return true;
  if (!j.resources || typeof j.resources !== 'object' || Array.isArray(j.resources)) return false;
  const keys = Object.keys(j.resources);
  if (keys.length === 0) return typeof j.name === 'string';
  return keys.some((k) => looksLikeFabricResourceDefinition(j.resources[k]));
}

/**
 * True when `OPTIONS /` JSON looks like a live Fabric Hub (not the sample HTTP stub).
 * @param {object|null} j
 * @returns {boolean}
 */
function isFabricHubOptionsPayload (j) {
  if (!j || typeof j !== 'object') return false;
  if (isSampleHubHttpServerOptions(j)) return false;
  if (j['@type'] === 'ApplicationResourceContract' &&
    (String(j.name || '') === 'hub.fabric.pub' ||
      (j.services && j.services.peering) ||
      resourcesHaveServicesRoutes(j.resources))) {
    return true;
  }
  const name = String(j.name || '');
  if (name === 'hub.fabric.pub') return true;
  if (/fabric\s*hub/i.test(name) && j.resources && typeof j.resources === 'object') return true;
  if (resourcesHaveServicesRoutes(j.resources)) return true;
  return false;
}

/**
 * Normalize `OPTIONS /` JSON into resource and service-oriented structures (cf. `Remote.enumerate`).
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
  const resourceEntries = Object.keys(resources || {}).map((key) => ({
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

/**
 * Feature flags the HTML client cares about after an OPTIONS probe.
 * @param {object|null} json
 * @returns {{ webrtc: boolean, rpc: boolean, peering: boolean, documents: boolean }}
 */
function fabricHubOptionsFeatures (json) {
  const app = extractFabricHttpApplicationFromOptions(json);
  const methods = (app && app.rpcMethodNames) || [];
  const methodSet = new Set(methods.map((m) => String(m)));
  const services = (app && app.services) || (json && json.services) || {};
  const peering = !!(services && (services.peering || services.Peering));
  const rpc = methodSet.has('RegisterWebRTCPeer') ||
    methodSet.has('ListWebRTCPeers') ||
    methodSet.has('ListDocuments') ||
    resourcesHaveServicesRoutes(json && json.resources);
  const webrtc = methodSet.has('RegisterWebRTCPeer') ||
    methodSet.has('ListWebRTCPeers') ||
    methodSet.has('SendWebRTCSignal') ||
    isFabricHubOptionsPayload(json);
  const documents = methodSet.has('ListDocuments') ||
    methodSet.has('RequestPeerInventory') ||
    methodSet.has('RefreshDocumentMarket') ||
    rpc;
  return {
    webrtc: !!webrtc,
    rpc: !!rpc,
    peering: !!peering || resourcesHaveServicesRoutes(json && json.resources),
    documents: !!documents
  };
}

module.exports = {
  resourcesHaveServicesRoutes,
  looksLikeFabricResourceDefinition,
  isFabricHttpApplicationPayload,
  isFabricHubOptionsPayload,
  extractFabricHttpApplicationFromOptions,
  fabricHubOptionsFeatures
};
