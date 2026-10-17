'use strict';

const assert = require('assert');
const ChallengeService = require('../services/challenge');

describe('ChallengeService', function () {
  it('registers a challenge row from a StorageContract', async function () {
    const svc = new ChallengeService({ enable: true });
    const contract = {
      type: 'StorageContract',
      id: 'contract-abc',
      document: 'doc-1',
      challengeCadence: 'weekly',
      responseDeadline: '60s'
    };
    const row = await svc.registerFromStorageContract(contract);
    assert.strictEqual(row.type, 'Challenge');
    assert.strictEqual(row.contractId, 'contract-abc');
    assert.strictEqual(row.documentId, 'doc-1');
    assert.strictEqual(svc.list().length, 1);
  });

  it('syncFromHubState picks up StorageContract rows', function () {
    const svc = new ChallengeService({});
    const hub = {
      _state: {
        content: {
          collections: {
            contracts: {
              a: { type: 'StorageContract', id: 'a', document: 'd1', challengeCadence: 'daily' },
              b: { type: 'Other', id: 'b' }
            }
          }
        }
      }
    };
    svc.attach({ hub });
    const n = svc.syncFromHubState();
    assert.strictEqual(n, 1);
    assert.ok(svc.getByContractId('a'));
    assert.strictEqual(svc.getByContractId('b'), null);
  });
});

