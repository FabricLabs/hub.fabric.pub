'use strict';

// Hub coinjoin service over in-memory wallets and chain. Uses the coinjoin
// market from a sibling `@fabric/core` checkout (`FABRIC_CORE`, default
// `../fabric-clean`) until the pinned core ships it; skipped without one.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CoinjoinService = require('../services/coinjoin');

const CORE_DIR = path.resolve(process.env.FABRIC_CORE || path.join(__dirname, '..', '..', 'fabric-clean'));
const HAS_CORE = fs.existsSync(path.join(CORE_DIR, 'types', 'coinjoin.js'));

function loadCore () {
  const rounds = require(path.join(CORE_DIR, 'types', 'coinjoinRound'));
  return {
    Coinjoin: require(path.join(CORE_DIR, 'types', 'coinjoin')),
    Bond: require(path.join(CORE_DIR, 'types', 'bond')),
    CoinjoinBook: require(path.join(CORE_DIR, 'types', 'coinjoinBook')),
    CoinjoinTakerRound: rounds.CoinjoinTakerRound,
    CoinjoinMakerRound: rounds.CoinjoinMakerRound,
    memoryWallet: rounds.memoryWallet,
    memoryChain: rounds.memoryChain,
    Key: require(path.join(CORE_DIR, 'types', 'key'))
  };
}

