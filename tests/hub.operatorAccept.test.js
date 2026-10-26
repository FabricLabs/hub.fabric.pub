'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Token = require('@fabric/core/types/token');
const Hub = require('../services/hub');
const tac = require('../functions/trackedApplicationContracts');

const DERIVE = "m/44'/7778'/0'/0/0";

function mintAdmin (issuer, subject) {
  return new Token({
    capability: 'OP_IDENTITY',
    issuer,
    subject: subject || 'admin'
  }).toSignedString();
}

function stubHub () {
  const master = new Key();
  const identity = master.derive(DERIVE);
  const hub = Object.create(Hub.prototype);
  hub.setup = { verifyAdminToken () { return false; } };
  hub._rootKey = master;
  hub._fabricKey = identity;
  hub.agent = { key: identity, identity: { id: 'agent-test' } };
  hub.bitcoin = null;
  hub._trackedApplicationContracts = tac.emptyState();
  hub.http = { broadcast () {} };
  return hub;
}

describe('Hub Accept/Reject operator tokens', function () {
  it('rejects a missing token', async function () {
    const hub = stubHub();
    const out = await hub._rejectTrackedApplicationContract({ contractId: 'c1' });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'adminToken required');
  });

  it('rejects a token from another operator when setup.verifyAdminToken is false', async function () {
    const hub = stubHub();
    const out = await hub._rejectTrackedApplicationContract({
      adminToken: mintAdmin(new Key()),
      contractId: 'c1'
    });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'adminToken invalid');
  });

  it('lets an identity-key token through Reject when setup.verifyAdminToken is false', async function () {
    const hub = stubHub();
    const out = await hub._rejectTrackedApplicationContract({
      adminToken: mintAdmin(hub._fabricKey),
      contractId: 'missing'
    });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'unknown contract publish');
  });

  it('lets an identity-key token through Accept when setup.verifyAdminToken is false', async function () {
    const hub = stubHub();
    const out = await hub._acceptTrackedApplicationContract({
      adminToken: mintAdmin(hub._fabricKey),
      contractId: 'missing'
    });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'unknown contract publish');
  });

  it('refuses a token signed by the root key', async function () {
    const hub = stubHub();
    const out = await hub._acceptTrackedApplicationContract({
      adminToken: mintAdmin(hub._rootKey),
      contractId: 'missing'
    });
    assert.strictEqual(out.message, 'adminToken invalid');
  });

  it('refuses every token while the Hub has no identity key', async function () {
    const hub = stubHub();
    const token = mintAdmin(hub._fabricKey);
    hub._fabricKey = null;
    const out = await hub._rejectTrackedApplicationContract({ adminToken: token, contractId: 'missing' });
    assert.strictEqual(out.message, 'adminToken invalid');
  });
});
