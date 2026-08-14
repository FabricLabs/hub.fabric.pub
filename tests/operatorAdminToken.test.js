'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Token = require('@fabric/core/types/token');
const {
  isOperatorAdminToken,
  tokenPayloadIfOperatorAdmin
} = require('../functions/operatorAdminToken');

const DERIVE = "m/44'/7778'/0'/0/0";

function mintAdmin (issuer) {
  return new Token({
    capability: 'OP_IDENTITY',
    issuer,
    subject: 'admin'
  }).toSignedString();
}

describe('operatorAdminToken', function () {
  it('accepts a token minted from the HD master (Hub _rootKey)', function () {
    const master = new Key();
    const token = mintAdmin(master);
    assert.strictEqual(isOperatorAdminToken(token, master), true);
    assert.ok(tokenPayloadIfOperatorAdmin(token, master));
  });

  it('accepts a token minted from the derived Peer path of the same xprv', function () {
    const master = new Key();
    const derived = master.derive(DERIVE);
    const token = mintAdmin(derived);
    assert.strictEqual(isOperatorAdminToken(token, [master, derived]), true);
    assert.strictEqual(isOperatorAdminToken(token, master), false);
    assert.strictEqual(isOperatorAdminToken(token, derived), true);
  });

  it('rejects a token from a different operator', function () {
    const a = new Key();
    const b = new Key();
    assert.strictEqual(isOperatorAdminToken(mintAdmin(a), b), false);
  });

  it('rejects missing or non-admin tokens', function () {
    const key = new Key();
    assert.strictEqual(isOperatorAdminToken('', key), false);
    const other = new Token({
      capability: 'OP_0',
      issuer: key,
      subject: 'admin'
    }).toSignedString();
    assert.strictEqual(isOperatorAdminToken(other, key), false);
  });
});
