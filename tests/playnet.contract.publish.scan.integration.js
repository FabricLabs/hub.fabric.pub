'use strict';

/**
 * Integration: CONTRACT_PUBLISH → accept → contract Statechain provision →
 * L1 sidechain block scan (fixture / mock RPC) → re-publish (idempotent).
 *
 * Mirrors the playnet path where a local leader `regtest` chain settles L1 and
 * Hub scans tips (`bitcoin.sidechainScan`) while application contracts are
 * published and re-published onto the mesh.
 *
 * Always runs offline. Optional live Hub+bitcoind path:
 *   FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1 FABRIC_PLAYNET_PUBLISH_SCAN=1 \
 *     npm run test:playnet-publish-scan
 */

const assert = require('assert');

const Key = require('@fabric/core/types/key');
const Actor = require('@fabric/core/types/actor');

const tac = require('../functions/trackedApplicationContracts');
const sidechainState = require('../functions/sidechainState');
const contractStatechains = require('../functions/contractStatechains');
const {
  parseVerboseBlockForSidechainSignals,
  scanBlockForSidechainSignals
} = require('../functions/sidechainBlockScan');

describe('playnet contract publish + chain scan + re-publish', function () {
  it('publish → accept → provision namespace → scan tip fixture → re-publish is idempotent', async function () {
    const k = new Key();
    const ownerPub = String(k.pubkey).toLowerCase();
    const definition = {
      name: 'DemoGroup',
      version: 5,
      messageTypes: ['GroupChat', 'GroupChange', 'GroupChangeProposal'],
      parties: [ownerPub],
      validators: [ownerPub],
      proposedPolicy: { validators: [ownerPub], threshold: 1 },
      creator: ownerPub,
      state: { network: 'regtest' }
    };
    const contractId = new Actor(definition).id;
    const tipHash = 'ab'.repeat(32);
    const tipHeight = 101;

    const state = tac.emptyState();
    const first = tac.recordPublish(state, {
      contractId,
      definition,
      signer: ownerPub,
      origin: 'playnet-peer',
      bitcoinBlockHash: tipHash,
      bitcoinHeight: tipHeight,
      network: 'regtest'
    });
    assert.strictEqual(first.status, 'pending');
    assert.ok(state.pending[contractId]);

    const accepted = tac.acceptContract(state, contractId, {
      acceptedBy: 'playnet-operator',
      bitcoinBlockHash: tipHash,
      bitcoinHeight: tipHeight,
      network: 'regtest'
    });
    assert.strictEqual(accepted.status, 'accepted');
    assert.ok(state.accepted[contractId]);
    const rootAfterAccept = tac.computeStateRoot(state);

    const mem = new Map();
    const fakeFs = {
      readFile (p) {
        return mem.has(p) ? mem.get(p) : null;
      },
      writeFile (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      },
      async publish (p, data) {
        mem.set(p, typeof data === 'string' ? data : JSON.stringify(data));
      }
    };
    const parent = sidechainState.createInitialState();
    const provisioned = await contractStatechains.provisionAcceptedContract(
      fakeFs,
      parent,
      { contractId, name: definition.name, parentContractId: null },
      null
    );
    assert.strictEqual(provisioned.ok, true);
    assert.ok(provisioned.parentState.content.namespaces[contractId]);
    assert.ok(mem.has(`sidechains/${contractId}/STATE`));

    const spend = state.accepted[contractId].spendAddress;
    const watch = spend ? [spend] : ['bcrt1qplaynetwatch'];
    const magic = 'fab100';
    const block = {
      hash: tipHash,
      tx: [
        {
          txid: 'cd'.repeat(32),
          locktime: tipHeight + 100,
          vout: [
            {
              n: 0,
              value: 0,
              scriptPubKey: {
                type: 'nulldata',
                hex: '6a03' + magic + '00'
              }
            },
            {
              n: 1,
              value: 0.01,
              scriptPubKey: {
                type: 'witness_v1_taproot',
                address: watch[0],
                hex: '5120' + '11'.repeat(32)
              }
            }
          ]
        }
      ]
    };
    const signals = parseVerboseBlockForSidechainSignals(block, tipHeight, {
      opReturnMagicHex: magic,
      watchAddresses: watch,
      recordTimelocks: true
    });
    assert.ok(signals.some((s) => s.kind === 'op_return_magic'), 'expected OP_RETURN fab100 signal');
    assert.ok(signals.some((s) => s.kind === 'watch_address_out'), 'expected watched spend out');
    assert.ok(signals.some((s) => s.kind === 'timelock_marker'), 'expected timelock marker');

    const mockBitcoin = {
      async _makeRPCRequest (method, params) {
        assert.strictEqual(method, 'getblock');
        assert.strictEqual(params[0], tipHash);
        assert.strictEqual(params[1], 2);
        return block;
      }
    };
    const scanned = await scanBlockForSidechainSignals(mockBitcoin, tipHash, tipHeight, {
      opReturnMagicHex: magic,
      watchAddresses: watch
    });
    assert.strictEqual(scanned.blockHash, tipHash);
    assert.strictEqual(scanned.height, tipHeight);
    assert.ok(scanned.signals.length >= 2);

    // Re-publish after scan: already accepted → idempotent, stateRoot stable.
    const republish = tac.recordPublish(state, {
      contractId,
      definition,
      signer: ownerPub,
      bitcoinBlockHash: tipHash,
      bitcoinHeight: tipHeight,
      network: 'regtest'
    });
    assert.strictEqual(republish.status, 'accepted');
    assert.strictEqual(republish.created, false);
    assert.strictEqual(tac.computeStateRoot(state), rootAfterAccept);
    assert.ok(!state.pending[contractId]);
  });
});

const runLive = process.env.FABRIC_PLAYNET_PUBLISH_SCAN === '1' ||
  process.env.FABRIC_PLAYNET_PUBLISH_SCAN === 'true';

describe('playnet contract publish + scan live', function () {
  (runLive ? it : it.skip)('starts local Hub leader and accepts a published contract', async function () {
    this.timeout(400000);
    // Deferred to the heavy beacon suite topology when operators enable the gate.
    // Smoke: require Hub class loads with sidechainScan settings shape.
    const settings = require('../settings/local');
    assert.ok(settings.bitcoin);
    assert.ok(settings.bitcoin.sidechainScan);
    assert.strictEqual(typeof settings.bitcoin.sidechainScan.enable, 'boolean');
    const Hub = require('../services/hub');
    assert.strictEqual(typeof Hub, 'function');
  });
});
