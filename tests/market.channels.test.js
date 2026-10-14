'use strict';

const assert = require('assert');
const crypto = require('crypto');
const bitcoin = require(require.resolve('bitcoinjs-lib', { paths: [require.resolve('@fabric/core/types/channel')] }));
const Key = require('@fabric/core/types/key');
const MarketService = require('../services/market');

const NET = bitcoin.networks.regtest;

function memoryFs () {
  const files = new Map();
  return {
    files,
    publish: async (path, data) => { files.set(path, JSON.stringify(data)); },
    readFile: (path) => files.get(path) || null
  };
}

describe('Hub MarketService payment channels (Phase 4)', function () {
  it('is disabled by default and refuses without a key', function () {
    const m = new MarketService();
    assert.strictEqual(m.channelsStatus().available, false);
    const on = new MarketService({ channels: { enable: true } });
    assert.strictEqual(on.channelsStatus().reason, 'unavailable');
  });

  it('opens a channel as funder, mirrors the counterparty, routes bodies, persists', async function () {
    const fsA = memoryFs();
    const fsB = memoryFs();
    const keyA = new Key();
    const keyB = new Key();
    const relayed = { a: [], b: [] };
    const hubFor = (sink) => ({ agent: { relayFrom: async (_from, msg) => { sink.push(JSON.parse(msg.body).object); } }, bitcoin: null, settings: { bitcoin: { network: 'regtest' } } });
    const A = new MarketService({ channels: { enable: true } }).attach({ hub: hubFor(relayed.a), fs: fsA, key: keyA });
    const B = new MarketService({ channels: { enable: true } }).attach({ hub: hubFor(relayed.b), fs: fsB, key: keyB });
    const pubB = keyB.public.encodeCompressed('hex');
    const addr = (k) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(k.public.encodeCompressed('hex'), 'hex'), network: NET }).address;

    // Funding tx paying the channel address this pair derives.
    const Channel = require('@fabric/core/types/channel');
    const funding = Channel.buildFunding({ network: 'regtest', localPubkey: keyA.public.encodeCompressed('hex'), remotePubkey: pubB, expireAfter: 9000 });
    const tx = new bitcoin.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(bitcoin.address.toOutputScript(funding.address, NET), BigInt(30000));

    const opened = A.channelOpen({ remotePubkey: pubB, fundedTxHex: tx.toHex(), capacitySats: 30000, expireAfter: 9000, localAddress: addr(keyA), remoteAddress: addr(keyB), aliases: ['peer-b'] });
    assert.strictEqual(opened.open.type, 'ChannelOpen');
    assert.strictEqual(relayed.a.length, 1);

    // Pump the gossip both ways until quiet (open → reply → ack, later proposal → reply → revoke).
    const pump = () => {
      let moved = true;
      while (moved) {
        moved = false;
        while (relayed.a.length) { moved = true; B.ingestChannelMessage(relayed.a.shift(), { sellerId: 'peer-a' }); }
        while (relayed.b.length) { moved = true; A.ingestChannelMessage(relayed.b.shift(), { sellerId: 'peer-b' }); }
      }
    };
    pump();
    assert.strictEqual(A.channelsStatus().channels[0].fullySigned, true);
    assert.strictEqual(A.channelsStatus().channels[0].status, 'open');
    const opening = 30000 - 500 - 2 * Channel.DEFAULTS.anchorSats;
    assert.strictEqual(B.channelsStatus().channels[0].balances.remoteSats, opening);
    assert.strictEqual(B.ingestChannelMessage({ type: 'ChannelOpen', channelId: 'nope' }), null);

    // No chain view yet → no new HTLCs (stale-tip guard). Hosts feed tips from the block hook.
    const sA = A.channels.sessions.get(opened.channelId);
    assert.throws(() => sA.offerHtlc({ amountSats: 1, paymentHashHex: '11'.repeat(32), expireAfter: 8000 }), /tip unknown or stale/);
    await A.onBitcoinBlock({ height: 100 });
    await B.onBitcoinBlock({ height: 100 });

    // One paid chunk, seller-fulfils: B (seller) publishes a sealed blob on its
    // Peer; A offers an HTLC for that blob's payment hash; B's Book fulfils it
    // with K_i from the registry (`preimageFor`), and A learns the key from the
    // `ChannelHtlcFulfill`. Nobody hands the preimage over out of band.
    const sB = B.channels.sessions.get(opened.channelId);
    const Document = require('@fabric/core/types/document');
    const Peer = require('@fabric/core/types/peer');
    const sellerPeer = new Peer({ listen: false, sealPricedDocuments: true });
    const sealed = Document.seal(crypto.randomBytes(3000), { chunkBytes: 2048 });
    assert.ok(sellerPeer.publishSealedDocument(sealed, { rateSats: 1 }).ok);
    B.hub.agent.sealedBlobPreimageForPaymentHash = (h) => sellerPeer.sealedBlobPreimageForPaymentHash(h);
    const paymentHashHex = sealed.paymentHashFor(1);
    const settled = [];
    A.on('channelHtlcSettled', (ev) => settled.push(ev));
    A.channels.publish(sA.offerHtlc({ amountSats: 2000, paymentHashHex, expireAfter: 8000 }), sA);
    // Step the gossip one hop at a time so we can snapshot A's commitment while
    // the HTLC is still pending (the seller fulfils as soon as it is committed).
    let staleA = null;
    for (let guard = 0; guard < 20 && !staleA; guard++) {
      if (relayed.a.length) B.ingestChannelMessage(relayed.a.shift(), { sellerId: 'peer-a' });
      else if (relayed.b.length) A.ingestChannelMessage(relayed.b.shift(), { sellerId: 'peer-b' });
      if (sA.state.htlcs.length === 1 && !sA.busy) staleA = sA.finalize();
    }
    assert.ok(staleA, 'captured the commitment with the HTLC pending');
    pump();
    assert.strictEqual(sB.state.htlcs.length, 0, 'seller fulfilled the committed HTLC itself');
    assert.strictEqual(sB.balances.localSats, 2000);
    assert.strictEqual(A.channelsStatus().channels[0].revokedStates, 2);
    assert.strictEqual(sA.busy, false);
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].preimageHex, sealed.keyFor(1), 'buyer learned K_i from ChannelHtlcFulfill');
    assert.strictEqual(settled[0].paymentHashHex, paymentHashHex);

    // A broadcasts the revoked state; B's block hook detects it, builds justice, gossips a FraudProof
    // that carries an SPV inclusion proof when the host supplies the block header + txids.
    const { merkleRootFromTxids } = require('@fabric/core/functions/bitcoinTxInclusion');
    const staleTxid = bitcoin.Transaction.fromHex(staleA.txHex).getId();
    const txids = [crypto.randomBytes(32).toString('hex'), staleTxid, crypto.randomBytes(32).toString('hex')];
    const header = Buffer.alloc(80);
    header.writeInt32LE(0x20000000, 0);
    Buffer.from(merkleRootFromTxids(txids), 'hex').reverse().copy(header, 36);
    const breaches = [];
    B.on('channelBreach', (obs) => breaches.push(obs));
    const result = await B.onBitcoinBlock({ height: 120, txHexes: [staleA.txHex], blockHeaderHex: header.toString('hex'), txids });
    assert.strictEqual(result.observations.length, 1);
    assert.strictEqual(breaches[0].kind, 'stale');
    assert.strictEqual(breaches[0].number, 1);
    const proof = relayed.b.pop();
    assert.strictEqual(proof.type, 'FraudProof');
    const Witness = require('@fabric/core/types/witness');
    const fp = Witness.FraudProof.fromBody(proof);
    assert.strictEqual(fp.verify({}).ok, true, 'inclusion proof alone establishes the broadcast');
    assert.strictEqual(fp.verify({}).evidence, 'inclusion');
    assert.strictEqual(breaches[0].justice, null, 'no wallet address without a Bitcoin service');

    await A._persist();
    assert.ok(fsA.files.has('fabric/market-channels.json'));
    const A2 = new MarketService({ channels: { enable: true } }).attach({ hub: hubFor([]), fs: fsA, key: keyA });
    await A2.start();
    assert.strictEqual(A2.channelsStatus().channels[0].channelId, opened.channelId);
    await A2.stop();
  });
});
