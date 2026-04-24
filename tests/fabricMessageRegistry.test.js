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
});
