'use strict';

/**
 * Expected Hub HTTP GET catalog + JSON Schema fragments for route probes.
 *
 * Paths without Express params are probed by default. Parameterized templates
 * are listed for enumeration / ARC comparison and skipped unless an example
 * fill-in is provided (`examples` or CLI `--include-parameterized`).
 */

/** @type {Record<string, object>} */
const SCHEMAS = Object.freeze({
  applicationResourceContract: {
    $id: 'https://fabric.pub/schemas/hub-arc.json',
    type: 'object',
    required: ['name', 'resources'],
    additionalProperties: true,
    properties: {
      '@type': { type: 'string' },
      name: { type: 'string', minLength: 1 },
      resources: { type: 'object' },
      services: { type: 'object' },
      capabilities: { type: 'object' },
      contract: { type: 'object' }
    }
  },
  settingsList: {
    $id: 'https://fabric.pub/schemas/hub-settings-list.json',
    type: 'object',
    required: ['success', 'settings', 'configured', 'needsSetup'],
    additionalProperties: true,
    properties: {
      success: { type: 'boolean' },
      settings: { type: 'object' },
      configured: { type: 'boolean' },
      needsSetup: { type: 'boolean' }
    }
  },
  settingsNamed: {
    $id: 'https://fabric.pub/schemas/hub-settings-named.json',
    type: 'object',
    required: ['success', 'setting', 'value'],
    additionalProperties: true,
    properties: {
      success: { type: 'boolean' },
      setting: { type: 'string' },
      value: {},
      error: { type: 'string' }
    }
  },
  uiConfig: {
    $id: 'https://fabric.pub/schemas/hub-ui-config.json',
    type: 'object',
    required: ['success', 'alerts'],
    additionalProperties: true,
    properties: {
      success: { type: 'boolean' },
      alerts: { type: 'array' }
    }
  },
  operatorHealth: {
    $id: 'https://fabric.pub/schemas/hub-operator-health.json',
    type: 'object',
    required: ['node', 'disk', 'network'],
    additionalProperties: true,
    properties: {
      now: {},
      node: { type: 'object' },
      disk: { type: 'object' },
      network: { type: 'object' },
      status: { type: 'string' },
      message: { type: 'string' }
    }
  },
  bitcoinStatus: {
    $id: 'https://fabric.pub/schemas/hub-bitcoin-status.json',
    type: 'object',
    // Non-admin GETs redact balance/beacon; require the public surface only.
    required: ['available', 'status'],
    additionalProperties: true,
    properties: {
      available: { type: 'boolean' },
      status: { type: 'string' },
      network: { type: 'string' },
      balance: {},
      beacon: { type: 'object' },
      message: { type: 'string' }
    }
  },
  peeringCapabilities: {
    $id: 'https://fabric.pub/schemas/hub-peering.json',
    type: 'object',
    required: ['available'],
    additionalProperties: true,
    properties: {
      available: { type: 'boolean' },
      service: { type: 'string' },
      kind: { type: 'string' },
      message: { type: 'string' },
      endpointBasePath: { type: 'string' },
      oracleAttestation: { type: 'object' }
    }
  },
  oracleAttestation: {
    $id: 'https://fabric.pub/schemas/hub-oracle-attestation.json',
    type: 'object',
    additionalProperties: true,
    properties: {
      '@type': { type: 'string' },
      kind: { type: 'string' },
      status: { type: 'string' },
      message: { type: 'string' }
    }
  },
  payjoinStatus: {
    $id: 'https://fabric.pub/schemas/hub-payjoin-status.json',
    type: 'object',
    additionalProperties: true,
    properties: {
      available: { type: 'boolean' },
      service: { type: 'string' }
    }
  },
  sidechainState: {
    $id: 'https://fabric.pub/schemas/hub-sidechain-state.json',
    type: 'object',
    required: ['type', 'clock', 'stateDigest'],
    additionalProperties: true,
    properties: {
      type: { type: 'string', enum: ['SidechainState'] },
      version: { type: 'number' },
      clock: { type: 'number' },
      stateDigest: { type: 'string' },
      content: { type: 'object' },
      policy: {}
    }
  },
  distributedManifest: {
    $id: 'https://fabric.pub/schemas/hub-distributed-manifest.json',
    type: 'object',
    additionalProperties: true,
    properties: {
      program: { type: 'object' },
      allowedMessageTypes: { type: 'array' }
    }
  },
  distributedEpoch: {
    $id: 'https://fabric.pub/schemas/hub-distributed-epoch.json',
    type: 'object',
    additionalProperties: true,
    properties: {
      clock: {},
      merkle: {},
      commitmentDigest: { type: 'string' }
    }
  },
  jsonObject: {
    $id: 'https://fabric.pub/schemas/hub-json-object.json',
    type: 'object',
    additionalProperties: true
  },
  jsonArrayOrObject: {
    $id: 'https://fabric.pub/schemas/hub-json-array-or-object.json',
    oneOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array' }
    ]
  }
});

