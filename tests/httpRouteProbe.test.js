'use strict';

const assert = require('assert');
const {
  EXPECTED_GET_ROUTES,
  expandExpectedGetRoutes,
  enumerateExpectedGetRoutes,
  pathsFromApplicationResourceContract,
  getSchema,
  isParameterizedPath
} = require('../functions/httpRouteCatalog');
const {
  classifyContentType,
  classifyJsonHandler,
  classifyHtmlHandler,
  createValidator,
  validateAgainstSchema,
  extractLocPaths,
  normalizeOriginBase
} = require('../functions/httpRouteProbe');

describe('httpRouteCatalog', function () {
  it('lists concrete GET paths without requiring a live host', function () {
    const routes = expandExpectedGetRoutes({ includeOptional: true });
    assert.ok(routes.length >= 20);
    assert.ok(routes.every((r) => r.path.startsWith('/') && !isParameterizedPath(r.path)));
    assert.ok(routes.some((r) => r.path === '/settings'));
    assert.ok(routes.some((r) => r.path === '/services/bitcoin'));
    assert.ok(routes.some((r) => r.path === '/services/distributed/sidechain'));
  });

  it('expands settings/:name via examples', function () {
    const routes = expandExpectedGetRoutes({ includeOptional: true });
    assert.ok(routes.some((r) => r.path === '/settings/NODE_NAME'));
  });

  it('merges ARC resource list paths', function () {
    const arc = {
      name: 'hub.fabric.pub',
      resources: {
        Peer: { route: '/peers', paths: { list: '/peers', view: '/peers/:id' } },
        Extra: { route: '/activities' }
      },
      services: {
        rpc: { paths: ['/services/rpc'] }
      }
    };
    const paths = pathsFromApplicationResourceContract(arc);
    assert.ok(paths.includes('/peers'));
    assert.ok(paths.includes('/activities'));
    assert.ok(paths.includes('/services/rpc'));

    const merged = enumerateExpectedGetRoutes({ arc, includeOptional: true });
    assert.ok(merged.some((r) => r.path === '/activities' && r.source === 'arc'));
  });

  it('exposes schemas for catalog schema ids', function () {
    for (const entry of EXPECTED_GET_ROUTES) {
      if (!entry.schema) continue;
      assert.ok(getSchema(entry.schema), `missing schema ${entry.schema} for ${entry.path}`);
    }
  });
});

describe('httpRouteProbe helpers', function () {
  it('normalizes origins', function () {
    assert.strictEqual(normalizeOriginBase('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
    assert.strictEqual(normalizeOriginBase('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  });

  it('classifies content types', function () {
    assert.strictEqual(classifyContentType('application/json; charset=utf-8'), 'json');
    assert.strictEqual(classifyContentType('text/html'), 'html');
  });

  it('flags missing JSON when HTML is returned', function () {
    const c = classifyJsonHandler({
      status: 200,
      bodyKind: 'html',
      error: null,
      body: null
    });
    assert.strictEqual(c.hasHandler, false);
    assert.strictEqual(c.reason, 'html_instead_of_json');
  });

  it('flags missing HTML when only JSON is returned', function () {
    const c = classifyHtmlHandler({
      status: 200,
      bodyKind: 'json',
      error: null
    });
    assert.strictEqual(c.hasHandler, false);
    assert.strictEqual(c.reason, 'json_instead_of_html');
  });

  it('skips HTML expectation for jsonOnly routes', function () {
    const c = classifyHtmlHandler({
      status: 200,
      bodyKind: 'json',
      error: null
    }, { jsonOnly: true });
    assert.strictEqual(c.hasHandler, true);
    assert.strictEqual(c.reason, 'json_only_skipped');
  });

  it('skips JSON expectation for htmlOnly routes', function () {
    const c = classifyJsonHandler({
      status: 200,
      bodyKind: 'html',
      error: null,
      body: null
    }, { htmlOnly: true });
    assert.strictEqual(c.hasHandler, true);
    assert.strictEqual(c.reason, 'html_only_skipped');
  });

  it('detects missing both via 404s', function () {
    const j = classifyJsonHandler({ status: 404, bodyKind: 'json', error: null, body: {} });
    const h = classifyHtmlHandler({ status: 404, bodyKind: 'html', error: null });
    assert.strictEqual(j.hasHandler, false);
    assert.strictEqual(h.hasHandler, false);
  });

  it('validates settings list schema', function () {
    const ajv = createValidator();
    const good = validateAgainstSchema(ajv, 'settingsList', {
      success: true,
      settings: {},
      configured: true,
      needsSetup: false
    });
    assert.strictEqual(good.ok, true);
    const bad = validateAgainstSchema(ajv, 'settingsList', { success: true });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.length);
  });

  it('parses sitemap loc entries', function () {
    const xml = `<?xml version="1.0"?>
<urlset><url><loc>http://127.0.0.1:8080/peers</loc></url>
<url><loc>http://127.0.0.1:8080/documents</loc></url></urlset>`;
    const locs = extractLocPaths(xml);
    assert.deepStrictEqual(locs, [
      'http://127.0.0.1:8080/peers',
      'http://127.0.0.1:8080/documents'
    ]);
  });
});
