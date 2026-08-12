'use strict';

/**
 * Probe Fabric HTTP GET routes: JSON + HTML Accept, classify missing handlers,
 * validate JSON against {@link ./httpRouteCatalog} schemas.
 */

const http = require('http');
const https = require('https');
const Ajv = require('ajv');

const {
  SCHEMAS,
  enumerateExpectedGetRoutes,
  getSchema
} = require('./httpRouteCatalog');
const { isApplicationResourceContract } = require('@fabric/http/functions/applicationResourceContract');

const DEFAULT_TIMEOUT_MS = 12000;

/**
 * @param {string} originBase
 * @returns {string}
 */
function normalizeOriginBase (originBase) {
  const raw = String(originBase || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.protocol}//${u.host}`;
  } catch (_) {
    return '';
  }
}

/**
 * @param {string} contentType
 * @returns {'json'|'html'|'xml'|'other'|'empty'}
 */
function classifyContentType (contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct) return 'empty';
  if (ct.includes('application/json') || ct.includes('+json')) return 'json';
  if (ct.includes('text/html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  return 'other';
}

/**
 * @param {string} origin
 * @param {string} method
 * @param {string} pathname
 * @param {object} [opts]
 * @param {string} [opts.accept]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.discardBody=false] When true, still buffer but mark body discarded in result.
 * @returns {Promise<object>}
 */
function requestOnce (origin, method, pathname, opts = {}) {
  const base = normalizeOriginBase(origin);
  const accept = opts.accept || 'application/json';
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const discardBody = opts.discardBody === true;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;

  return new Promise((resolve) => {
    if (!base) {
      resolve({
        ok: false,
        status: 0,
        error: 'invalid_origin',
        headers: {},
        contentType: null,
        bodyKind: 'empty',
        body: null,
        bodyBytes: 0,
        discarded: discardBody
      });
      return;
    }

    let url;
    try {
      url = new URL(path, `${base}/`);
    } catch (e) {
      resolve({
        ok: false,
        status: 0,
        error: e && e.message ? e.message : 'bad_url',
        headers: {},
        contentType: null,
        bodyKind: 'empty',
        body: null,
        bodyBytes: 0,
        discarded: discardBody
      });
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        Accept: accept,
        'User-Agent': 'fabric-hub-http-route-probe/1'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || null;
        const bodyKind = classifyContentType(contentType);
        let body = null;
        let parseError = null;
        if (!discardBody) {
          const text = buf.toString('utf8');
          if (bodyKind === 'json' || (accept.includes('json') && text && text.trim().startsWith('{'))) {
            try {
              body = text ? JSON.parse(text) : null;
            } catch (e) {
              parseError = e && e.message ? e.message : String(e);
              body = { _rawPreview: text.slice(0, 240) };
            }
          } else if (!discardBody && bodyKind !== 'html') {
            body = text.slice(0, 400);
          }
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode || 0,
          error: parseError,
          headers: {
            'content-type': contentType,
            allow: res.headers.allow || null,
            'x-powered-by': res.headers['x-powered-by'] || null
          },
          contentType,
          bodyKind,
          body: discardBody ? null : body,
          bodyBytes: buf.length,
          discarded: discardBody
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        error: err && err.message ? err.message : String(err),
        headers: {},
        contentType: null,
        bodyKind: 'empty',
        body: null,
        bodyBytes: 0,
        discarded: discardBody
      });
    });
    req.end();
  });
}

/**
 * @param {string} origin
 * @param {object} [opts]
 * @returns {Promise<object|null>}
 */
async function fetchApplicationResourceContract (origin, opts = {}) {
  const res = await requestOnce(origin, 'OPTIONS', '/', {
    accept: 'application/json',
    timeoutMs: opts.timeoutMs,
    discardBody: false
  });
  if (res.body && isApplicationResourceContract(res.body)) return res.body;
  if (res.body && typeof res.body === 'object' && res.body.resources) return res.body;
  return null;
}

/**
 * @param {string} origin
 * @param {object} [opts]
 * @returns {Promise<string[]>}
 */
async function fetchSitemapPaths (origin, opts = {}) {
  const base = normalizeOriginBase(origin);
  if (!base) return [];
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const xml = await new Promise((resolve) => {
    let url;
    try {
      url = new URL('/sitemap.xml', `${base}/`);
    } catch (_) {
      resolve('');
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/sitemap.xml',
      method: 'GET',
      headers: { Accept: 'application/xml,text/xml,*/*' }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 404 || res.statusCode >= 500) {
          resolve('');
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve('');
    });
    req.on('error', () => resolve(''));
    req.end();
  });

  return extractLocPaths(xml);
}

/**
 * @param {string} xml
 * @returns {string[]}
 */
