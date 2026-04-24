'use strict';

const assert = require('assert');
const {
  isFabricHubOptionsPayload,
  isFabricHttpApplicationPayload,
  extractFabricHttpApplicationFromOptions,
  resolveHttpProbeOrigins,
  normalizeOriginBase
} = require('../electron/desktopHubProbe');

describe('electron/desktopHubProbe', () => {
  it('isFabricHubOptionsPayload accepts hub.fabric.pub name', () => {
    assert.strictEqual(isFabricHubOptionsPayload({ name: 'hub.fabric.pub' }), true);
  });

  it('isFabricHubOptionsPayload accepts resources with /services routes', () => {
    const j = {
      name: 'other',
      resources: {
        Service: { routes: { list: '/services', view: '/services/:id' } }
      }
    };
    assert.strictEqual(isFabricHubOptionsPayload(j), true);
  });

  it('isFabricHubOptionsPayload rejects empty or unrelated JSON', () => {
    assert.strictEqual(isFabricHubOptionsPayload(null), false);
    assert.strictEqual(isFabricHubOptionsPayload({}), false);
    assert.strictEqual(isFabricHubOptionsPayload({ name: 'nginx', resources: {} }), false);
  });

  it('resolveHttpProbeOrigins builds origins from host and ports', () => {
    assert.deepStrictEqual(
      resolveHttpProbeOrigins({ host: '127.0.0.1', ports: [8080, 9090] }),
      ['http://127.0.0.1:8080', 'http://127.0.0.1:9090']
    );
    assert.deepStrictEqual(
      resolveHttpProbeOrigins({ host: 'localhost', ports: [3000], protocol: 'https' }),
      ['https://localhost:3000']
    );
  });

  it('resolveHttpProbeOrigins prefers explicit bases', () => {
    assert.deepStrictEqual(
      resolveHttpProbeOrigins({ bases: ['http://a:1', 'http://b:2'] }),
      ['http://a:1', 'http://b:2']
    );
  });

  it('normalizeOriginBase yields URL origin only', () => {
    assert.strictEqual(normalizeOriginBase('http://127.0.0.1:8080/foo'), 'http://127.0.0.1:8080');
    assert.strictEqual(normalizeOriginBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.strictEqual(normalizeOriginBase(''), '');
  });

  it('extractFabricHttpApplicationFromOptions lists resources and /services-linked definitions', () => {
    const json = {
      name: 'hub.fabric.pub',
      description: 'Test',
      resources: {
        Document: {
          name: 'Document',
          routes: { list: '/documents', view: '/documents/:id' }
        },
        Service: {
          name: 'Service',
          routes: { list: '/services', view: '/services/:id' }
        }
      },
      services: { bitcoin: { path: '/services/bitcoin' } }
    };
    assert.strictEqual(isFabricHttpApplicationPayload(json), true);
    const app = extractFabricHttpApplicationFromOptions(json);
    assert.ok(app);
    assert.deepStrictEqual(app.resourceNames, ['Document', 'Service']);
    assert.strictEqual(app.serviceDefinitions.length, 1);
    assert.strictEqual(app.serviceDefinitions[0].resourceKey, 'Service');
    assert.deepStrictEqual(app.services, { bitcoin: { path: '/services/bitcoin' } });
  });

  it('extractFabricHttpApplicationFromOptions accepts empty resources when name is set', () => {
    const json = { name: 'Empty', description: '', resources: {} };
    assert.strictEqual(isFabricHttpApplicationPayload(json), true);
    const app = extractFabricHttpApplicationFromOptions(json);
    assert.ok(app);
    assert.deepStrictEqual(app.resourceNames, []);
    assert.strictEqual(app.serviceDefinitions.length, 0);
  });

  it('isFabricHttpApplicationPayload rejects unrelated JSON', () => {
    assert.strictEqual(isFabricHttpApplicationPayload(null), false);
    assert.strictEqual(isFabricHttpApplicationPayload({ resources: [] }), false);
    assert.strictEqual(isFabricHttpApplicationPayload({ name: 'x' }), false);
  });
});