/**
 * Canonical expected GET routes for a Fabric Hub HTTP host.
 * @type {Array<{ path: string, schema?: string|null, examples?: string[], spaOk?: boolean, optional?: boolean }>}
 */
const EXPECTED_GET_ROUTES = Object.freeze([
  // Resource list surfaces (SPA shell for HTML; JSON collections / status)
  { path: '/', schema: null, spaOk: true, htmlOnly: true },
  { path: '/contracts', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/documents', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/peers', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/sessions', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/settings', schema: 'settingsList', spaOk: true },
  { path: '/settings/:name', schema: 'settingsNamed', examples: ['/settings/NODE_NAME'], spaOk: true },

  // Operator / UI
  { path: '/services/operator/health', schema: 'operatorHealth', jsonOnly: true },
  { path: '/services/ui-config', schema: 'uiConfig', spaOk: true },
  { path: '/api/developers', schema: 'jsonObject', optional: true, jsonOnly: true },

  // Peering / challenge
  { path: '/services/peering', schema: 'peeringCapabilities', spaOk: true },
  { path: '/services/peering/attestation', schema: 'oracleAttestation', spaOk: true },
  { path: '/services/challenges', schema: 'jsonObject', spaOk: true },

  // Bitcoin (core list surfaces)
  { path: '/services/bitcoin', schema: 'bitcoinStatus', spaOk: true },
  { path: '/services/bitcoin/peers', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services/bitcoin/network', schema: 'jsonObject', spaOk: true },
  { path: '/services/bitcoin/blocks', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services/bitcoin/transactions', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services/bitcoin/xpub', schema: 'jsonObject', spaOk: true },
  { path: '/services/bitcoin/wallets', schema: 'jsonObject', spaOk: true },
  { path: '/services/bitcoin/addresses', schema: 'jsonObject', spaOk: true },
  { path: '/services/bitcoin/payments', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/payments', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services/bitcoin/crowdfunding/campaigns', schema: 'jsonArrayOrObject', spaOk: true },

  // Payjoin
  { path: '/services/payjoin', schema: 'payjoinStatus', spaOk: true },
  { path: '/services/payjoin/sessions', schema: 'jsonArrayOrObject', spaOk: true },
  { path: '/services/payjoin/mailboxes', schema: 'jsonArrayOrObject', spaOk: true },

  // Lightning
  { path: '/services/lightning', schema: 'jsonObject', spaOk: true, optional: true },
  { path: '/services/lightning/channels', schema: 'jsonArrayOrObject', spaOk: true, optional: true },
  { path: '/services/lightning/invoices', schema: 'jsonArrayOrObject', spaOk: true, optional: true },
  { path: '/services/lightning/payments', schema: 'jsonArrayOrObject', spaOk: true, optional: true },
  { path: '/services/lightning/decodes', schema: 'jsonArrayOrObject', spaOk: true, optional: true },

  // Distributed / sidechain (API JSON-only mounts)
  { path: '/services/distributed/manifest', schema: 'distributedManifest', jsonOnly: true },
  { path: '/services/distributed/epoch', schema: 'distributedEpoch', jsonOnly: true },
  { path: '/services/distributed/sidechain', schema: 'sidechainState', jsonOnly: true },
  { path: '/services/distributed/sidechain/journal', schema: 'jsonObject', jsonOnly: true },
  { path: '/services/distributed/sidechain/snapshots', schema: 'jsonObject', jsonOnly: true },
  // Transitional /statechain aliases (same handlers as /sidechain)
  { path: '/services/distributed/statechain', schema: 'sidechainState', jsonOnly: true },
  { path: '/services/distributed/statechain/journal', schema: 'jsonObject', jsonOnly: true },
  { path: '/services/distributed/statechain/snapshots', schema: 'jsonObject', jsonOnly: true },
  { path: '/services/distributed/federation-registry', schema: 'jsonObject', spaOk: true },
  { path: '/services/distributed/vault', schema: 'jsonObject', spaOk: true, optional: true },
  { path: '/services/distributed/vault/utxos', schema: 'jsonArrayOrObject', spaOk: true, optional: true },

  // Collaboration (when mounted) — auth-gated JSON APIs
  { path: '/services/collaboration', schema: 'jsonObject', jsonOnly: true, optional: true },
  { path: '/services/collaboration/contacts', schema: 'jsonArrayOrObject', jsonOnly: true, optional: true },
  { path: '/services/collaboration/invitations', schema: 'jsonArrayOrObject', jsonOnly: true, optional: true },
  { path: '/services/collaboration/invitations/claim', schema: 'jsonObject', jsonOnly: true, optional: true },
  { path: '/services/collaboration/invitations/decline', schema: 'jsonObject', jsonOnly: true, optional: true },
  { path: '/services/collaboration/groups', schema: 'jsonArrayOrObject', jsonOnly: true, optional: true }
]);

/**
 * @param {string} pathStr
 * @returns {boolean}
 */
function isParameterizedPath (pathStr) {
  return typeof pathStr === 'string' && /[:*]/.test(pathStr);
}

/**
 * Expand catalog entries into concrete probe targets.
 * @param {object} [opts]
 * @param {boolean} [opts.includeParameterized=false]
 * @param {boolean} [opts.includeOptional=true]
 * @returns {Array<{ path: string, template: string|null, schema: string|null, spaOk: boolean, optional: boolean, source: string }>}
 */
function expandExpectedGetRoutes (opts = {}) {
  const includeParameterized = opts.includeParameterized === true;
  const includeOptional = opts.includeOptional !== false;
  const out = [];
  const seen = new Set();

  for (const entry of EXPECTED_GET_ROUTES) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (entry.optional && !includeOptional) continue;

    const schema = entry.schema != null ? String(entry.schema) : null;
    const spaOk = entry.spaOk !== false;
    const optional = !!entry.optional;
    const jsonOnly = entry.jsonOnly === true;
    const htmlOnly = entry.htmlOnly === true;

    if (isParameterizedPath(entry.path)) {
      const examples = Array.isArray(entry.examples) ? entry.examples : [];
      if (!includeParameterized && !examples.length) continue;
      const targets = examples.length
        ? examples
        : (includeParameterized ? [] : []);
      for (const example of targets) {
        const p = String(example);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push({
          path: p,
          template: entry.path,
          schema,
          spaOk,
          optional,
          jsonOnly,
          htmlOnly,
          source: 'catalog'
        });
      }
      continue;
    }

    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push({
      path: entry.path,
      template: null,
      schema,
      spaOk,
      optional,
      jsonOnly,
      htmlOnly,
      source: 'catalog'
    });
  }

  return out;
}

