'use strict';

/**
 * Coverage for Hub package exports / re-exports of lifted Fabric HTTP APIs.
 */
const assert = require('assert');
const path = require('path');
const Key = require('@fabric/core/types/key');

describe('Hub lifted API package exports', function () {
  const exportIds = [
    './functions/fabricHubAllowlist',
    './functions/httpSharedMode',
    './functions/fabricDesktopAuth',
    './functions/fabricDesktopLoginVerify',
    './functions/fabricDeviceLink',
    './functions/fabricDeviceLinkClient',
    './functions/fabricDeviceLinkMessages',
    './functions/fabricDelegation',
    './functions/fabricDelegationLocal',
    './functions/oracleAttestation',
    './functions/fabricPubkey',
    './functions/fabricChatNormalize',
    './functions/hubLifecycle',
    './services/email',
    './services/fabric'
  ];

  it('package.json exports map includes lifted surfaces', function () {
    const pkg = require('../package.json');
    for (const id of exportIds) {
      assert.ok(pkg.exports[id], `missing export ${id}`);
    }
  });

  it('resolves each export via @fabric/hub subpath', function () {
    for (const id of exportIds) {
      const resolved = require.resolve(`@fabric/hub${id.slice(1)}`, {
        paths: [path.join(__dirname, '..')]
      });
      assert.ok(resolved, id);
      const mod = require(resolved);
      assert.ok(mod, `empty module ${id}`);
    }
  });
});

describe('Hub lifted APIs match @fabric/http where applicable', function () {
  it('allowlist + httpSharedMode re-export http', function () {
    const hubAllow = require('../functions/fabricHubAllowlist');
    const httpAllow = require('@fabric/http/functions/fabricHubAllowlist');
    assert.strictEqual(hubAllow.isAllowedFabricHub, httpAllow.isAllowedFabricHub);
    assert.strictEqual(hubAllow.assertAllowedFabricHub('https://evil.example').ok, false);

    const hubShared = require('../functions/httpSharedMode');
    const httpShared = require('@fabric/http/functions/httpSharedMode');
    assert.strictEqual(hubShared.resolveHttpListenHost, httpShared.resolveHttpListenHost);
    assert.strictEqual(hubShared.resolveHttpListenHost({ mode: 'server', env: {} }), '0.0.0.0');
  });

  it('oracleAttestation + fabricPubkey + fabricChatNormalize re-export http', function () {
    const hubOracle = require('../functions/oracleAttestation');
    const httpOracle = require('@fabric/http/functions/oracleAttestation');
    assert.strictEqual(hubOracle.buildOracleAttestation, httpOracle.buildOracleAttestation);
    assert.strictEqual(hubOracle.verifyOracleAttestation, httpOracle.verifyOracleAttestation);

    const key = new Key();
    const att = hubOracle.buildOracleAttestation({
      claim: { kind: hubOracle.KIND_PEERING, version: 1, fabricPeerId: key.pubkey },
      key
    });
    assert.strictEqual(hubOracle.verifyOracleAttestation(att), true);

    const hubPk = require('../functions/fabricPubkey');
    const httpPk = require('@fabric/http/functions/fabricPubkey');
    assert.strictEqual(hubPk.pubkeyXOnly(key.pubkey), httpPk.pubkeyXOnly(key.pubkey));
    assert.strictEqual(hubPk.canonicalChatAuthor(key.pubkey), httpPk.pubkeyXOnly(key.pubkey));

    const hubChat = require('../functions/fabricChatNormalize');
    const httpChat = require('@fabric/http/functions/fabricChatNormalize');
    // Hub wraps http normalize to sanitize Number(null)/'' created timestamps (epoch 0).
    assert.strictEqual(hubChat.chatTextOf, httpChat.chatTextOf);
    assert.strictEqual(hubChat.chatActorIdOf, httpChat.chatActorIdOf);
    assert.notStrictEqual(hubChat.normalizeP2pChatMessage, httpChat.normalizeP2pChatMessage);
    const n = hubChat.normalizeP2pChatMessage({ text: 'hi' }, { signer: key.pubkey });
    assert.strictEqual(n.actor.id, hubPk.pubkeyXOnly(key.pubkey));
    const coerced = hubChat.normalizeP2pChatMessage(
      { text: 'hi', created: null },
      { signer: key.pubkey }
    );
    assert.ok(Number(coerced.object.created) > 0);
  });

  it('fabricDelegation exports mount + session helpers', function () {
    const del = require('../functions/fabricDelegation');
    assert.strictEqual(typeof del.mountFabricDelegationHttp, 'function');
    assert.strictEqual(typeof del.getDelegationSessionById, 'function');
    assert.strictEqual(typeof del.postDelegationSignatureMessage, 'function');

    const hub = { _delegationRegistry: new Map() };
    hub._delegationRegistry.set('tok123', {
      origin: 'http://127.0.0.1:8080',
      linkedAt: Date.now(),
      identityId: 'id1'
    });
    const row = del.getDelegationSessionById(hub, 'tok123');
    assert.strictEqual(row.ok, true);
    assert.strictEqual(row.kind, 'delegation');
    assert.strictEqual(del.getDelegationSessionById(hub, 'missing'), null);
  });

  it('hubLifecycle START_PHASES align with Hub.START_PHASES', function () {
    const life = require('../functions/hubLifecycle');
    const Hub = require('../services/hub');
    assert.strictEqual(Hub.START_PHASES, life.HUB_START_PHASES);
    assert.ok(life.HUB_START_PHASES.includes('routes'));
    assert.ok(life.HUB_START_PHASES.includes('listen'));
  });

  it('services/email and services/fabric are constructible via package export', function () {
    const EmailService = require('@fabric/hub/services/email');
    const FabricService = require('@fabric/hub/services/fabric');
    const email = new EmailService({ host: '127.0.0.1', port: 1025 });
    assert.strictEqual(email.getTransportMode(), 'smtp');
    const fabric = new FabricService({ search: false, sync: false });
    assert.ok(fabric.settings);
    assert.ok(Array.isArray(fabric.remotes));
  });
});

describe('Hub PeeringService uses lifted oracleAttestation', function () {
  it('build/verify round-trip stays compatible with http verifier', function () {
    const PeeringService = require('../services/peering');
    const httpOracle = require('@fabric/http/functions/oracleAttestation');
    const key = new Key({});
    const hub = {
      http: {
        clock: 1,
        agent: { listenAddress: '127.0.0.1:7777', listening: true },
        webrtcPeers: new Map()
      },
      agent: {
        id: 'peer-id',
        identity: { id: key.pubkey },
        connections: {},
        settings: { constraints: { peers: { max: 8 } } }
      },
      settings: { alias: '@fabric/hub' }
    };
    const svc = new PeeringService({});
    svc.attach({ key, hub });
    const att = svc.buildOracleAttestation();
    assert.strictEqual(PeeringService.verifyOracleAttestation(att), true);
    assert.strictEqual(httpOracle.verifyOracleAttestation(att), true);
    const caps = svc.getCapabilities();
    assert.ok(caps.oracleAttestation);
    assert.ok(caps.claim || caps.oracleAttestation.claim);
  });
});