function memoryFs () {
  const files = new Map();
  return {
    files,
    async publish (name, doc) {
      files.set(name, typeof doc === 'string' ? doc : JSON.stringify(doc));
    },
    readFile (name) {
      return files.has(name) ? Buffer.from(files.get(name)) : null;
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('services/coinjoin', function () {
  this.timeout(20000);

  let core;
  before(function () {
    if (!HAS_CORE) return this.skip();
    core = loadCore();
  });

  function coin (chain, valueSats, confirmations = 10) {
    const c = {
      txid: crypto.randomBytes(32).toString('hex'),
      vout: 0,
      valueSats,
      internalPrivateKey: core.Coinjoin.randomPrivateKey(),
      confirmations
    };
    chain.utxos.set(`${c.txid}:0`, {
      valueSats,
      scriptPubKeyHex: core.Coinjoin.taprootKeyPath(c.internalPrivateKey).scriptPubKeyHex,
      confirmations
    });
    return c;
  }

  // A mesh of Hubs: every published CONTRACT_MESSAGE body floods to the others.
  function mesh (opts = {}) {
    const chain = core.memoryChain({ tip: { height: 1000 } });
    const queue = [];
    const hubs = [];
    const add = (label, coins, settings = {}) => {
      const service = new CoinjoinService(Object.assign({ network: 'regtest', tickMs: 0, core }, settings));
      const hub = { label, service, fs: memoryFs(), sent: 0, drop: null };
      hub.wallet = core.memoryWallet({ coins: coins.map((v) => coin(chain, v)) });
      service.attach({
        fs: hub.fs,
        key: new core.Key(),
        chain,
        wallet: hub.wallet,
        publish: (body) => {
          hub.sent++;
          if (hub.drop && hub.drop(body, hub)) return;
          queue.push({ from: hub, body });
        },
        fund: async (address, scriptPubKeyHex, amountSats) => {
          const txid = crypto.randomBytes(32).toString('hex');
          chain.utxos.set(`${txid}:1`, { valueSats: amountSats, scriptPubKeyHex, confirmations: opts.bondConfs || 10 });
          return { txid, vout: 1 };
        }
      });
      hubs.push(hub);
      return hub;
    };
    const pump = async () => {
      while (queue.length) {
        const { from, body } = queue.shift();
        for (const hub of hubs) {
          if (hub !== from) await hub.service.handleContractMessage(JSON.parse(JSON.stringify(body)));
        }
      }
    };
    return { chain, add, pump, hubs };
  }

  const MAKER_TERMS = { enable: true, poolSizesBtc: [0.05, 0.005, 0.0005], feeSats: 500, feePpm: 100 };

  it('turns pool sizes into offer bands clamped to the P2TR balance', async function () {
    const m = mesh();
    const maker = m.add('maker', [1300000]);
    await maker.service.start();
    const status = await maker.service.createOffer(MAKER_TERMS);
    assert.strictEqual(status.enabled, true);
    const bands = status.offers.map((o) => [o.minSats, o.maxSats]);
    assert.deepStrictEqual(bands, [[10000, 50000], [50001, 500000], [500001, 1300000]]);
    assert.ok(status.offers.every((o) => o.makerPubkey === maker.service.makerPubkey));
    assert.ok(maker.fs.files.has('coinjoin/maker.json'));
  });

  it('runs a round between a taker Hub and two maker Hubs and broadcasts it', async function () {
    const m = mesh();
    const makers = [m.add('a', [1300000]), m.add('b', [1300000])];
    const taker = m.add('taker', [1600000]);
    for (const h of m.hubs) await h.service.start();
    for (const h of makers) await h.service.createOffer(MAKER_TERMS);
    await m.pump();
    const listed = taker.service.listOffers({ amountSats: 1000000 });
    assert.strictEqual(listed.offers.length, 2);
    assert.strictEqual(listed.offers[0].cjfeeSats, 600);

    const started = await taker.service.startCoinjoin({ amountSats: 1000000, makers: 2 });
    assert.strictEqual(started.status, 'filled');
    await m.pump();
    const round = taker.service.roundView(started.roundId);
    assert.strictEqual(round.status, 'broadcast', round.error);
    assert.strictEqual(m.chain.broadcasts.length, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(round.txid));
    for (const h of makers) {
      const [mine] = h.service.listRounds();
      assert.strictEqual(mine.role, 'maker');
      assert.strictEqual(mine.status, 'signed');
      assert.strictEqual(mine.cjfeeSats, 600);
    }
    assert.ok(taker.fs.files.has(`coinjoin/rounds/${started.roundId}.json`));
    const saved = JSON.parse(taker.fs.files.get(`coinjoin/rounds/${started.roundId}.json`));
    assert.ok(saved.round.roundKey, 'round key is kept so a restart can finish the round');
    assert.strictEqual(round.roundKey, undefined, 'views never carry keys');
  });

  it('rebuilds without a maker that never signs', async function () {
    const m = mesh();
    const makers = [m.add('a', [1300000]), m.add('b', [1300000]), m.add('c', [1300000])];
    const taker = m.add('taker', [1600000], { taker: { sigTimeoutMs: 20 } });
    for (const h of m.hubs) await h.service.start();
    for (const h of makers) await h.service.createOffer(MAKER_TERMS);
    await m.pump();
    // Maker c answers the fill and sends inputs, then never returns a signature.
    let sealed = 0;
    makers[2].drop = (body) => body.type === 'CoinjoinSealed' && ++sealed >= 3;
    const started = await taker.service.startCoinjoin({ amountSats: 1000000, makers: 3 });
    await m.pump();
    assert.strictEqual(taker.service.roundView(started.roundId).status, 'built');
    await sleep(30);
    await taker.service.tick();
    await m.pump();
    const round = taker.service.roundView(started.roundId);
    assert.strictEqual(round.status, 'broadcast', round.error);
    assert.strictEqual(round.makers.filter((x) => x.stage === 'dropped').length, 1);
    assert.strictEqual(m.chain.broadcasts.length, 1);
  });

  it('restores a taker round from the store', async function () {
    const m = mesh();
    const makers = [m.add('a', [1300000]), m.add('b', [1300000])];
    const taker = m.add('taker', [1600000]);
    for (const h of m.hubs) await h.service.start();
    for (const h of makers) await h.service.createOffer(MAKER_TERMS);
    await m.pump();
    const started = await taker.service.startCoinjoin({ amountSats: 1000000 });
    const restarted = new CoinjoinService({ network: 'regtest', tickMs: 0, core });
    restarted.attach({ fs: taker.fs, key: new core.Key(), chain: m.chain, wallet: taker.wallet });
    await restarted.start();
    const view = restarted.roundView(started.roundId);
    assert.strictEqual(view.status, 'filled');
    assert.strictEqual(view.makers.length, 2);
  });

  it('creates, certifies, values, and redeems a fidelity bond; the maker attaches it', async function () {
    const m = mesh();
    const maker = m.add('maker', [1300000]);
    const taker = m.add('taker', [1600000]);
    for (const h of m.hubs) await h.service.start();
    await maker.service.createOffer(MAKER_TERMS);

    await assert.rejects(maker.service.createFidelityBond({ amountSats: 5000000, locktime: 900 }), /already passed/);
    const bond = await maker.service.createFidelityBond({ amountSats: 5000000, locktime: 1100 });
    assert.strictEqual(bond.status, 'confirmed');
    assert.strictEqual(bond.live, true);
    assert.ok(bond.value > 0);
    assert.strictEqual(bond.blocksUntilUnlock, 100);
    assert.strictEqual(bond.certExpiresAt, 1000 + 2016 * 4);
    assert.ok(maker.fs.files.has(`coinjoin/bonds/${bond.id}.json`));

    const offers = maker.service.makerStatus().offers;
    assert.ok(offers.every((o) => o.fidelityBond && o.fidelityBond.txid === bond.txid));
    await m.pump();
    await taker.service.tick();
    const listed = taker.service.listOffers({ amountSats: 1000000 });
    assert.ok(listed.offers[0].bondValue > 0, 'the taker verified the bond on chain');

    const renewed = await maker.service.renewBondCertificate({ id: bond.id, certBlocks: 500 });
    assert.strictEqual(renewed.certExpiresAt, 1500);

    await assert.rejects(maker.service.redeemFidelityBond({ id: bond.id, destinationAddress: core.Coinjoin.taprootKeyPath(core.Coinjoin.randomPrivateKey()).address }), /locked until block 1100/);
    m.chain.tip.height = 1100;
    const redeemed = await maker.service.redeemFidelityBond({ id: bond.id, destinationAddress: core.Coinjoin.taprootKeyPath(core.Coinjoin.randomPrivateKey()).address });
    assert.strictEqual(redeemed.status, 'redeemed');
    assert.ok(redeemed.redeemTxid);
    assert.strictEqual(m.chain.utxos.has(`${bond.txid}:${bond.vout}`), false);
    const list = await maker.service.listFidelityBonds();
    assert.strictEqual(list.bestBondId, null);
    assert.ok(maker.service.makerStatus().offers.every((o) => !o.fidelityBond));
  });

  it('refuses mainnet and reports why it is unavailable', async function () {
    const service = new CoinjoinService({ network: 'mainnet', tickMs: 0, core });
    service.attach({ chain: core.memoryChain(), wallet: core.memoryWallet({ coins: [] }) });
    await service.start();
    assert.strictEqual(service.available, false);
    assert.match(service.status().reason, /not offered on mainnet/);
    await assert.rejects(service.startCoinjoin({ amountSats: 1000000 }), /not offered on mainnet/);

    const noChain = new CoinjoinService({ network: 'regtest', tickMs: 0, core });
    await noChain.start();
    assert.strictEqual(noChain.status().reason, 'Bitcoin is not available');
  });
});
