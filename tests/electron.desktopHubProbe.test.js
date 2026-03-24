'use strict';

const assert = require('assert');
const { isFabricHubOptionsPayload } = require('../electron/desktopHubProbe');

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
});
