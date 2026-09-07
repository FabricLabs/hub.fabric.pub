'use strict';

const assert = require('assert');
const {
  classifyHubHttpProbe,
  isFabricHubSettingsJson,
  looksLikeHtmlDocument,
  HUB_UI_RUNTIME_HUB,
  HUB_UI_RUNTIME_CLIENT
} = require('../functions/hubClientEnvironment');

describe('hubClientEnvironment', function () {
  it('looksLikeHtmlDocument detects spaFallback / CDN HTML', function () {
    assert.strictEqual(looksLikeHtmlDocument('<!DOCTYPE html><html></html>'), true);
    assert.strictEqual(looksLikeHtmlDocument('  <html lang="en">'), true);
    assert.strictEqual(looksLikeHtmlDocument('{"configured":true}'), false);
  });

  it('isFabricHubSettingsJson accepts setup-status and full settings envelopes', function () {
    assert.strictEqual(isFabricHubSettingsJson({ configured: true, needsSetup: false }), true);
    assert.strictEqual(isFabricHubSettingsJson({
      success: true,
      settings: { NODE_NAME: 'hub' }
    }), true);
    assert.strictEqual(isFabricHubSettingsJson({ success: true, error: 'nope' }), false);
    assert.strictEqual(isFabricHubSettingsJson({ protectionBypass: true }), false);
  });

  it('classifies HTML /settings as client', function () {
    const c = classifyHubHttpProbe({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      bodyText: '<!DOCTYPE html><html><body>Hub SPA</body></html>'
    });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_CLIENT);
    assert.strictEqual(c.reason, 'html');
  });

  it('classifies Hub GET /settings JSON as hub', function () {
    const c = classifyHubHttpProbe({
      status: 200,
      contentType: 'application/json',
      json: { configured: true, needsSetup: false }
    });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_HUB);
    assert.strictEqual(c.reason, 'settings-json');
    assert.strictEqual(c.needsSetup, false);
  });

  it('classifies Vercel protection JSON as client', function () {
    const c = classifyHubHttpProbe({
      status: 401,
      contentType: 'application/json',
      json: { protection: true, error: 'unauthorized' }
    });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_CLIENT);
    assert.strictEqual(c.reason, 'cdn-protection');
  });

  it('classifies 404 as client', function () {
    const c = classifyHubHttpProbe({ status: 404, bodyText: 'Not found' });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_CLIENT);
    assert.strictEqual(c.reason, 'http-404');
  });

  it('classifies JSON 403 as hub (auth wall, not missing API)', function () {
    const c = classifyHubHttpProbe({
      status: 403,
      contentType: 'application/json',
      json: { error: 'forbidden' }
    });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_HUB);
    assert.strictEqual(c.reason, 'http-403');
  });

  it('classifies unreachable probes as client', function () {
    const c = classifyHubHttpProbe({ error: 'fetch failed' });
    assert.strictEqual(c.runtime, HUB_UI_RUNTIME_CLIENT);
    assert.strictEqual(c.reason, 'unreachable');
  });
});
