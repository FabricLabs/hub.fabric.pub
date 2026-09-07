'use strict';

const assert = require('assert');
const Identity = require('@fabric/core/types/identity');

const {
  deriveFabricAccountIdentityKeys,
  fabricBech32IdFromCompressedPubHex,
  fabricIdentityAccountPath
} = require('../functions/fabricAccountDerivedIdentity');
const { describeFabricIdentityCapabilities } = require('../functions/fabricIdentityCapabilities');

const TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('fabricIdentityCapabilities', () => {
  it('reports no HD account switch for accountNode', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 0, 0);
    assert.strictEqual(dk.path, "m/44'/7778'/0'/0/0");
    assert.strictEqual(fabricIdentityAccountPath(0), "m/44'/7778'/0'");
    const mainnet = deriveFabricAccountIdentityKeys(master, 0, 0, 'mainnet');
    assert.strictEqual(mainnet.path, "m/44'/7777'/0'/0/0");
    assert.strictEqual(fabricIdentityAccountPath(0, 'mainnet'), "m/44'/7777'/0'");
    assert.notStrictEqual(mainnet.id, dk.id);
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

  it('rejects malformed compressed pubkeys before hashing', () => {
    assert.throws(() => fabricBech32IdFromCompressedPubHex('04' + 'ab'.repeat(32)), /compressed secp256k1/);
    assert.throws(() => fabricBech32IdFromCompressedPubHex('02dead'), /compressed secp256k1/);
    assert.throws(() => fabricBech32IdFromCompressedPubHex('zz'), /compressed secp256k1/);
  });

  it('accepts a valid compressed pubkey hex', () => {
    const ident = new Identity({ seed: TEST_PHRASE });
    const master = String(ident.key.xprv).trim();
    const dk = deriveFabricAccountIdentityKeys(master, 0, 0);
    const id = fabricBech32IdFromCompressedPubHex(dk.pubkeyHexCompressed);
    assert.strictEqual(id, dk.id);
    assert.ok(String(id).startsWith('id1'));
  });
});
