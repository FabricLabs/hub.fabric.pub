'use strict';

const assert = require('assert');
const Identity = require('@fabric/core/types/identity');

const {
  deriveFabricAccountIdentityKeys
} = require('../functions/fabricAccountDerivedIdentity');
const { describeFabricIdentityCapabilities } = require('../functions/fabricIdentityCapabilities');

const TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('fabricIdentityCapabilities', () => {
  it('reports no HD account switch for accountNode', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 0, 0);
    const cap = describeFabricIdentityCapabilities({
      fabricIdentityMode: 'account',
      fabricHdRole: 'accountNode',
      fabricAccountIndex: 0,
      id: dk.id,
      xpub: dk.xpub,
      xprv: dk.xprv
    });
    assert.strictEqual(cap.canSwitchFabricAccount, false);
  });

  it('enables account switch when in-memory masterXprv is present', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 0, 0);
    const cap = describeFabricIdentityCapabilities({
      fabricIdentityMode: 'account',
      fabricHdRole: 'master',
      fabricAccountIndex: 0,
      id: dk.id,
      xpub: dk.xpub,
      xprv: dk.xprv,
      masterXprv: master
    });
    assert.strictEqual(cap.hasHdMasterOnDevice, true);
    assert.strictEqual(cap.canSwitchFabricAccount, true);
    assert.strictEqual(cap.canExportFabricAccountSubtreeBackup, true);
  });

  it('keeps account switch disabled without unlocked master', () => {
    const cap = describeFabricIdentityCapabilities({
      fabricIdentityMode: 'account',
      fabricHdRole: 'master',
      fabricAccountIndex: 0,
      id: 'a'.repeat(64),
      xpub: 'xpub1'
    });
    assert.strictEqual(cap.hasHdMasterOnDevice, false);
    assert.strictEqual(cap.canSwitchFabricAccount, false);
  });
});
