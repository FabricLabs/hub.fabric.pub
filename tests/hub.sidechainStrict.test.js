'use strict';

const assert = require('assert');
const Hub = require('../services/hub');

describe('Hub sidechain strict gates', function () {
  function makeMinimalHub (settings = {}) {
    const hub = new Hub(Object.assign({
      debug: false,
      persistent: false,
      bitcoin: { enable: false },
      payjoin: { enable: false },
      distributed: settings.distributed || {}
    }, settings));

    const fsStore = new Map();
    hub.fs = {
      readFile: (name) => {
        const v = fsStore.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        fsStore.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      },
      publish: async (name, value) => {
        fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      }
    };
    hub.setup = {
      verifyAdminToken: () => false
    };
    hub._sidechainSerialize = (fn) => fn();
    return hub;
  }

  it('_allowTrustedSidechainPatch is false by default', function () {
    const hub = makeMinimalHub();
    assert.strictEqual(hub._allowTrustedSidechainPatch(), false);
  });

  it('_allowTrustedSidechainPatch respects FABRIC_SIDECHAIN_TRUSTED_PATCH=1', function () {
    const prev = process.env.FABRIC_SIDECHAIN_TRUSTED_PATCH;
    process.env.FABRIC_SIDECHAIN_TRUSTED_PATCH = '1';
    try {
      const hub = makeMinimalHub();
      assert.strictEqual(hub._allowTrustedSidechainPatch(), true);
    } finally {
      if (prev == null) delete process.env.FABRIC_SIDECHAIN_TRUSTED_PATCH;
      else process.env.FABRIC_SIDECHAIN_TRUSTED_PATCH = prev;
    }
  });

  it('_applySidechainPatchesTrusted rejects when trusted apply disabled', async function () {
    const hub = makeMinimalHub();
    const out = await hub._applySidechainPatchesTrusted([
      { op: 'add', path: '/services', value: { rsi: { digest: 'abc' } } }
    ]);
    assert.strictEqual(out.status, 'error');
    assert.match(out.message, /trusted sidechain apply disabled/);
  });

  it('_federationWitnessFailClosedEffective is true when validators configured', function () {
    const prev = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = 'aa'.repeat(32);
    try {
      const hub = makeMinimalHub();
      assert.strictEqual(hub._federationWitnessFailClosedEffective(), true);
    } finally {
      if (prev == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = prev;
    }
  });

  it('_authorizeSidechainPatchProposal rejects admin token when validators set', function () {
    const prev = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = 'bb'.repeat(32);
    try {
      const hub = makeMinimalHub();
      hub.setup.verifyAdminToken = () => true;
      const out = hub._authorizeSidechainPatchProposal({
        validators: hub._distributedFederationValidatorsFromEnv(),
        threshold: 1,
        federationWitness: null,
        adminToken: 'token',
        msgBuf: Buffer.from('test', 'utf8')
      });
      assert.strictEqual(out.status, 'error');
      assert.match(out.message, /federationWitness required/);
    } finally {
      if (prev == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
      else process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = prev;
    }
  });
});
