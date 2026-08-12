'use strict';

const assert = require('assert');
const { mountFabricDelegationHttp } = require('../functions/fabricDelegation');

describe('mountFabricDelegationHttp options', function () {
  it('can omit GET /sessions for apps that own that path', function () {
    const routes = [];
    const hub = {
      http: {
        _addRoute (method, path, handler) {
          routes.push(`${method} ${path}`);
        }
      }
    };
    mountFabricDelegationHttp(hub, { mountSessionsList: false });
    assert.ok(routes.includes('GET /sessions/:sessionId/delegation/audit'));
    assert.ok(routes.includes('DELETE /sessions/:sessionId'));
    assert.ok(!routes.includes('GET /sessions'));
  });

  it('defaults mount all three Hub routes', function () {
    const routes = [];
    const hub = {
      http: {
        _addRoute (method, path) {
          routes.push(`${method} ${path}`);
        }
      }
    };
    mountFabricDelegationHttp(hub);
    assert.ok(routes.includes('GET /sessions'));
    assert.ok(routes.includes('GET /sessions/:sessionId/delegation/audit'));
    assert.ok(routes.includes('DELETE /sessions/:sessionId'));
  });
});
