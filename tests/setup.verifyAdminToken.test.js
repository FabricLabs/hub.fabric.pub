'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Token = require('@fabric/core/types/token');
const SetupService = require('../services/setup');

describe('SetupService.verifyAdminToken', function () {
  it('accepts OP_IDENTITY / admin and rejects other signed capabilities', function () {
    const key = new Key();
    const setup = new SetupService({ key });
    const admin = new Token({
      capability: 'OP_IDENTITY',
      issuer: key,
      subject: 'admin'
    }).toSignedString();
    const other = new Token({
      capability: 'OP_0',
      issuer: key,
      subject: 'admin'
    }).toSignedString();
    const wrongSubject = new Token({
      capability: 'OP_IDENTITY',
      issuer: key,
      subject: 'peer'
    }).toSignedString();
    assert.strictEqual(setup.verifyAdminToken(admin), true);
    assert.strictEqual(setup.verifyAdminToken(other), false);
    assert.strictEqual(setup.verifyAdminToken(wrongSubject), false);
    assert.strictEqual(setup.verifyAdminToken('not-a-token'), false);
  });
});
