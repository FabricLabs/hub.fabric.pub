'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Token = require('@fabric/core/types/token');
const Hub = require('../services/hub');
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

  it('skips unset keys in a mixed issuer list', function () {
    const master = new Key();
    const derived = master.derive(DERIVE);
    const token = mintAdmin(derived);
    assert.strictEqual(isOperatorAdminToken(token, [undefined, derived]), true);
    assert.strictEqual(isOperatorAdminToken(token, [master, undefined]), false);
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
    const nonAdmin = new Token({
      capability: 'OP_IDENTITY',
      issuer: key,
      subject: 'operator'
    }).toSignedString();
    assert.strictEqual(isOperatorAdminToken(nonAdmin, key), false);
  });
});

describe('Hub._verifyOperatorAdminToken', function () {
  // Accept/Reject *handler* coverage lives in `tests/hub.operatorAccept.test.js`.
  // This block pins the shared gate those handlers call, covering the cases a
  // handler test does not reach: an unset `agent.key`, and the ordering contract
  // between `setup.verifyAdminToken` and the Schnorr key check.
  const verify = (context, token) => Hub.prototype._verifyOperatorAdminToken.call(context, token);

  it('accepts tokens minted from either _rootKey or agent.key', function () {
    const master = new Key();
    const derived = master.derive(DERIVE);
    const context = { _rootKey: master, agent: { key: derived }, setup: null };
    assert.strictEqual(verify(context, mintAdmin(master)), true);
    assert.strictEqual(verify(context, mintAdmin(derived)), true);
  });

  it('rejects a foreign operator, a non-admin capability, and an empty token', function () {
    const master = new Key();
    const context = { _rootKey: master, agent: { key: master.derive(DERIVE) }, setup: null };
    assert.strictEqual(verify(context, mintAdmin(new Key())), false);
    assert.strictEqual(verify(context, new Token({
      capability: 'OP_IDENTITY',
      issuer: master,
      subject: 'operator'
    }).toSignedString()), false);
    assert.strictEqual(verify(context, ''), false);
    assert.strictEqual(verify(context, null), false);
  });

  it('skips an unset agent.key instead of throwing', function () {
    const master = new Key();
    const token = mintAdmin(master);
    for (const agent of [null, undefined, {}, { key: null }]) {
      assert.strictEqual(verify({ _rootKey: master, agent, setup: null }, token), true);
    }
    // With no usable issuer at all the token cannot be honoured.
    assert.strictEqual(verify({ _rootKey: null, agent: null, setup: null }, token), false);
  });

  it('does not depend on setup.verifyAdminToken to accept a valid token', function () {
    const master = new Key();
    let consulted = 0;
    const context = {
      _rootKey: master,
      agent: { key: master.derive(DERIVE) },
      setup: { verifyAdminToken: () => { consulted++; return false; } }
    };
    assert.strictEqual(verify(context, mintAdmin(master)), true);
    assert.strictEqual(consulted, 1, 'setup is tried first but must not veto a key-valid token');
    // A setup that approves anything is still the documented short-circuit.
    const approving = { _rootKey: master, agent: null, setup: { verifyAdminToken: () => true } };
    assert.strictEqual(verify(approving, mintAdmin(new Key())), true);
  });
});
