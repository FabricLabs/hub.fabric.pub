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
  const derived = master.derive(DERIVE);
  const hub = Object.create(Hub.prototype);
  hub.setup = { verifyAdminToken () { return false; } };
  hub._rootKey = master;
  hub.agent = { key: derived, identity: { id: 'agent-test' } };
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

  it('lets a _rootKey token through when setup.verifyAdminToken is false', async function () {
    const hub = stubHub();
    hub.agent.key = undefined;
    const out = await hub._acceptTrackedApplicationContract({
      adminToken: mintAdmin(hub._rootKey),
      contractId: 'missing'
    });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'unknown contract publish');
  });

  it('lets an agent.key token through when setup.verifyAdminToken is false', async function () {
    const hub = stubHub();
    const out = await hub._rejectTrackedApplicationContract({
      adminToken: mintAdmin(hub.agent.key),
      contractId: 'missing'
    });
    assert.strictEqual(out.status, 'error');
    assert.strictEqual(out.message, 'unknown contract publish');
  });

  it('skips an unset agent.key and still accepts the _rootKey token', async function () {
    const hub = stubHub();
    hub.agent.key = undefined;
    const ok = await hub._rejectTrackedApplicationContract({
      adminToken: mintAdmin(hub._rootKey),
      contractId: 'missing'
    });
    assert.strictEqual(ok.message, 'unknown contract publish');
    const bad = await hub._rejectTrackedApplicationContract({
      adminToken: mintAdmin(new Key()),
      contractId: 'missing'
    });
    assert.strictEqual(bad.message, 'adminToken invalid');
  });
});
