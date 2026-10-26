'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Key = require('@fabric/core/types/key');
const Identity = require('@fabric/core/types/identity');
const IdentityCluster = require('../functions/identityCluster');
const { SIGN_TYPE, REVOKE_TYPE } = require('../functions/identityCrossSign');
const { signCrossSign, verifyCrossSignObject } = require('../functions/identityCrossSignVerify');
const { ingestIdentityCrossSign, ensureCluster, restoreCluster, loadStoredProofs } = require('../functions/identityClusterHttp');
const { peerIdOf, mergeLinkedDevice, removeLinkedDevice, readLinkedDevices, revokeLinkedDevice } = require('../functions/fabricLinkedDevices');

function nonce () {
  return crypto.randomBytes(32).toString('hex');
}

function binding (origin = 'https://hub.example') {
  return {
    sessionId: crypto.randomBytes(24).toString('hex'),
    nonce: nonce(),
    origin
  };
}

function edge (localPubkey, peerPubkey, bound) {
  return Object.assign({ localPubkey, peerPubkey }, bound);
}

describe('@fabric/hub identityCluster', function () {
  it('unions pubkeys that cross-signed the same session', function () {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const bound = binding();
    const c = new IdentityCluster();
    c.ingestCrossSign(edge(a, b, bound));
    c.ingestCrossSign(edge(b, a, bound));
    assert.strictEqual(c.clusterEquals(a, b), true);
    assert.strictEqual(c.canonicalOf(a), a < b ? a : b);
    assert.strictEqual(SIGN_TYPE, 'IdentityCrossSign');
  });

  it('does not union halves from different sessions or origins', function () {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const first = binding();
    const c = new IdentityCluster();
    c.ingestCrossSign(edge(a, b, first));
    c.ingestCrossSign(edge(b, a, Object.assign({}, first, { sessionId: crypto.randomBytes(24).toString('hex') })));
    assert.strictEqual(c.clusterEquals(a, b), false);
    c.ingestCrossSign(edge(b, a, Object.assign({}, first, { origin: 'https://evil.example' })));
    assert.strictEqual(c.clusterEquals(a, b), false);
    c.ingestCrossSign(edge(b, a, first));
    assert.strictEqual(c.clusterEquals(a, b), true);
  });

  it('refuses records without a session binding', function () {
    const c = new IdentityCluster();
    assert.strictEqual(c.ingestCrossSign({
      localPubkey: 'aa'.repeat(32),
      peerPubkey: 'bb'.repeat(32),
      nonce: nonce()
    }).ok, false);
  });

  it('rejects non-hex and colon-smashed pubkeys', function () {
    const b = 'bb'.repeat(32);
    const c = new IdentityCluster();
    assert.strictEqual(c.ingestCrossSign(edge('aa:bb', b, binding())).ok, false);
    assert.strictEqual(c.ingestCrossSign(edge('not-a-key', b, binding())).reason, 'invalid pubkey');
  });

  it('does not union independent seeds', function () {
    const a = '11'.repeat(32);
    const b = '22'.repeat(32);
    const c = '33'.repeat(32);
    const cluster = new IdentityCluster();
    const bound = binding();
    cluster.ingestCrossSign(edge(a, b, bound));
    cluster.ingestCrossSign(edge(b, a, bound));
    assert.strictEqual(cluster.clusterEquals(a, c), false);
    assert.strictEqual(cluster.clusterOf(a).size, 2);
  });

  it('transits three devices, splits on revoke of one session, and relinks in a new one', function () {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    const d = 'dd'.repeat(32);
    const c = new IdentityCluster();
    const s1 = binding();
    const s2 = binding();
    c.ingestCrossSign(edge(a, b, s1));
    c.ingestCrossSign(edge(b, a, s1));
    c.ingestCrossSign(edge(b, d, s2));
    c.ingestCrossSign(edge(d, b, s2));
    assert.strictEqual(c.clusterEquals(a, d), true);
    c.ingestRevoke(edge(b, d, s1));
    assert.strictEqual(c.clusterEquals(a, d), true, 'a revoke for another session changes nothing');
    c.ingestRevoke(edge(b, d, s2));
    assert.strictEqual(c.clusterEquals(a, b), true);
    assert.strictEqual(c.clusterEquals(a, d), false);
    assert.strictEqual(c.ingestCrossSign(edge(b, d, s2)).reason, 'revoked');
    const s3 = binding();
    c.ingestCrossSign(edge(b, d, s3));
    c.ingestCrossSign(edge(d, b, s3));
    assert.strictEqual(c.clusterEquals(a, d), true);
  });

  it('peerIdOf prefers peerFabricId', function () {
    assert.strictEqual(peerIdOf({ peerFabricId: 'id1a', peerPubkey: 'aa' }), 'id1a');
    assert.strictEqual(peerIdOf({ peerPubkey: 'bb' }), 'bb');
  });
});

