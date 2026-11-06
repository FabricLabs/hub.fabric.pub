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

  it('reports the Hub Peer listener, not the HTTP agent', function () {
    const server = { listening: true, address: () => ({ address: '0.0.0.0', port: 7777 }) };
    const hub = {
      http: { clock: 1, agent: {} },
      agent: { id: 'fab-peer-id', server, connections: { a: {} } },
      settings: {}
    };
    const svc = new PeeringService({});
    svc.attach({ key: new Key({}), hub });
    assert.deepStrictEqual(
      { listenAddress: svc.buildClaim().p2p.listenAddress, listening: svc.buildClaim().p2p.listening },
      { listenAddress: '0.0.0.0:7777', listening: true }
    );
    hub.agent.listenAddress = 'hub.example:7777';
    assert.strictEqual(svc.buildClaim().p2p.listenAddress, 'hub.example:7777');
    server.listening = false;
    assert.strictEqual(svc.buildClaim().p2p.listening, false);
    hub.agent = { server: { address: () => null, close () {}, on () {} } };
    assert.deepStrictEqual(PeeringService.p2pListener(hub), { listenAddress: null, listening: false });
  });

  it('claims no federation key when Federations are off', function () {
    const svc = new PeeringService({});
    svc.attach({ key: new Key({}), hub: { http: { agent: null }, agent: null, settings: {} } });
    assert.strictEqual(svc.buildClaim().federationPubkey, null);
  });
});