describe('ChallengeService (availability market, Phase 3)', function () {
  this.timeout(20000);
  const crypto = require('crypto');
  const { schnorr, secp256k1 } = require('@noble/curves/secp256k1.js');
  const Key = require('@fabric/core/types/key');
  const Challenge = require('@fabric/core/types/challenge');
  const Document = require('@fabric/core/types/document');
  const DocumentOfferBook = require('@fabric/core/types/offerBook');
  const Bond = require('@fabric/core/types/bond');

  function memoryFs () {
    const files = new Map();
    return {
      readFile: (p) => files.get(p) || null,
      publish: async (p, doc) => { files.set(p, JSON.stringify(doc)); },
      files
    };
  }

  function fixture (clock = 5) {
    const key = new Key({ private: crypto.randomBytes(32).toString('hex') });
    const provPriv = crypto.randomBytes(32);
    const provider = {
      priv: provPriv,
      pub: Buffer.from(secp256k1.getPublicKey(provPriv, true)).toString('hex'),
      xOnly: Buffer.from(schnorr.getPublicKey(provPriv)).toString('hex')
    };
    const book = new DocumentOfferBook();
    const hub = { beacon: { state: { clock } }, market: { book }, _rootKey: key, agent: null };
    const fs = memoryFs();
    const svc = new ChallengeService({ enable: true }).attach({ hub, fs });
    const doc = Document.seal(crypto.randomBytes(6000), { chunkBytes: 2048, documentId: 'd' });
    const hashes = doc.record().blobs.map((b) => b.blobHashHex);
    book.ingestInventoryResponse({ origin: 'prov', sellerPubkey: provider.pub, items: hashes.map((h, i) => ({ documentId: 'd', merkleRootHex: doc.merkleRootHex, blobIndex: i, blobTotal: hashes.length, blobHashHex: h, rateSats: 1 })) });
    return { svc, hub, fs, book, provider, doc, hashes };
  }

  it('issues epoch-stamped challenges and reveals the bounty preimage on a pass', async function () {
    const { svc, hub, fs, provider, doc, hashes } = fixture(5);
    assert.strictEqual(svc.epoch(), 5);
    const bounty = svc.createBounty({ contractId: 'c1', merkleRootHex: doc.merkleRootHex, providerPubkeys: [provider.pub], amountSats: 30000, epochs: 3, startEpoch: 5, refundAfterHeight: 1000 });
    assert.strictEqual(bounty.type, 'BountyBond');
    assert.strictEqual(bounty.outputs.length, 3);
    assert.ok(!JSON.stringify(bounty).includes('seed'));

    const challenge = svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly, contractId: 'c1' });
    assert.strictEqual(challenge.epoch, 5);
    assert.strictEqual(challenge.deadlineEpoch, 7);
    assert.strictEqual(svc.listIssued()[0].status, 'open');
    await new Promise((resolve) => setImmediate(resolve));
    const Witness = require('@fabric/core/types/witness');
    assert.ok(fs.files.get('fabric/storage-challenges.json').includes(Witness.artifactHash(challenge)), 'issued challenge is persisted immediately');

    const response = new Challenge().respond(challenge, { blobHashes: hashes, bytes: doc.bytesFor(challenge.blobIndex), epoch: 6, providerPrivateKey: provider.priv });
    const verdict = svc.respond(response, { bytes: doc.bytesFor(challenge.blobIndex) });
    assert.strictEqual(verdict.ok, true);
    assert.ok(verdict.reveal, 'passing provider receives the epoch preimage');
    assert.strictEqual(Bond.commitmentFor(verdict.reveal.preimageHex), bounty.outputs[0].commitments[provider.pub]);
    assert.strictEqual(svc.listIssued()[0].status, 'passed');
    assert.strictEqual(svc.getCapabilities().canIssue, true);
    void hub;
  });

  it('turns a wrong leaf into a recorded, persisted fraud proof and penalizes the provider locally', async function () {
    const { svc, fs, book, provider, doc, hashes } = fixture(9);
    const challenge = svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly });
    const honest = new Challenge().respond(challenge, { blobHashes: hashes, epoch: 9, providerPrivateKey: provider.priv });
    const Witness = require('@fabric/core/types/witness');
    const { createBlobMerkleTree } = require('@fabric/core/functions/documentBlobManifest');
    const wrong = (challenge.blobIndex + 1) % hashes.length;
    const wp = createBlobMerkleTree(hashes).proveInclusion(hashes[wrong]);
    const cheat = Witness.signArtifact(Object.assign({}, honest, { blobIndex: wrong, blobHashHex: hashes[wrong], proof: { proof: wp.proof, leafCount: wp.leafCount } }), provider.priv);
    const verdict = svc.respond(cheat);
    assert.strictEqual(verdict.ok, false);
    assert.strictEqual(verdict.fraud, 'wrong-leaf');
    assert.ok(verdict.proofHash);
    assert.strictEqual(svc.listProofs().length, 1);
    assert.strictEqual(book.exportTelemetry().providers.find((p) => p.sellerId === 'prov').penalties, 1);
    // The first verdict is final: an honest answer afterwards cannot unlock the bounty.
    const retry = svc.respond(honest, { bytes: doc.bytesFor(challenge.blobIndex) });
    assert.strictEqual(retry.duplicate, true);
    assert.strictEqual(retry.ok, false);
    assert.strictEqual(retry.fraud, 'wrong-leaf');
    assert.ok(!retry.reveal);
    assert.strictEqual(svc.listProofs().length, 1);

    await svc._persist();
    assert.ok(fs.files.get('fabric/storage-challenges.json').includes(verdict.proofHash));

    // A peer-relayed copy of the same proof is idempotent; a bogus one is rejected.
    const again = svc.ingestContractMessage({ type: 'FraudProof', object: svc.listProofs()[0].body });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(svc.listProofs().length, 1);
    assert.strictEqual(svc.ingestContractMessage({ type: 'FraudProof', kind: 'wrong-leaf', artifacts: {} }).ok, false);
  });

  it('epoch-only silence is late but never a proof (nothing on-chain anchors it)', async function () {
    const { svc, hub, provider, doc, hashes } = fixture(20);
    const commitment = Challenge.commit({ merkleRootHex: doc.merkleRootHex, blobTotal: hashes.length, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: provider.priv });
    assert.strictEqual(svc.ingestContractMessage(commitment).ok, true);
    svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly });
    assert.strictEqual(await svc.sweep(), 0, 'deadline not reached');
    hub.beacon.state.clock = 23;
    assert.strictEqual(await svc.sweep(), 0, 'no deposit / pre-signature: silence alone is not provable');
    assert.strictEqual(svc.listIssued()[0].status, 'late');
    assert.strictEqual(svc.listIssued()[0].deadlineHeight, null);
    assert.strictEqual(svc.listProofs().length, 0);
  });

  it('sweeps silent providers into timelocked non-response proofs from their pre-signed penalty; a check-in defeats it', async function () {
    const bitcoinjs = require(require.resolve('bitcoinjs-lib', { paths: [require.resolve('@fabric/core/types/channel')] }));
    const { signerFromPriv32 } = require('@fabric/core/functions/inventoryHtlc');
    const compressed = (p) => Buffer.from(signerFromPriv32(p).publicKey).toString('hex');

    const { svc, hub, fs, provider, doc, hashes } = fixture(20);
    const pubPriv = Buffer.isBuffer(hub._rootKey.private) ? hub._rootKey.private : Buffer.from(hub._rootKey.private, 'hex');
    let tip = 500;
    let unspent = true;
    svc.attach({ tipHeight: () => tip, outpointUnspent: () => unspent });
    svc.settings.deadlineBlocks = 10;

    // Provider deposit (Taproot: penalty / checkin / withdraw leaves) funded off-screen.
    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: compressed(pubPriv), withdrawAfter: 900, amountSats: 30000 });
    const fundingTx = new bitcoinjs.Transaction();
    fundingTx.addInput(crypto.randomBytes(32), 0);
    fundingTx.addOutput(bitcoinjs.address.toOutputScript(deposit.address, bitcoinjs.networks.regtest), BigInt(30000));
    svc.registerDeposit({ txid: fundingTx.getId(), vout: 0, providerPubkey: provider.pub });

    const commitment = Challenge.commit({ merkleRootHex: doc.merkleRootHex, blobTotal: hashes.length, fromEpoch: 0, untilEpoch: 100, providerPrivateKey: provider.priv });
    assert.strictEqual(svc.ingestContractMessage(commitment).ok, true);

    // Challenge binds to the deposit + a height deadline derived from the tip.
    const challenge = svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly });
    assert.strictEqual(challenge.deadlineHeight, 510);
    assert.strictEqual(challenge.deposit.txid, fundingTx.getId());
    assert.strictEqual(svc.listIssued()[0].deadlineHeight, 510);

    // Provider hands over the pre-signed penalty (nLockTime = deadline) before the round is live.
    const dest = bitcoinjs.payments.p2wpkh({ pubkey: Buffer.from(compressed(pubPriv), 'hex'), network: bitcoinjs.networks.regtest }).address;
    const penalty = Bond.prepareDepositPenalty(deposit, { fundedTxHex: fundingTx.toHex(), deadlineHeight: 510, destinationAddress: dest, feeSats: 500 });
    const preSig = Bond.signPenaltyAsProvider(deposit, penalty, provider.priv);
    const wrongDeadline = Bond.signPenaltyAsProvider(deposit, Bond.prepareDepositPenalty(deposit, { fundedTxHex: fundingTx.toHex(), deadlineHeight: 999, destinationAddress: dest, feeSats: 500 }), provider.priv);
    assert.strictEqual(svc.ingestContractMessage(preSig).ok, true);
    assert.strictEqual(svc.ingestContractMessage(wrongDeadline).ok, true, 'stored under its own deadline');
    assert.strictEqual(svc.ingestContractMessage(Object.assign({}, preSig, { signature: '00'.repeat(64) })).ok, false);

    assert.strictEqual(await svc.sweep(), 0, 'before the deadline height');
    tip = 510;
    assert.strictEqual(await svc.sweep(), 1);
    const proof = svc.listProofs()[0];
    assert.strictEqual(proof.body.kind, 'non-response');
    assert.strictEqual(proof.verdict.offender, provider.xOnly);
    assert.strictEqual(proof.verdict.evidence, 'timelock');
    assert.strictEqual(svc.listIssued()[0].status, 'late');
    await svc._persist();
    const persisted = JSON.parse(fs.files.get('fabric/storage-challenges.json'));
    assert.ok(persisted.penaltyPreSigs[`${fundingTx.getId()}:0:510`]);
    assert.ok(persisted.deposits[`${fundingTx.getId()}:0`]);

    // A second round where the provider checked in (deposit outpoint spent) yields no proof.
    tip = 600;
    const second = svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly });
    assert.strictEqual(second.deadlineHeight, 610);
    svc.ingestContractMessage(Bond.signPenaltyAsProvider(deposit, Bond.prepareDepositPenalty(deposit, { fundedTxHex: fundingTx.toHex(), deadlineHeight: 610, destinationAddress: dest, feeSats: 500 }), provider.priv));
    tip = 610;
    unspent = false;
    assert.strictEqual(await svc.sweep(), 0);
    assert.strictEqual(svc.listProofs().length, 1);
    const rows = svc.listIssued();
    assert.strictEqual(rows[1].status, 'late');
    assert.ok(/check-in/.test(svc.getIssued(rows[1].hash).verdict.reason));
  });

  it('signs the publisher penalty destination into challenges and refuses pre-signatures paying elsewhere', function () {
    // Destination binding ships with fabric #188; skip until the @fabric/core pin includes it.
    if (typeof require('@fabric/core/types/witness').FraudProof._penaltyDestination !== 'function') return this.skip();
    const bitcoinjs = require(require.resolve('bitcoinjs-lib', { paths: [require.resolve('@fabric/core/types/channel')] }));
    const { signerFromPriv32 } = require('@fabric/core/functions/inventoryHtlc');
    const compressed = (p) => Buffer.from(signerFromPriv32(p).publicKey).toString('hex');
    const p2wpkh = (pub) => bitcoinjs.payments.p2wpkh({ pubkey: Buffer.from(pub, 'hex'), network: bitcoinjs.networks.regtest }).address;

    const { svc, hub, provider, doc, hashes } = fixture(20);
    const pubPriv = Buffer.isBuffer(hub._rootKey.private) ? hub._rootKey.private : Buffer.from(hub._rootKey.private, 'hex');
    const publisherDest = p2wpkh(compressed(pubPriv));
    svc.settings.penaltyAddress = publisherDest;
    svc.settings.minPenaltySats = 25000;
    svc.settings.deadlineBlocks = 10;
    svc.attach({ tipHeight: () => 500 });

    const deposit = Bond.buildDeposit({ network: 'regtest', providerPubkey: provider.pub, publisherPubkey: compressed(pubPriv), withdrawAfter: 900, amountSats: 30000 });
    const fundingTx = new bitcoinjs.Transaction();
    fundingTx.addInput(crypto.randomBytes(32), 0);
    fundingTx.addOutput(bitcoinjs.address.toOutputScript(deposit.address, bitcoinjs.networks.regtest), BigInt(30000));
    svc.registerDeposit({ txid: fundingTx.getId(), vout: 0, providerPubkey: provider.pub });

    const challenge = svc.issue({ merkleRootHex: doc.merkleRootHex, blobHashes: hashes, providerPubkey: provider.xOnly });
    assert.strictEqual(challenge.deposit.penaltyAddress, publisherDest);
    assert.strictEqual(challenge.deposit.minPenaltySats, 25000);

    const sign = (destinationAddress, feeSats = 500) => Bond.signPenaltyAsProvider(deposit, Bond.prepareDepositPenalty(deposit, { fundedTxHex: fundingTx.toHex(), deadlineHeight: 510, destinationAddress, feeSats }), provider.priv);
    const selfPaying = svc.ingestContractMessage(sign(p2wpkh(provider.pub)));
    assert.strictEqual(selfPaying.ok, false);
    assert.ok(/penalty does not pay/.test(selfPaying.error), selfPaying.error);
    assert.strictEqual(svc.ingestContractMessage(sign(publisherDest, 10000)).ok, false, 'fee eats below minPenaltySats');
    assert.strictEqual(svc.ingestContractMessage(sign(publisherDest)).ok, true);
  });

  it('resolves the chain view for broadcast-evidence proofs before verifying them', async function () {
    const bitcoinjs = require('bitcoinjs-lib');
    const { svc, book } = fixture(5);
    const header = crypto.randomBytes(80);
    const once = crypto.createHash('sha256').update(header).digest();
    const blockHash = Buffer.from(crypto.createHash('sha256').update(once).digest()).reverse().toString('hex');
    const tx = new bitcoinjs.Transaction();
    tx.addInput(crypto.randomBytes(32), 0);
    tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 1000);

    const asked = { headers: [], txids: [] };
    let onChain = true;
    svc.attach({
      headerKnown: async (h) => { asked.headers.push(h); return onChain; },
      txConfirmed: async (id) => { asked.txids.push(id); return onChain; }
    });

    const stale = { type: 'FraudProof', kind: 'stale-commitment', artifacts: { staleTxHex: tx.toHex(), inclusion: { txid: tx.getId(), blockHeaderHex: header.toString('hex') } } };
    const viaHeader = await svc.chainViewFor(stale);
    assert.deepStrictEqual(asked.headers, [blockHash]);
    assert.strictEqual(viaHeader.headerKnown(blockHash), true);
    assert.strictEqual(viaHeader.headerKnown('00'.repeat(32)), false, 'only the asked-for block');
    assert.strictEqual(viaHeader.txConfirmed, undefined);

    const penalty = { type: 'FraudProof', kind: 'wrongful-penalty', artifacts: { penaltyTxHex: tx.toHex() } };
    const viaTx = await svc.chainViewFor(penalty);
    assert.deepStrictEqual(asked.txids, [tx.getId()]);
    assert.strictEqual(viaTx.txConfirmed(tx.getId()), true);
    assert.strictEqual(viaTx.headerKnown, undefined);

    onChain = false;
    assert.strictEqual((await svc.chainViewFor(stale)).headerKnown(blockHash), false);
    assert.deepStrictEqual(await svc.chainViewFor({ type: 'FraudProof', kind: 'wrong-leaf', artifacts: {} }), {});

    // recordProof hands the resolved callbacks to the book's verifier.
    let seen = null;
    book.ingestFraudProof = (proof, view) => { seen = view; return { ok: false, reason: 'test' }; };
    svc.recordProof(penalty, viaTx);
    assert.strictEqual(seen.txConfirmed, viaTx.txConfirmed);
  });
});