describe('@fabric/hub identity cluster HTTP ingest', function () {
  function memoryHub () {
    const docs = {};
    return {
      docs,
      fs: {
        readFile (name) { return Object.prototype.hasOwnProperty.call(docs, name) ? JSON.stringify(docs[name]) : null; },
        async publish (name, doc) { docs[name] = JSON.parse(JSON.stringify(doc)); }
      }
    };
  }

  it('ingests mutual Schnorr proofs then revoke', function () {
    const hub = {};
    ensureCluster(hub);
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const bound = binding();
    const ab = signCrossSign(a, Object.assign({ peerPubkey: b.fabricKey.pubkey }, bound));
    const ba = signCrossSign(b, Object.assign({ peerPubkey: a.fabricKey.pubkey }, bound));
    assert.strictEqual(verifyCrossSignObject(ab).ok, true);
    assert.strictEqual(ingestIdentityCrossSign(hub, ab, ab.pubkeyHex).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(ab.localPubkey, ba.localPubkey), false);
    assert.strictEqual(ingestIdentityCrossSign(hub, ba, ba.pubkeyHex).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(ab.localPubkey, ba.localPubkey), true);
    const rev = signCrossSign(a, Object.assign({ peerPubkey: b.fabricKey.pubkey }, bound), REVOKE_TYPE);
    assert.strictEqual(ingestIdentityCrossSign(hub, rev, rev.pubkeyHex).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(ab.localPubkey, ba.localPubkey), false);
  });

  it('ingests a cross-sign wrapped in a mesh CONTRACT_MESSAGE body', function () {
    const hub = {};
    ensureCluster(hub);
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const bound = binding();
    const ab = signCrossSign(a, Object.assign({ peerPubkey: b.fabricKey.pubkey }, bound));
    const ba = signCrossSign(b, Object.assign({ peerPubkey: a.fabricKey.pubkey }, bound));
    const wrap = (object) => ({ contract: 'identity-cluster', type: SIGN_TYPE, actor: { publicKey: object.pubkeyHex }, object });
    assert.strictEqual(ingestIdentityCrossSign(hub, wrap(ab), ab.pubkeyHex).ok, true);
    assert.strictEqual(ingestIdentityCrossSign(hub, wrap(ba), ba.pubkeyHex).ok, true);
    assert.strictEqual(hub.identityCluster.clusterEquals(ab.localPubkey, ba.localPubkey), true);
  });

  it('refuses a tampered cross-sign', function () {
    const hub = {};
    ensureCluster(hub);
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const ab = signCrossSign(a, Object.assign({ peerPubkey: b.fabricKey.pubkey }, binding()));
    const forged = Object.assign({}, ab, { origin: 'https://evil.example' });
    assert.strictEqual(ingestIdentityCrossSign(hub, forged, forged.pubkeyHex).ok, false);
  });

  it('rebuilds the cluster from stored proofs that still verify and drops the rest', function () {
    const hub = memoryHub();
    const a = new Identity(new Key());
    const b = new Identity(new Key());
    const bound = binding();
    const ab = signCrossSign(a, Object.assign({ peerPubkey: b.fabricKey.pubkey }, bound));
    const ba = signCrossSign(b, Object.assign({ peerPubkey: a.fabricKey.pubkey }, bound));
    const stale = {
      type: SIGN_TYPE,
      localPubkey: ab.localPubkey,
      peerPubkey: 'cc'.repeat(33),
      nonce: bound.nonce,
      signature: 'ab'.repeat(64),
      pubkeyHex: ab.pubkeyHex
    };
    hub.docs['identity/CROSS-SIGNS'] = { proofs: [ab, stale, ba] };
    restoreCluster(hub);
    assert.strictEqual(hub.identityCluster.clusterEquals(ab.localPubkey, ba.localPubkey), true);
    assert.strictEqual(hub.docs['identity/CROSS-SIGNS'].proofs.length, 2);
    assert.strictEqual(loadStoredProofs(hub).length, 2);
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

  it('asks to link again before revoking a row without a session binding', async function () {
    const row = {
      kind: 'device-link',
      peerFabricId: 'id1ccc',
      peerPubkey: '02' + 'cc'.repeat(32),
      nonce: nonce(),
      label: 'Old Passport'
    };
    mergeLinkedDevice(row);
    const r = await revokeLinkedDevice(row, new Key());
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Link it again/);
    assert.strictEqual(readLinkedDevices().length, 1);
  });
});
