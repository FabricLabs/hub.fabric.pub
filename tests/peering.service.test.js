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

  it('names the federation key in the signed claim, apart from the identity key', function () {
    const key = new Key({});
    const cosigner = new Key({});
    const hub = {
      http: { clock: 1, agent: { listenAddress: null, listening: false } },
      agent: { id: 'fab-peer-id', identity: { id: 'identity-hex' }, connections: {} },
      settings: { alias: '@fabric/hub' },
      federations: { pubkey: cosigner.pubkey }
    };
    const svc = new PeeringService({});
    svc.attach({ key, hub });
    const checked = PeeringService.verifyHubAttestation({ oracleAttestation: svc.buildOracleAttestation() });
    assert.strictEqual(checked.ok, true);
    assert.strictEqual(checked.pubkey, String(key.pubkey).toLowerCase());
    assert.strictEqual(checked.claim.federationPubkey, cosigner.pubkey);
    assert.notStrictEqual(checked.claim.federationPubkey, checked.pubkey);

    const forged = svc.buildOracleAttestation();
    forged.claim.federationPubkey = new Key({}).pubkey;
    assert.strictEqual(PeeringService.verifyHubAttestation(forged).ok, false);
  });

  it('claims no federation key when Federations are off', function () {
    const svc = new PeeringService({});
    svc.attach({ key: new Key({}), hub: { http: { agent: null }, agent: null, settings: {} } });
    assert.strictEqual(svc.buildClaim().federationPubkey, null);
  });
});