function extractLocPaths (xml) {
  const out = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * Create Ajv instance with catalog schemas registered.
 * @returns {import('ajv').default}
 */
function createValidator () {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const key of Object.keys(SCHEMAS)) {
    try {
      ajv.addSchema(SCHEMAS[key]);
    } catch (_) { /* already added */ }
  }
  return ajv;
}

/**
 * @param {import('ajv').default} ajv
 * @param {string|null} schemaId
 * @param {*} json
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateAgainstSchema (ajv, schemaId, json) {
  if (!schemaId) return { ok: true, errors: [] };
  const schema = getSchema(schemaId);
  if (!schema) return { ok: false, errors: [`unknown schema id: ${schemaId}`] };
  const validate = ajv.getSchema(schema.$id) || ajv.compile(schema);
  const ok = validate(json);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map((e) => {
    const path = e.instancePath || e.schemaPath || '';
    return `${path} ${e.message || 'invalid'}`.trim();
  });
  return { ok: false, errors };
}

/**
 * Decide whether JSON Accept got a usable API handler.
 * @param {object} jsonRes
 * @param {{ spaOk?: boolean }} route
 * @returns {{ hasHandler: boolean, reason: string|null }}
 */
function classifyJsonHandler (jsonRes, route = {}) {
  if (route.htmlOnly) {
    // SPA / static HTML surfaces are not expected to negotiate JSON.
    return { hasHandler: true, reason: 'html_only_skipped' };
  }
  if (jsonRes.status === 0) {
    return { hasHandler: false, reason: jsonRes.error || 'network_error' };
  }
  if (jsonRes.status === 404) {
    return { hasHandler: false, reason: 'http_404' };
  }
  if (jsonRes.status === 405) {
    return { hasHandler: false, reason: 'http_405' };
  }
  // Express default / SPA may serve HTML even when Accept prefers JSON
  if (jsonRes.bodyKind === 'html') {
    return { hasHandler: false, reason: 'html_instead_of_json' };
  }
  if (jsonRes.bodyKind === 'json' || (jsonRes.body && typeof jsonRes.body === 'object')) {
    return { hasHandler: true, reason: null };
  }
  if (jsonRes.status >= 500) {
    return { hasHandler: true, reason: 'server_error_but_routed' };
  }
  if (jsonRes.status >= 400) {
    // 401/403/400/503 still imply a handler
    return { hasHandler: true, reason: `http_${jsonRes.status}` };
  }
  return { hasHandler: false, reason: 'non_json_body' };
}

/**
 * @param {object} htmlRes
 * @param {{ jsonOnly?: boolean }} [route]
 * @returns {{ hasHandler: boolean, reason: string|null }}
 */
function classifyHtmlHandler (htmlRes, route = {}) {
  if (route.jsonOnly) {
    // API-only mounts (jsonOnly / no SPA shell) — do not require HTML.
    return { hasHandler: true, reason: 'json_only_skipped' };
  }
  if (htmlRes.status === 0) {
    return { hasHandler: false, reason: htmlRes.error || 'network_error' };
  }
  if (htmlRes.status === 404) {
    return { hasHandler: false, reason: 'http_404' };
  }
  if (htmlRes.status === 405) {
    return { hasHandler: false, reason: 'http_405' };
  }
  // JSON-only handlers that ignore Accept still "exist" for HTML deep-links poorly —
  // treat JSON Content-Type as missing HTML shell.
  if (htmlRes.bodyKind === 'json') {
    return { hasHandler: false, reason: 'json_instead_of_html' };
  }
  if (htmlRes.bodyKind === 'html' || htmlRes.status === 200 || htmlRes.status === 304) {
    return { hasHandler: true, reason: null };
  }
  if (htmlRes.status >= 400 && htmlRes.status < 500) {
    return { hasHandler: true, reason: `http_${htmlRes.status}` };
  }
  return { hasHandler: htmlRes.status > 0 && htmlRes.status < 500, reason: htmlRes.bodyKind };
}

/**
 * Probe one route for JSON + HTML.
 * @param {string} origin
 * @param {object} route
 * @param {object} [opts]
 * @param {import('ajv').default} [opts.ajv]
 * @returns {Promise<object>}
 */