/**
 * Collect list-style paths from an OPTIONS `/` ARC document.
 * @param {object|null} arc
 * @returns {string[]}
 */
function pathsFromApplicationResourceContract (arc) {
  const out = [];
  if (!arc || typeof arc !== 'object') return out;
  const resources = arc.resources && typeof arc.resources === 'object' ? arc.resources : {};
  for (const key of Object.keys(resources)) {
    const entry = resources[key];
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.route === 'string' && entry.route.startsWith('/')) {
      out.push(entry.route);
    }
    const paths = entry.paths && typeof entry.paths === 'object' ? entry.paths : null;
    if (paths && typeof paths.list === 'string' && paths.list.startsWith('/')) {
      out.push(paths.list);
    }
    const routes = entry.routes && typeof entry.routes === 'object' ? entry.routes : null;
    if (routes && typeof routes.list === 'string' && routes.list.startsWith('/')) {
      out.push(routes.list);
    }
  }
  const services = arc.services && typeof arc.services === 'object' ? arc.services : {};
  for (const key of Object.keys(services)) {
    const svc = services[key];
    if (!svc || typeof svc !== 'object') continue;
    if (typeof svc.path === 'string' && svc.path.startsWith('/')) out.push(svc.path);
    if (Array.isArray(svc.paths)) {
      for (const p of svc.paths) {
        if (typeof p === 'string' && p.startsWith('/')) out.push(p);
      }
    }
  }
  return out;
}

