'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const IdentityCluster = require('../functions/identityCluster');
const { SIGN_TYPE, REVOKE_TYPE } = require('../functions/identityCrossSign');
const { signCrossSign, verifyCrossSignObject } = require('../functions/identityCrossSignVerify');
const { ingestIdentityCrossSign, ensureCluster } = require('../functions/identityClusterHttp');
const { peerIdOf, mergeLinkedDevice, removeLinkedDevice, readLinkedDevices } = require('../functions/fabricLinkedDevices');

function nonce () {
  return crypto.randomBytes(32).toString('hex');
}

describe('@fabric/hub identityCluster', function () {
  it('unions mutually cross-signed pubkeys', function () {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const n = crypto.randomBytes(32).toString('hex');
    const c = new IdentityCluster();
    c.ingestCrossSign({ localPubkey: a, peerPubkey: b, nonce: n });
    c.ingestCrossSign({ localPubkey: b, peerPubkey: a, nonce: n });
    assert.strictEqual(c.clusterEquals(a, b), true);
    assert.strictEqual(c.canonicalOf(a), a < b ? a : b);
    assert.strictEqual(SIGN_TYPE, 'IdentityCrossSign');
  });

  it('does not union independent seeds', function () {
    const a = '11'.repeat(32);
    const b = '22'.repeat(32);
    const c = '33'.repeat(32);
    const cluster = new IdentityCluster();
    const n = nonce();
    cluster.ingestCrossSign({ localPubkey: a, peerPubkey: b, nonce: n });
    cluster.ingestCrossSign({ localPubkey: b, peerPubkey: a, nonce: n });
    assert.strictEqual(cluster.clusterEquals(a, c), false);
    assert.strictEqual(cluster.clusterOf(a).size, 2);
  });

  it('transits three devices then splits on revoke of the hub edge', function () {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const d = 'dd'.repeat(32);
    const c = new IdentityCluster();
    const n1 = nonce();
    const n2 = nonce();
    c.ingestCrossSign({ localPubkey: a, peerPubkey: b, nonce: n1 });
    c.ingestCrossSign({ localPubkey: b, peerPubkey: a, nonce: n1 });
    c.ingestCrossSign({ localPubkey: b, peerPubkey: d, nonce: n2 });
    c.ingestCrossSign({ localPubkey: d, peerPubkey: b, nonce: n2 });
    assert.strictEqual(c.clusterEquals(a, d), true);
    c.ingestRevoke({ localPubkey: b, peerPubkey: d });
    assert.strictEqual(c.clusterEquals(a, b), true);
    assert.strictEqual(c.clusterEquals(a, d), false);
    assert.strictEqual(c.ingestCrossSign({
      localPubkey: b,
      peerPubkey: d,
      nonce: n2
    }).reason, 'revoked');
  });

  it('peerIdOf prefers peerFabricId', function () {
    assert.strictEqual(peerIdOf({ peerFabricId: 'id1a', peerPubkey: 'aa' }), 'id1a');
    assert.strictEqual(peerIdOf({ peerPubkey: 'bb' }), 'bb');
  });
});

describe('@fabric/hub identity cluster HTTP ingest', function () {
  it('ingests mutual Schnorr proofs then revoke', function () {
    const hub = {};
    ensureCluster(hub);
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const n = nonce();
    const ab = signCrossSign(a, { peerPubkey: b.pubkey, nonce: n });
    const ba = signCrossSign(b, { peerPubkey: a.pubkey, nonce: n });
    assert.strictEqual(verifyCrossSignObject(ab).ok, true);
    assert.strictEqual(ingestIdentityCrossSign(hub, ab, a.pubkey).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(a.pubkey, b.pubkey), false);
    assert.strictEqual(ingestIdentityCrossSign(hub, ba, b.pubkey).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(a.pubkey, b.pubkey), true);
    const rev = signCrossSign(a, { peerPubkey: b.pubkey, nonce: n }, REVOKE_TYPE);
    assert.strictEqual(ingestIdentityCrossSign(hub, rev, a.pubkey).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(a.pubkey, b.pubkey), false);
  });
});

describe('@fabric/hub linked-device roster', function () {
  beforeEach(function () {
    const mem = {};
    global.window = {
      localStorage: {
        getItem (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem (k, v) { mem[k] = String(v); },
        removeItem (k) { delete mem[k]; }
      }
    };
    require('../functions/fabricBrowserState').resetFabricBrowserStateStore();
  });

  afterEach(function () {
    require('../functions/fabricBrowserState').resetFabricBrowserStateStore();
    delete global.window;
  });

  it('merges and removes a Passport row by fabric id', function () {
    mergeLinkedDevice({
      kind: 'device-link',
      peerFabricId: 'id1aaa',
      peerPubkey: '02' + 'aa'.repeat(32),
      nonce: nonce(),
      label: 'Passport'
    });
    mergeLinkedDevice({
      kind: 'device-link',
      peerFabricId: 'id1bbb',
      peerPubkey: '02' + 'bb'.repeat(32),
      nonce: nonce(),
      label: 'Android'
    });
    assert.strictEqual(readLinkedDevices().length, 2);
    removeLinkedDevice('id1aaa');
    const left = readLinkedDevices();
    assert.strictEqual(left.length, 1);
    assert.strictEqual(left[0].label, 'Android');
  });
});
