'use strict';

const assert = require('assert');
const {
  encodeFabricHallmarkFromState,
  HALLMARK_MAGIC_HEX,
  HALLMARK_PAYLOAD_LENGTH
} = require('@fabric/core/functions/fabricHallmark');
const {
  parseVerboseBlockForSidechainSignals,
  extractOpReturnPushHexCandidates
} = require('../functions/sidechainBlockScan');
const {
  normalizeContractIdHex,
  publishFabricHallmarkOpReturn
} = require('../functions/fabricHallmarkBitcoin');

describe('fabricHallmark (Hub)', function () {
  const tip = 'ab'.repeat(32);
  const contractId = 'cd'.repeat(32);

  it('normalizeContractIdHex accepts 64-hex and hashes other ids', function () {
    assert.strictEqual(normalizeContractIdHex(contractId), contractId);
    const hashed = normalizeContractIdHex('hub-contract-name');
    assert.strictEqual(hashed.length, 64);
    assert.notStrictEqual(hashed, contractId);
  });

  it('extractOpReturnPushHexCandidates finds hallmark payload', function () {
    const { payload } = encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 1, stateDigest: '11'.repeat(32) },
      contracts: { clock: 0, stateDigest: '22'.repeat(32) }
    });
    const scriptHex = '6a28' + payload.toString('hex');
    const cands = extractOpReturnPushHexCandidates(scriptHex);
    assert.ok(cands.some((c) => c === payload.toString('hex')));
  });

  it('parseVerboseBlockForSidechainSignals emits fabric_hallmark', function () {
    const { payload, commitmentHex, tipHashSuffixHex } = encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: { clock: 2, stateDigest: '33'.repeat(32) },
      contracts: null
    });
    const block = {
      hash: tip,
      tx: [
        {
          txid: 'ee'.repeat(32),
          vout: [
            {
              n: 0,
              scriptPubKey: {
                type: 'nulldata',
                hex: '6a28' + payload.toString('hex')
              }
            }
          ]
        }
      ]
    };
    const signals = parseVerboseBlockForSidechainSignals(block, 10, {
      hallmarksScan: true,
      tipBlockHashHex: tip,
      opReturnMagicHex: '',
      watchAddresses: [],
      recordTimelocks: false
    });
    const hit = signals.find((s) => s.kind === 'fabric_hallmark');
    assert.ok(hit);
    assert.strictEqual(hit.commitmentHex, commitmentHex);
    assert.strictEqual(hit.tipHashSuffixHex, tipHashSuffixHex);
    assert.strictEqual(hit.tipMatch, true);
    assert.strictEqual(hit.payloadHex.length, HALLMARK_PAYLOAD_LENGTH * 2);
    assert.ok(hit.payloadHex.startsWith(HALLMARK_MAGIC_HEX));
  });

  it('publishFabricHallmarkOpReturn refuses non-regtest', async function () {
    await assert.rejects(
      () => publishFabricHallmarkOpReturn({ network: 'mainnet' }, 'aa'.repeat(40)),
      /regtest/
    );
  });

  it('publishFabricHallmarkOpReturn uses walletcreatefundedpsbt on regtest mock', async function () {
    const { payload } = encodeFabricHallmarkFromState({
      tipBlockHashHex: tip,
      contractIdHex: contractId,
      sidechain: null,
      contracts: null
    });
    const calls = [];
    const bitcoin = {
      network: 'regtest',
      walletName: 'hub',
      async _makeWalletRequest (method, args) {
        calls.push({ method, args });
        if (method === 'walletcreatefundedpsbt') {
          assert.deepStrictEqual(args[1], [{ data: payload.toString('hex') }]);
          return { psbt: 'cHNidP8BAH0=' };
        }
        if (method === 'walletprocesspsbt') {
          return { hex: '02000000000100', complete: true };
        }
        throw new Error('unexpected ' + method);
      },
      async _makeRPCRequest (method, args) {
        calls.push({ method, args });
        if (method === 'sendrawtransaction') return 'ff'.repeat(32);
        throw new Error('unexpected ' + method);
      }
    };
    const out = await publishFabricHallmarkOpReturn(bitcoin, payload);
    assert.strictEqual(out.txid, 'ff'.repeat(32));
    assert.strictEqual(out.payloadHex, payload.toString('hex'));
    assert.ok(calls.some((c) => c.method === 'walletcreatefundedpsbt'));
  });
});