async function probeRoute (origin, route, opts = {}) {
  const ajv = opts.ajv || createValidator();
  const timeoutMs = opts.timeoutMs;

  const [jsonRes, htmlRes] = await Promise.all([
    requestOnce(origin, 'GET', route.path, {
      accept: 'application/json',
      timeoutMs,
      discardBody: false
    }),
    requestOnce(origin, 'GET', route.path, {
      accept: 'text/html',
      timeoutMs,
      discardBody: true
    })
  ]);

  const jsonClass = classifyJsonHandler(jsonRes, route);
  const htmlClass = classifyHtmlHandler(htmlRes, route);

  let schema = { ok: true, errors: [], skipped: true };
  const canValidate = jsonClass.hasHandler &&
    route.schema &&
    jsonRes.body != null &&
    (jsonRes.bodyKind === 'json' || typeof jsonRes.body === 'object');
  if (canValidate) {
    schema = Object.assign(
      { skipped: false },
      validateAgainstSchema(ajv, route.schema, jsonRes.body)
    );
  }

  return {
    path: route.path,
    template: route.template || null,
    source: route.source || 'catalog',
    schemaId: route.schema || null,
    optional: !!route.optional,
    json: {
      status: jsonRes.status,
      contentType: jsonRes.contentType,
      bodyKind: jsonRes.bodyKind,
      headers: jsonRes.headers,
      bodyBytes: jsonRes.bodyBytes,
      hasHandler: jsonClass.hasHandler,
      reason: jsonClass.reason,
      // Keep JSON bodies for schema comparison / reporting (not HTML).
      body: jsonRes.body
    },
    html: {
      status: htmlRes.status,
      contentType: htmlRes.contentType,
      bodyKind: htmlRes.bodyKind,
      headers: htmlRes.headers,
      bodyBytes: htmlRes.bodyBytes,
      hasHandler: htmlClass.hasHandler,
      reason: htmlClass.reason,
      discarded: true
    },
    missingBoth: !jsonClass.hasHandler && !htmlClass.hasHandler,
    schema
  };
}

/**
 * Full probe against a live Fabric HTTP host.
 * @param {object} opts
 * @param {string} opts.origin
 * @param {boolean} [opts.includeParameterized]
 * @param {boolean} [opts.includeOptional]
 * @param {boolean} [opts.useSitemap=true]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.strictSchemas=false]
 * @returns {Promise<object>}
 */
async function runHttpRouteProbe (opts = {}) {
  const origin = normalizeOriginBase(opts.origin || opts.baseUrl || '');
  if (!origin) {
    throw new Error('origin / baseUrl is required (e.g. http://127.0.0.1:8080)');
  }

  const arc = await fetchApplicationResourceContract(origin, opts);
  let sitemapUrls = [];
  if (opts.useSitemap !== false) {
    try {
      sitemapUrls = await fetchSitemapPaths(origin, opts);
    } catch (_) {
      sitemapUrls = [];
    }
  }

  const routes = enumerateExpectedGetRoutes({
    arc,
    sitemapUrls,
    includeParameterized: opts.includeParameterized === true,
    includeOptional: opts.includeOptional !== false
  });

  const ajv = createValidator();
  const results = [];
  for (const route of routes) {
    // Sequential to avoid hammering a local hub; still fast enough for ~40 routes.
    // eslint-disable-next-line no-await-in-loop
    results.push(await probeRoute(origin, route, { ajv, timeoutMs: opts.timeoutMs }));
  }

  const missingBoth = results.filter((r) => r.missingBoth);
  const missingJson = results.filter((r) => !r.json.hasHandler && r.json.reason !== 'html_only_skipped');
  const missingHtml = results.filter((r) => !r.html.hasHandler && r.html.reason !== 'json_only_skipped');
  const schemaFailures = results.filter((r) => r.schema && r.schema.skipped === false && !r.schema.ok);

  const requiredMissingBoth = missingBoth.filter((r) => !r.optional);
  const requiredSchemaFailures = schemaFailures.filter((r) => !r.optional);

  const ok = requiredMissingBoth.length === 0 &&
    (opts.strictSchemas !== true || requiredSchemaFailures.length === 0);

  return {
    origin,
    startedAt: new Date().toISOString(),
    arc: arc
      ? {
        name: arc.name,
        type: arc['@type'] || null,
        resourceCount: arc.resources ? Object.keys(arc.resources).length : 0
      }
      : null,
    routeCount: routes.length,
    results,
    summary: {
      missingBoth: missingBoth.map((r) => r.path),
      missingJson: missingJson.map((r) => ({ path: r.path, reason: r.json.reason, status: r.json.status })),
      missingHtml: missingHtml.map((r) => ({ path: r.path, reason: r.html.reason, status: r.html.status })),
      schemaFailures: schemaFailures.map((r) => ({
        path: r.path,
        schemaId: r.schemaId,
        errors: r.schema.errors
      })),
      ok
    }
  };
}

module.exports = {
  normalizeOriginBase,
  classifyContentType,
  requestOnce,
  fetchApplicationResourceContract,
  fetchSitemapPaths,
  extractLocPaths,
  createValidator,
  validateAgainstSchema,
  classifyJsonHandler,
  classifyHtmlHandler,
  probeRoute,
  runHttpRouteProbe
};
