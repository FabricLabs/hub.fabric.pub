'use strict';

/**
 * Unit coverage for one-time playnet operator sweep helpers:
 * wipe (localFlushToSnapshot) → fund plan → deploy accept (tracked contracts).
 */

const assert = require('assert');
const http = require('http');

const {
  loadPlaynetContract,
  localFlushToSnapshot,
  planPlaynetOperatorSweep,
  hubRpc,
  playnetPeers,
  productionPlaynetTarget,
  loadMnemonic,
  loadPeerKeySettings,
  fallbackPeerKeySettingsFromEnv,
  loadLocalOperatorMnemonic
} = require('../scripts/lib/playnetOps');

const FIXTURE_CONTRACT_ID = 'ab'.repeat(32);

describe('playnet ops sweep (wipe → fund → deploy)', function () {
  it('loadPlaynetContract reads FABRIC_PLAYNET_CONTRACT_ID', function () {
    const prev = process.env.FABRIC_PLAYNET_CONTRACT_ID;
    try {
      process.env.FABRIC_PLAYNET_CONTRACT_ID = FIXTURE_CONTRACT_ID;
      const loaded = loadPlaynetContract();
      assert.strictEqual(loaded.contractId, FIXTURE_CONTRACT_ID);
      assert.strictEqual(loaded.source, 'env');
    } finally {
      if (prev === undefined) delete process.env.FABRIC_PLAYNET_CONTRACT_ID;
      else process.env.FABRIC_PLAYNET_CONTRACT_ID = prev;
    }
  });

  it('plans wipe → fund → deploy in order', function () {
    const snap = 'cd'.repeat(32);
    const plan = planPlaynetOperatorSweep({
      snapshotBlockHash: snap,
      receiveAddress: 'bcrt1qtest',
      faucetAmountSats: 25000,
      accept: true,
      hub: 'http://127.0.0.1:8080',
      contractId: FIXTURE_CONTRACT_ID
    });
    assert.deepStrictEqual(plan.steps, ['wipe', 'fund', 'deploy']);
    assert.strictEqual(plan.wipe.snapshotBlockHash, snap);
    assert.strictEqual(plan.wipe.network, 'regtest');
    assert.strictEqual(plan.fund.mode, 'hub-faucet');
    assert.strictEqual(plan.fund.amountSats, 25000);
    assert.strictEqual(plan.deploy.contractId, FIXTURE_CONTRACT_ID);
    assert.strictEqual(plan.deploy.accept, true);
    assert.strictEqual(plan.deploy.acceptMethod, 'AcceptTrackedApplicationContract');
  });

  it('rejects invalid snapshot hashes in plan', function () {
    assert.throws(
      () => planPlaynetOperatorSweep({ snapshotBlockHash: 'nope' }),
      /64 hex/
    );
  });

  it('localFlushToSnapshot walks tip back via injectable cli', async function () {
    const genesis = '11'.repeat(32);
    const mid = '22'.repeat(32);
    const tip = '33'.repeat(32);
    const chain = [genesis, mid, tip];
    let cursor = chain.length - 1;
    const result = await localFlushToSnapshot(genesis, {
      runCli: async (args) => {
        if (args[0] === 'getbestblockhash') return chain[cursor];
        if (args[0] === 'invalidateblock') {
          assert.strictEqual(args[1], chain[cursor]);
          cursor -= 1;
          return '';
        }
        throw new Error(`unexpected cli ${args.join(' ')}`);
      }
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.steps, 2);
    assert.strictEqual(result.tip, genesis);
  });

  it('hubRpc AcceptTrackedApplicationContract against fake Hub', async function () {
    let accepted = null;
    const server = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          assert.strictEqual(req.url, '/services/rpc');
          if (parsed.method === 'AcceptTrackedApplicationContract') {
            const params = Array.isArray(parsed.params) ? parsed.params[0] : parsed.params;
            accepted = params;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: { ok: true, contractId: params.contractId, status: 'accepted' }
            }));
            return;
          }
          if (parsed.method === 'ListTrackedApplicationContracts') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: {
                pending: [],
                accepted: accepted
                  ? [{ contractId: accepted.contractId, status: 'accepted' }]
                  : []
              }
            }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { message: `unknown ${parsed.method}` }
          }));
        });
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const accept = await hubRpc('AcceptTrackedApplicationContract', {
        contractId: FIXTURE_CONTRACT_ID,
        adminToken: 'test-admin-token'
      }, { baseUrl });
      assert.strictEqual(accept.ok, true);
      assert.strictEqual(accept.contractId, FIXTURE_CONTRACT_ID);
      const listed = await hubRpc('ListTrackedApplicationContracts', {}, { baseUrl });
      assert.strictEqual(listed.accepted[0].contractId, FIXTURE_CONTRACT_ID);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('playnetPeers respects env / argv override', function () {
    const prev = process.env.FABRIC_PLAYNET_PEERS;
    try {
      process.env.FABRIC_PLAYNET_PEERS = 'a.example:7777, b.example:7777';
      assert.deepStrictEqual(playnetPeers(), ['a.example:7777', 'b.example:7777']);
      assert.deepStrictEqual(playnetPeers(['127.0.0.1:7777']), ['127.0.0.1:7777']);
    } finally {
      if (prev === undefined) delete process.env.FABRIC_PLAYNET_PEERS;
      else process.env.FABRIC_PLAYNET_PEERS = prev;
    }
  });

  it('productionPlaynetTarget defaults to hub.fabric.pub + relay.goon.vc', function () {
    const prevU = process.env.FABRIC_HUB_RPC_URL;
    const prevH = process.env.FABRIC_HUB_URL;
    const prevP = process.env.FABRIC_PLAYNET_PEERS;
    const prevF = process.env.FABRIC_FLUSH_PEERS;
    try {
      delete process.env.FABRIC_HUB_RPC_URL;
      delete process.env.FABRIC_HUB_URL;
      delete process.env.FABRIC_PLAYNET_PEERS;
      delete process.env.FABRIC_FLUSH_PEERS;
      const t = productionPlaynetTarget();
      assert.strictEqual(t.hubUrl, 'https://hub.fabric.pub');
      assert.deepStrictEqual(t.peers, ['hub.fabric.pub:7777', 'relay.goon.vc:7777']);
    } finally {
      if (prevU === undefined) delete process.env.FABRIC_HUB_RPC_URL;
      else process.env.FABRIC_HUB_RPC_URL = prevU;
      if (prevH === undefined) delete process.env.FABRIC_HUB_URL;
      else process.env.FABRIC_HUB_URL = prevH;
      if (prevP === undefined) delete process.env.FABRIC_PLAYNET_PEERS;
      else process.env.FABRIC_PLAYNET_PEERS = prevP;
      if (prevF === undefined) delete process.env.FABRIC_FLUSH_PEERS;
      else process.env.FABRIC_FLUSH_PEERS = prevF;
    }
  });

  it('loadPeerKeySettings prefers FABRIC_XPRV over FABRIC_SEED / agent file', function () {
    const Key = require('@fabric/core/types/key');
    const primary = new Key();
    const other = new Key();
    const prevX = process.env.FABRIC_XPRV;
    const prevS = process.env.FABRIC_SEED;
    const prevM = process.env.FABRIC_MNEMONIC;
    try {
      process.env.FABRIC_XPRV = primary.xprv;
      process.env.FABRIC_SEED = other.mnemonic;
      process.env.FABRIC_MNEMONIC = other.mnemonic;
      const key = loadPeerKeySettings();
      assert.ok(key && key.xprv === primary.xprv);
      delete process.env.FABRIC_XPRV;
      process.env.FABRIC_SEED = primary.xprv;
      const fromSeedXprv = loadPeerKeySettings({ allowLocalIdentityFallback: false });
      assert.ok(fromSeedXprv && fromSeedXprv.xprv === primary.xprv);
      delete process.env.FABRIC_SEED;
      process.env.FABRIC_MNEMONIC = primary.mnemonic;
      const fromMn = loadPeerKeySettings({ allowLocalIdentityFallback: false });
      assert.ok(fromMn && fromMn.mnemonic === primary.mnemonic);
      assert.strictEqual(loadMnemonic({ allowLocalIdentityFallback: false }), primary.mnemonic);
    } finally {
      if (prevX === undefined) delete process.env.FABRIC_XPRV;
      else process.env.FABRIC_XPRV = prevX;
      if (prevS === undefined) delete process.env.FABRIC_SEED;
      else process.env.FABRIC_SEED = prevS;
      if (prevM === undefined) delete process.env.FABRIC_MNEMONIC;
      else process.env.FABRIC_MNEMONIC = prevM;
    }
  });

  it('fallbackPeerKeySettingsFromEnv keeps raw FABRIC_SEED hex as seed', function () {
    const hex = 'ab'.repeat(32);
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.deepStrictEqual(
      fallbackPeerKeySettingsFromEnv({ FABRIC_SEED: hex, FABRIC_MNEMONIC: phrase }),
      { seed: hex }
    );
    assert.deepStrictEqual(
      fallbackPeerKeySettingsFromEnv({ FABRIC_SEED: '0x' + hex.toUpperCase() }),
      { seed: hex }
    );
    assert.strictEqual(
      fallbackPeerKeySettingsFromEnv({ FABRIC_SEED: 'not-a-seed-or-mnemonic' }),
      null
    );
    assert.deepStrictEqual(
      fallbackPeerKeySettingsFromEnv({ FABRIC_MNEMONIC: phrase }),
      { mnemonic: phrase }
    );
  });

  it('does not treat invalid FABRIC_SEED as a mnemonic when core keySettingsFromEnv is present', function () {
    const prevX = process.env.FABRIC_XPRV;
    const prevS = process.env.FABRIC_SEED;
    const prevM = process.env.FABRIC_MNEMONIC;
    try {
      delete process.env.FABRIC_XPRV;
      delete process.env.FABRIC_MNEMONIC;
      process.env.FABRIC_SEED = 'not-a-seed-or-mnemonic';
      assert.strictEqual(loadPeerKeySettings({
        allowLocalIdentityFallback: false,
        allowWalletFallback: false
      }), null);
    } finally {
      if (prevX === undefined) delete process.env.FABRIC_XPRV;
      else process.env.FABRIC_XPRV = prevX;
      if (prevS === undefined) delete process.env.FABRIC_SEED;
      else process.env.FABRIC_SEED = prevS;
      if (prevM === undefined) delete process.env.FABRIC_MNEMONIC;
      else process.env.FABRIC_MNEMONIC = prevM;
    }
  });

  it('loadMnemonic uses env before optional local operator-identity fallback', function () {
    const localMn = loadLocalOperatorMnemonic();
    const prevMn = process.env.FABRIC_MNEMONIC;
    const prevX = process.env.FABRIC_XPRV;
    const prevS = process.env.FABRIC_SEED;
    try {
      delete process.env.FABRIC_XPRV;
      delete process.env.FABRIC_SEED;
      process.env.FABRIC_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      assert.strictEqual(loadMnemonic(), process.env.FABRIC_MNEMONIC);
      delete process.env.FABRIC_MNEMONIC;
      if (localMn) {
        const key = loadPeerKeySettings();
        assert.ok(key && (key.mnemonic === localMn || !!key.xprv));
        assert.strictEqual(loadPeerKeySettings({ allowLocalIdentityFallback: false }), null);
      }
    } finally {
      if (prevMn === undefined) delete process.env.FABRIC_MNEMONIC;
      else process.env.FABRIC_MNEMONIC = prevMn;
      if (prevX === undefined) delete process.env.FABRIC_XPRV;
      else process.env.FABRIC_XPRV = prevX;
      if (prevS === undefined) delete process.env.FABRIC_SEED;
      else process.env.FABRIC_SEED = prevS;
    }
  });

  it('plans local Hub as playnet registry (loopback Accept, omit public Hub peer)', function () {
    const { planLocalHubAsPlaynetRegistry } = require('../scripts/lib/playnetOps');
    const plan = planLocalHubAsPlaynetRegistry({
      hub: 'http://127.0.0.1:8080',
      includeRelay: true
    });
    assert.strictEqual(plan.role, 'local-registry');
    assert.strictEqual(plan.networkAlwaysExists, true);
    assert.strictEqual(plan.management.shortTerm, 'local-lead');
    assert.strictEqual(plan.management.longTerm, 'hub.fabric.pub');
    assert.strictEqual(plan.safe, true);
    assert.strictEqual(plan.acceptMethod, 'AcceptTrackedApplicationContract');
    assert.strictEqual(plan.peers[0], '127.0.0.1:7777');
    assert.ok(plan.peers.includes('relay.goon.vc:7777'));
    assert.ok(!plan.peers.some((p) => /hub\.fabric\.pub/i.test(p)));
    assert.ok(plan.readinessRpc.includes('ListTrackedApplicationContracts'));
    assert.strictEqual(plan.expectNativeBeacon, 'fabric-beacon');

    const bad = planLocalHubAsPlaynetRegistry({ hub: 'https://hub.fabric.pub' });
    assert.strictEqual(bad.safe, false);
    assert.ok(bad.blockers.length >= 1);
  });

  it('plans short-term local lead vs long-term hub.fabric.pub management', function () {
    const { planPlaynetLeadCapture } = require('../scripts/lib/playnetOps');
    const local = planPlaynetLeadCapture({ horizon: 'local-lead' });
    assert.strictEqual(local.networkAlwaysExists, true);
    assert.strictEqual(local.horizon, 'local-lead');
    assert.strictEqual(local.safe, true);
    const remote = planPlaynetLeadCapture({ horizon: 'hub.fabric.pub' });
    assert.strictEqual(remote.horizon, 'hub.fabric.pub');
    assert.strictEqual(remote.active.registryPeer, 'hub.fabric.pub:7777');
  });
});
