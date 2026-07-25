'use strict';

const assert = require('assert');
const constants = require('@fabric/core/constants');
const registry = require('../functions/fabricMessageRegistry');

describe('fabricMessageRegistry', function () {
  it('outer wire names are unique', function () {
    const names = registry.outerTypeNames();
    assert.strictEqual(new Set(names).size, names.length);
  });

  it('JSONCall opcode matches @fabric/core', function () {
    const row = registry.findOuterByName('JSONCall');
    assert.ok(row);
    assert.strictEqual(row.opcodeDec, constants.JSON_CALL_TYPE);
  });

  it('GenericMessage opcode matches @fabric/core GENERIC_MESSAGE_TYPE', function () {
    const row = registry.findOuterByName('GenericMessage');
    assert.strictEqual(row.opcodeDec, constants.GENERIC_MESSAGE_TYPE);
  });

  it('JSONBlob is GENERIC_MESSAGE_TYPE + 1', function () {
    const row = registry.findOuterByName('JSONBlob');
    assert.strictEqual(row.opcodeDec, constants.GENERIC_MESSAGE_TYPE + 1);
  });

  it('P2P_CHAT_MESSAGE opcode matches @fabric/core', function () {
    const row = registry.findOuterByName('P2P_CHAT_MESSAGE');
    assert.ok(row, 'P2P_CHAT_MESSAGE should be a first-class outer type');
    // 0x68 = 104. When the linked @fabric/core exports the constant, require
    // exact alignment; otherwise assert the canonical literal (pre-core-upgrade).
    if (typeof constants.P2P_CHAT_MESSAGE === 'number') {
      assert.strictEqual(row.opcodeDec, constants.P2P_CHAT_MESSAGE);
    } else {
      assert.strictEqual(row.opcodeDec, 104);
    }
  });

  it('contract outer types match @fabric/core opcodes', function () {
    assert.strictEqual(registry.findOuterByName('CONTRACT_PUBLISH').opcodeDec, constants.P2P_CONTRACT_PUBLISH);
    assert.strictEqual(registry.findOuterByName('CONTRACT_MESSAGE').opcodeDec, constants.P2P_CONTRACT_MESSAGE);
  });

  it('P2P_CONTRACT_* aliases share opcodes with CONTRACT_*', function () {
    assert.strictEqual(registry.findOuterByName('P2P_CONTRACT_PUBLISH').opcodeDec, constants.P2P_CONTRACT_PUBLISH);
    assert.strictEqual(registry.findOuterByName('P2P_CONTRACT_MESSAGE').opcodeDec, constants.P2P_CONTRACT_MESSAGE);
    assert.strictEqual(registry.findOuterByName('P2P_CONTRACT_PROPOSAL').opcodeDec, constants.CONTRACT_PROPOSAL_TYPE);
  });

  it('APPLICATION_CONTRACT_BODY_TYPES lists shared namespace body types', function () {
    const types = registry.APPLICATION_CONTRACT_BODY_TYPES.map((r) => r.type);
    assert.ok(types.includes('GroupChat'));
    assert.ok(types.includes('FederationContractInvite'));
    assert.ok(types.includes('MissionBroadcast'));
  });
});
