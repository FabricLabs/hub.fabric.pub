'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const PeeringService = require('../services/peering');

describe('PeeringService', function () {
  it('signs and verifies OracleAttestation (PeeringCapability)', function () {
    const key = new Key({});
    const hub = {
      http: {
        clock: 42,
        agent: { listenAddress: '127.0.0.1:7777', listening: true },
        webrtcPeers: new Map([['peer-a', {}]])
      },
      agent: {
        id: 'fab-peer-id',
        identity: { id: 'identity-hex' },
        connections: { a: {} },
        settings: { constraints: { peers: { max: 8 } } }
      },
      settings: { alias: '@fabric/hub' }
    };
    const svc = new PeeringService({});
    svc.attach({ key, hub });
    const att = svc.buildOracleAttestation();
    assert.strictEqual(att['@type'], 'OracleAttestation');
    assert.strictEqual(att.kind, 'PeeringCapability');
    assert.ok(att.signature && att.signature.length === 128);
    assert.strictEqual(PeeringService.verifyOracleAttestation(att), true);
  });
});