/**
 * Merge catalog, ARC, and optional sitemap absolute URLs into probe targets.
 * @param {object} [opts]
 * @param {object|null} [opts.arc]
 * @param {string[]} [opts.sitemapUrls]
 * @param {boolean} [opts.includeParameterized]
 * @param {boolean} [opts.includeOptional]
 * @returns {Array<object>}
 */
function enumerateExpectedGetRoutes (opts = {}) {
  const base = expandExpectedGetRoutes(opts);
  const byPath = new Map(base.map((r) => [r.path, r]));

  const arcPaths = pathsFromApplicationResourceContract(opts.arc || null);
  for (const p of arcPaths) {
    if (isParameterizedPath(p) && opts.includeParameterized !== true) continue;
    if (byPath.has(p)) continue;
    const underServices = p.startsWith('/services/');
    byPath.set(p, {
      path: p,
      template: null,
      schema: 'jsonArrayOrObject',
      spaOk: !underServices,
      optional: true,
      jsonOnly: underServices,
      htmlOnly: false,
      source: 'arc'
    });
  }

  const sitemap = Array.isArray(opts.sitemapUrls) ? opts.sitemapUrls : [];
  for (const absolute of sitemap) {
    let pathname = absolute;
    try {
      if (/^https?:\/\//i.test(absolute)) {
        pathname = new URL(absolute).pathname || '/';
      }
    } catch (_) {
      continue;
    }
    if (!pathname.startsWith('/')) continue;
    if (isParameterizedPath(pathname) && opts.includeParameterized !== true) continue;
    if (byPath.has(pathname)) continue;
    const underServices = pathname.startsWith('/services/');
    const htmlSurface = pathname.endsWith('.html') || pathname === '/';
    byPath.set(pathname, {
      path: pathname,
      template: null,
      schema: htmlSurface ? null : 'jsonArrayOrObject',
      spaOk: !underServices,
      optional: true,
      jsonOnly: underServices,
      htmlOnly: htmlSurface,
      source: 'sitemap'
    });
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {string} schemaId
 * @returns {object|null}
 */
function getSchema (schemaId) {
  if (!schemaId) return null;
  return SCHEMAS[schemaId] || null;
}

module.exports = {
  SCHEMAS,
  EXPECTED_GET_ROUTES,
  isParameterizedPath,
  expandExpectedGetRoutes,
  pathsFromApplicationResourceContract,
  enumerateExpectedGetRoutes,
  getSchema
};
