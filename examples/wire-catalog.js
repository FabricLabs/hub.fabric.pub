'use strict';

/**
 * Two stable catalog rows must match @fabric/core opcodes.
 * Run: node examples/wire-catalog.js
 */

const { JSON_CALL_TYPE, P2P_CHAT_MESSAGE } = require('@fabric/core/constants');
const { findOuterByName } = require('../functions/fabricMessageRegistry');

function fail (message) {
  console.error('[EXAMPLES:WIRE_CATALOG]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function check (name, opcode) {
  const row = findOuterByName(name);
  if (!row) fail(name + ' is missing from the catalog');
  if (row.opcodeDec !== opcode) fail(name + ' catalog opcode ' + row.opcodeDec + ' != core ' + opcode);
  console.log('[EXAMPLES:WIRE_CATALOG]', name, row.opcodeDec, row.stability);
}

function main () {
  check('JSONCall', JSON_CALL_TYPE);
  check('P2P_CHAT_MESSAGE', P2P_CHAT_MESSAGE);
}

main();
