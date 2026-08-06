'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sidechainState = require('../functions/sidechainState');
const contractStatechains = require('../functions/contractStatechains');
const beaconFederationSigning = require('../functions/beaconFederationSigning');
const DistributedExecution = require('../functions/fabricDistributedExecution');
const Key = require('@fabric/core/types/key');

describe('contract Statechains + Beacon Federation signing (ADR-001)', function () {
  it('storePathsForContract + parentSealPath are stable', function () {
    const id = 'a'.repeat(64);
    const paths = sidechainState.storePathsForContract(id);
    assert.strictEqual(paths.state, `sidechains/${id}/STATE`);
    assert.strictEqual(sidechainState.parentSealPath(id), `/namespaces/${id}`);
  });

  it('patchesForNamespaceHead add then replace', function () {
    const id = 'b'.repeat(64);
    const head = sidechainState.namespaceHeadFromState(id, sidechainState.createInitialState(), {
      name: 'Demo'
    });
    const p1 = sidechainState.patchesForNamespaceHead({}, id, head);
    assert.strictEqual(p1.length, 1);
    assert.strictEqual(p1[0].path, '/namespaces');
    const content = { namespaces: { [id]: head } };
    const head2 = Object.assign({}, head, { clock: 1, stateDigest: 'ff'.repeat(32) });
    const p2 = sidechainState.patchesForNamespaceHead(content, id, head2);
    assert.strictEqual(p2[0].op, 'replace');
    assert.strictEqual(p2[0].path, `/namespaces/${id}`);
  });

  it('provisionAcceptedContract creates contract store + parent seal', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-contract-sc-'));
    const mem = new Map();
    const fakeFs = {
      readFile (p) {
        if (!mem.has(p)) return null;
        return mem.get(p);
      },
      writeFile (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      },
      async publish (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
      }
    };
    void dir;

    const parent = sidechainState.createInitialState();
    const contractId = 'c'.repeat(64);
    const result = await contractStatechains.provisionAcceptedContract(
      fakeFs,
      parent,
      { contractId, name: 'GoonCitizen', parentContractId: null },
      null
    );
    assert.strictEqual(result.ok, true);
    assert.ok(result.head);
    assert.ok(result.parentState.content.namespaces[contractId]);
    assert.strictEqual(
      result.parentState.content.namespaces[contractId].stateDigest,
      result.head.stateDigest
    );
  });

  it('federation sign round collects threshold Schnorr signatures', function () {
    const k1 = new Key({ private: '1111111111111111111111111111111111111111111111111111111111111111' });
    const k2 = new Key({ seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
    const epoch = {
      clock: 1,
      blockHash: 'aa'.repeat(32),
      height: 100,
      balance: 0,
      balanceSats: 0,
      timestamp: '2026-07-20T00:00:00.000Z',
      sidechain: { clock: 0, stateDigest: 'dd'.repeat(32) }
    };
    const round = beaconFederationSigning.createRound(
      epoch,
      { validators: [k1.pubkey, k2.pubkey], threshold: 2 },
      null
    );
    assert.strictEqual(beaconFederationSigning.roundMeetsThreshold(round), false);

    const msg = beaconFederationSigning.messageBufferForPayload(epoch);
    const s1 = k1.signSchnorr(msg).toString('hex');
    const a1 = beaconFederationSigning.addSignature(round, k1.pubkey, s1);
    assert.strictEqual(a1.ok, true);
    assert.strictEqual(a1.sealed, false);

    const s2 = k2.signSchnorr(msg).toString('hex');
    const a2 = beaconFederationSigning.addSignature(round, k2.pubkey, s2);
    assert.strictEqual(a2.ok, true);
    assert.strictEqual(a2.sealed, true);
    assert.strictEqual(
      DistributedExecution.verifyFederationWitnessOnMessage(
        msg,
        round.witness,
        [k1.pubkey, k2.pubkey],
        2
      ),
      true
    );
  });
});
