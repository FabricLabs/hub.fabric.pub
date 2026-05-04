'use strict';

const assert = require('assert');
const Identity = require('@fabric/core/types/identity');

const {
  buildLocalFabricIdentityPayload,
  plaintextMasterFromStored,
  fabricPlaintextSigningUnlockable,
  unlockedSessionFromDecryptedMaster,
  encryptLocalIdentityAtRest,
  decryptLocalIdentityMasterMaterial,
  fabricRootXpubFromMasterXprv
} = require('../functions/fabricHubLocalIdentity');
const {
  deriveFabricAccountIdentityKeys,
  identityFromFabricProtocolSigningXprv
} = require('../functions/fabricAccountDerivedIdentity');

const TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('fabricHubLocalIdentity fabricHdRole', () => {
  it('identityFromFabricProtocolSigningXprv matches deriveFabricAccountIdentityKeys signing node', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 3, 0);
    const again = identityFromFabricProtocolSigningXprv(dk.xprv);
    assert.strictEqual(again.id, dk.id);
    assert.strictEqual(again.xpub, dk.xpub);
    assert.strictEqual(again.fabricHdRole, 'accountNode');
  });

  it('unlockedSessionFromDecryptedMaster handles accountNode material', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 1, 0);
    const stored = {
      fabricIdentityMode: 'account',
      fabricHdRole: 'accountNode',
      fabricAccountIndex: 1,
      id: dk.id,
      xpub: dk.xpub,
      xprv: dk.xprv
    };
    const sess = unlockedSessionFromDecryptedMaster(dk.xprv, stored);
    assert.strictEqual(sess.fabricHdRole, 'accountNode');
    assert.strictEqual(sess.masterXprv, null);
    assert.strictEqual(String(sess.xprv), String(dk.xprv));
  });

  it('plaintextMasterFromStored is empty for accountNode', () => {
    assert.strictEqual(
      plaintextMasterFromStored({ fabricHdRole: 'accountNode', xprv: 'xprv9test' }),
      ''
    );
  });

  it('fabricPlaintextSigningUnlockable is true for plaintext accountNode', () => {
    assert.strictEqual(
      fabricPlaintextSigningUnlockable({ fabricHdRole: 'accountNode', xprv: 'xprv9test' }),
      true
    );
  });

  it('encryptLocalIdentityAtRest round-trips Fabric account master storage', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 0, 0);
    const masterXpub = fabricRootXpubFromMasterXprv(master);
    const plain = {
      fabricIdentityMode: 'account',
      fabricAccountIndex: 0,
      masterXpub,
      masterXprv: master,
      id: dk.id,
      xpub: dk.xpub,
      passwordProtected: false
    };
    const enc = encryptLocalIdentityAtRest(plain, 'correcthorse');
    assert.strictEqual(enc.passwordProtected, true);
    const mat = decryptLocalIdentityMasterMaterial(enc, 'correcthorse');
    assert.strictEqual(mat, master);
  });

  it('encryptLocalIdentityAtRest round-trips accountNode signing xprv', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 1, 0);
    const plain = {
      fabricIdentityMode: 'account',
      fabricHdRole: 'accountNode',
      fabricAccountIndex: 1,
      id: dk.id,
      xpub: dk.xpub,
      xprv: dk.xprv,
      passwordProtected: false
    };
    const enc = encryptLocalIdentityAtRest(plain, 'correcthorse');
    const mat = decryptLocalIdentityMasterMaterial(enc, 'correcthorse');
    assert.strictEqual(mat, dk.xprv);
  });

  it('buildLocalFabricIdentityPayload resolves watch-only Fabric account xpub', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 2, 0);
    const bl = buildLocalFabricIdentityPayload(
      {
        fabricIdentityMode: 'account',
        fabricAccountIndex: 2,
        xpub: dk.xpub
      },
      { unlockPlaintextMaster: true }
    );
    assert.strictEqual(bl.resolved, true);
    assert.strictEqual(bl.record.fabricHdRole, 'watchAccount');
    assert.strictEqual(bl.record.fabricIdentityMode, 'account');
    assert.strictEqual(bl.record.fabricAccountIndex, 2);
  });
});
