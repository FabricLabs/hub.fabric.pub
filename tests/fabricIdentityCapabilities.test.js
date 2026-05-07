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
});
