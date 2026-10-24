'use strict';

/**
 * Three Hubs on a private regtest network, started through the deploy
 * script's mesh (`scripts/lib/localNetwork.js`): a 2-of-3 named federation is
 * created by the seed, joined over the Fabric wire by both stand-ins, funded
 * from the seed's wallet, and spent with a withdrawal requested by one
 * stand-in and approved by the other. Only admin JSON-RPC drives the Hubs.
 *
 * Opt-in (needs bitcoind on PATH, takes a few minutes):
 *   npm run test:federation-regtest
 * `FABRIC_FEDERATION_REGTEST_KEEP=1` keeps the instances and their directory.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const net = require('../scripts/lib/localNetwork');
const deploy = require('../scripts/deploy');

const ENABLED = process.env.FABRIC_FEDERATION_REGTEST === '1';
const KEEP = process.env.FABRIC_FEDERATION_REGTEST_KEEP === '1';
const BASE = Number(process.env.FABRIC_FEDERATION_REGTEST_BASE || 33000);

const DEPOSIT_SATS = 100000000;
const WITHDRAW_SATS = 40000000;

async function waitUntil (label, fn, timeoutMs = 120000, everyMs = 2000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await net.sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last.message}` : ''}`);
}

(ENABLED ? describe : describe.skip)('named federation on a private regtest network (3 Hubs)', function () {
  this.timeout(900000);

  let root;
  let ctx;
  const hubs = {};

  async function rpc (name, method, params = {}) {
    const hub = hubs[name];
    const r = await net.httpJson(hub.port, 'POST', '/services/rpc', {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [Object.assign({ adminToken: hub.token }, params)]
    }, {}, 60000);
    const body = r.body || {};
    if (body.error) throw new Error(`${name} ${method}: ${body.error.message || JSON.stringify(body.error)}`);
    if (!body.result || body.result.status === 'error') {
      throw new Error(`${name} ${method}: ${(body.result && body.result.message) || `HTTP ${r.status}`}`);
    }
    return body.result;
  }

  const federation = (name, id) => rpc(name, 'GetNamedFederation', { federationId: id }).then((r) => r.federation);

  before(async function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-federation-regtest-'));
    ctx = deploy.context({ network: 'regtest', root, base: BASE });
    await deploy.start(ctx);
    for (const instance of ctx.instances) {
      hubs[instance.name] = {
        port: instance.ports.http,
        url: `http://127.0.0.1:${instance.ports.http}`,
        token: fs.readFileSync(instance.tokenFile, 'utf8').trim()
      };
    }
    for (const name of Object.keys(hubs)) {
      hubs[name].pubkey = (await rpc(name, 'GetHubIdentity')).pubkey;
    }
  });

  after(async function () {
    if (!ctx || KEEP) return;
    await deploy.stop(ctx);
    fs.rmSync(root, { recursive: true, force: true });
  });

  let federationId;
  let vaultAddress;

  it('every Hub has its own key', function () {
    const keys = Object.values(hubs).map((h) => h.pubkey);
    assert.strictEqual(new Set(keys).size, 3);
    for (const k of keys) assert.match(k, /^0[23][0-9a-f]{64}$/);
  });

  it('creates a 2-of-3 federation, adding the other Hubs by URL (verified attestation)', async function () {
    const members = [];
    for (const name of ['hub-fabric-pub', 'hub-goon-vc']) {
      const resolved = await rpc('seed', 'ResolveHubIdentity', { url: hubs[name].url });
      assert.strictEqual(resolved.pubkey, hubs[name].pubkey, `${name} attestation key`);
      members.push({ pubkey: resolved.pubkey, url: resolved.url, alias: resolved.alias });
    }
    const { federation: f } = await rpc('seed', 'CreateNamedFederation', { name: 'Regtest Launch', threshold: 2, members });
    assert.strictEqual(f.status, 'pending');
    assert.strictEqual(f.threshold, 2);
    assert.strictEqual(f.validators.length, 3);
    federationId = f.id;
    vaultAddress = f.vaultAddress;
    assert.match(vaultAddress, /^bcrt1p/);
  });

  it('both Hubs receive the invite over Fabric and accept it', async function () {
    for (const name of ['hub-fabric-pub', 'hub-goon-vc']) {
      const invite = await waitUntil(`${name} invite`, async () => {
        const r = await rpc(name, 'ListNamedFederations');
        return r.pending.invites.find((x) => x.id === federationId);
      });
      assert.strictEqual(invite.vaultAddress, vaultAddress);
      const { federation: f } = await rpc(name, 'AcceptFederationInvite', { federationId });
      assert.strictEqual(f.selfStatus, 'accepted');
    }
  });

  it('all three Hubs agree: active, same descriptor, same vault', async function () {
    const views = await waitUntil('federation active everywhere', async () => {
      const list = await Promise.all(Object.keys(hubs).map((name) => federation(name, federationId)));
      return list.every((f) => f.status === 'active' && f.members.every((m) => m.status === 'accepted')) ? list : null;
    }, 90000);
    const descriptors = views.map((f) => JSON.stringify(f.descriptor));
    assert.strictEqual(new Set(descriptors).size, 1);
    for (const f of views) assert.strictEqual(f.vaultAddress, vaultAddress);
  });

  it('deposits from the seed wallet into the vault', async function () {
    const { deposit } = await rpc('seed', 'DepositToFederation', { federationId, amountSats: DEPOSIT_SATS, feeRateSatVb: 2 });
    assert.match(deposit.txid, /^[0-9a-f]{64}$/);
    assert.strictEqual(deposit.vaultAddress, vaultAddress);
    // hub-goon-vc reads its own bitcoind: the block reached it over the private network.
    await waitUntil('confirmed deposit on hub-goon-vc', async () => {
      const f = await federation('hub-goon-vc', federationId);
      return f.balanceSats === DEPOSIT_SATS;
    }, 120000, 3000);
  });

  it('spends 2-of-3: hub-goon-vc requests, hub-fabric-pub approves, the seed never signs', async function () {
    const { wallet } = await rpc('hub-goon-vc', 'GetHubWallet');
    const before = Number(wallet.trustedSats || 0);
    const { withdrawal: requested } = await rpc('hub-goon-vc', 'CreateFederationWithdrawal', {
      federationId,
      destinationAddress: wallet.address,
      amountSats: WITHDRAW_SATS,
      feeRateSatVb: 2
    });
    assert.strictEqual(requested.status, 'pending');
    assert.deepStrictEqual(requested.signers, [hubs['hub-goon-vc'].pubkey.slice(2)]);

    const pending = await waitUntil('approval request on hub-fabric-pub', async () => {
      const r = await rpc('hub-fabric-pub', 'ListNamedFederations');
      return r.pending.withdrawals.find((w) => w.requestId === requested.requestId);
    });
    assert.strictEqual(pending.destinationAddress, wallet.address);
    assert.strictEqual(pending.amountSats, WITHDRAW_SATS);

    const { withdrawal: approved } = await rpc('hub-fabric-pub', 'ApproveFederationWithdrawal', {
      federationId,
      requestId: requested.requestId
    });
    assert.strictEqual(approved.status, 'broadcast');
    assert.match(approved.txid, /^[0-9a-f]{64}$/);

    const seedView = await waitUntil('broadcast seen by the seed', async () => {
      const f = await federation('seed', federationId);
      const w = f.withdrawals.find((x) => x.requestId === requested.requestId);
      return w && w.status === 'broadcast' ? w : null;
    });
    assert.strictEqual(seedView.txid, approved.txid);
    assert.ok(!seedView.signers.includes(hubs.seed.pubkey.slice(2)), 'seed did not sign');

    const change = DEPOSIT_SATS - WITHDRAW_SATS - approved.feeSats;
    await waitUntil('confirmed withdrawal', async () => {
      const f = await federation('hub-fabric-pub', federationId);
      const w = await rpc('hub-goon-vc', 'GetHubWallet');
      return f.balanceSats === change && Number(w.wallet.trustedSats) >= before + WITHDRAW_SATS;
    }, 120000, 3000);
  });
});
