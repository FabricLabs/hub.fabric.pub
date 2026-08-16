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
    './functions/bulkSecurityAdvisory',
    './functions/operatorAdminToken',
    './functions/hubLifecycle',
    './functions/documentInventoryMarket',
    './functions/identityCluster',
    './functions/identityClusterHttp',
    './functions/identityCrossSign',
    './functions/identityCrossSignVerify',
    './functions/fabricLinkedDevices',
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

  it('fabricDeviceLink re-exports http thin-client Origin helpers', function () {
    const hubLink = require('../functions/fabricDeviceLink');
    const httpLink = require('@fabric/http/functions/fabricDeviceLinkHttp');
    assert.strictEqual(hubLink.clientMayAccessDeviceLink, httpLink.clientMayAccessDeviceLink);
    assert.strictEqual(hubLink.isThinClientOrigin, httpLink.isThinClientOrigin);
    assert.strictEqual(hubLink.MAX_SESSIONS_PER_ORIGIN, httpLink.MAX_SESSIONS_PER_ORIGIN);
    assert.strictEqual(hubLink.evictDeviceLinkOriginOverflow, httpLink.evictDeviceLinkOriginOverflow);
    assert.strictEqual(hubLink.offerReplayKey, httpLink.offerReplayKey);
    const android = {
      socket: { remoteAddress: '203.0.113.9' },
      headers: { origin: 'https://localhost' }
    };
    assert.strictEqual(hubLink.clientMayAccessDeviceLink(android, 'https://relay.goon.vc'), true);
    assert.strictEqual(hubLink.clientMayAccessDeviceLink(android, 'https://phish.example'), false);
  });

  it('fabricDeviceLinkClient omits Origin/Referer when window is the global', function () {
    const { deviceLinkHeaders } = require('../functions/fabricDeviceLinkClient');
    const nodeHeaders = deviceLinkHeaders('https://hub.example');
    assert.strictEqual(nodeHeaders.Origin, 'https://hub.example');
    const prior = globalThis.window;
    globalThis.window = globalThis;
    try {
      const browserHeaders = deviceLinkHeaders('https://hub.example');
      assert.strictEqual(browserHeaders.Origin, undefined);
      assert.strictEqual(browserHeaders.Referer, undefined);
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });

  it('identityCrossSign and identityCrossSignVerify re-export core', function () {
    const hubSign = require('../functions/identityCrossSign');
    const coreSign = require('@fabric/core/functions/identityCrossSign');
    assert.strictEqual(hubSign.SIGN_TYPE, coreSign.SIGN_TYPE);
    const hubVerify = require('../functions/identityCrossSignVerify');
    const coreVerify = require('@fabric/core/functions/identityCrossSignVerify');
    assert.strictEqual(hubVerify.signCrossSign, coreVerify.signCrossSign);
  });

  it('rejects unknown kind and truncated identity-id hex via the core pin', function () {
    const crypto = require('crypto');
    const Identity = require('@fabric/core/types/identity');
    const { SIGN_TYPE, buildCrossSignMessage } = require('../functions/identityCrossSign');
    const { signCrossSign } = require('../functions/identityCrossSignVerify');
    const { fabricIdentityIdFromPubkeyHex } = require('@fabric/core/functions/fabricIdentitySchnorr');
    const ident = new Identity(new Key());
    const peer = new Identity(new Key());
    const nonce = crypto.randomBytes(32).toString('hex');
    assert.throws(
      () => signCrossSign(ident, { peerPubkey: peer.pubkey, nonce }, 'ChatMessage'),
      /unknown cross-sign type/i
    );
    assert.strictEqual(buildCrossSignMessage(nonce, 'aa', peer.pubkey), null);
    assert.throws(() => fabricIdentityIdFromPubkeyHex('02aa'), /66 hex/i);
    assert.ok(typeof fabricIdentityIdFromPubkeyHex(ident.fabricKey.pubkey) === 'string');
    assert.strictEqual(SIGN_TYPE, 'IdentityCrossSign');
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
    const coreChat = require('@fabric/core/functions/fabricChatText');
    // Hub wraps http normalize to sanitize Number(null)/'' created timestamps (epoch 0).
    // http `cff2ce66` re-exports core shoutbox helpers (core pin `4a1ff0a57`).
    assert.strictEqual(httpChat.chatTextOf, coreChat.chatTextOf);
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

  it('resolves core home-env / key-material helpers on this pin', function () {
    const home = require('@fabric/core/functions/fabricHomeEnv');
    const material = require('@fabric/core/functions/fabricKeyMaterial');
    assert.strictEqual(typeof home.loadFabricHomeEnv, 'function');
    assert.strictEqual(typeof material.parseRawSeedHex, 'function');
    assert.strictEqual(typeof material.keySettingsFromEnv, 'function');
    assert.strictEqual(material.classifyFabricKeyMaterial('aa'.repeat(32)).kind, 'seedHex');
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
