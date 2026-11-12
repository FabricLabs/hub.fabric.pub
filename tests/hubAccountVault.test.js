'use strict';

const assert = require('assert');
const vaultLib = require('../functions/hubAccountVault');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LOCK = 'correct horse battery';

describe('hubAccountVault', function () {
  this.timeout(20000);

  const master = vaultLib.masterFromMnemonic(PHRASE, '');

  it('stores only the sealed master and public account data', function () {
    const { vault, identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'regtest' });
    const json = JSON.stringify(vault);
    assert.ok(vaultLib.isAccountVault(vault));
    assert.ok(!json.includes('xprv'), 'no unsealed private key in the stored record');
    assert.ok(!json.includes('abandon'), 'no mnemonic in the stored record');
    assert.ok(identity.xprv && identity.masterXprv, 'unlocked in memory after create');
    assert.strictEqual(identity.xpub, undefined, 'no identity xpub');
  });

  it('refuses a short lock password', function () {
    assert.throws(() => vaultLib.createVault({ master, lockPassword: 'short' }), (e) => e.code === 'FABRIC_LOCAL_PASSWORD_POLICY');
  });

  it('the BIP39 passphrase derives a different master', function () {
    assert.notStrictEqual(vaultLib.masterFromMnemonic(PHRASE, 'extension'), master);
  });

  it('reads back locked, then unlocks with the lock password only', function () {
    const { vault, identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'regtest' });
    const read = vaultLib.readStoredIdentity(JSON.parse(JSON.stringify(vault)));
    assert.strictEqual(read.kind, 'vault');
    assert.strictEqual(read.identity.id, identity.id);
    assert.strictEqual(read.identity.xprv, null);
    assert.strictEqual(read.identity.passwordProtected, true);
    assert.ok(read.identity.wallet.segwit.xpub, 'wallet stays watchable while locked');
    assert.throws(() => vaultLib.unlockVault(vault, 'wrong password!'));
    const unlocked = vaultLib.unlockVault(vault, LOCK);
    assert.strictEqual(unlocked.id, identity.id);
    assert.ok(unlocked.xprv);
  });

  it('ignores legacy plaintext and watch-only records', function () {
    assert.strictEqual(vaultLib.readStoredIdentity({ id: 'a', xpub: 'xpub6x', xprv: 'xprv9x' }).kind, null);
    assert.strictEqual(vaultLib.readStoredIdentity({ id: 'a', xpub: 'xpub6x' }).kind, null);
    assert.strictEqual(vaultLib.readStoredIdentity({ id: 'a', pubkey: '02' + 'ab'.repeat(32), linkedFromPassport: true }).kind, 'passport');
  });

  it('wallet: SegWit at m/84\' and standard at m/44\', SegWit receives', function () {
    const { identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'mainnet', account: 3 });
    assert.strictEqual(identity.wallet.segwit.path, "m/84'/0'/3'");
    assert.strictEqual(identity.wallet.standard.path, "m/44'/0'/3'");
    assert.strictEqual(identity.wallet.receive, 'segwit');
    const keys = vaultLib.walletSigningKeys(identity);
    assert.strictEqual(keys.segwit.xpub, identity.wallet.segwit.xpub);
    assert.strictEqual(keys.standard.xpub, identity.wallet.standard.xpub);
  });

  it('switching network keeps the account index and changes every key', function () {
    const { vault, identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'mainnet', account: 1 });
    const next = vaultLib.switchVaultAccount(vault, { account: 1, network: 'signet', master: identity.masterXprv });
    assert.strictEqual(next.identity.fabricAccountIndex, 1);
    assert.strictEqual(next.identity.network, 'signet');
    assert.notStrictEqual(next.identity.id, identity.id);
    assert.strictEqual(next.identity.wallet.segwit.path, "m/84'/1'/1'");
    assert.ok(/^tpub/.test(next.identity.wallet.segwit.xpub));
    assert.notStrictEqual(next.identity.cosigner.pubkey, identity.cosigner.pubkey);
  });

  it('locked, switches only to cached pairs', function () {
    const { vault, identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'regtest' });
    const withTwo = vaultLib.switchVaultAccount(vault, { account: 2, network: 'regtest', master: identity.masterXprv }).vault;
    const back = vaultLib.switchVaultAccount(withTwo, { account: 0, network: 'regtest' });
    assert.strictEqual(back.identity.id, identity.id);
    assert.strictEqual(back.identity.xprv, null);
    assert.throws(
      () => vaultLib.switchVaultAccount(withTwo, { account: 9, network: 'regtest' }),
      (e) => e.code === 'FABRIC_ACCOUNT_LOCKED'
    );
    assert.deepStrictEqual(vaultLib.cachedAccounts(withTwo).map((a) => a.account), [0, 2]);
  });

  it('signs with the identity leaf and cosigns with m/87\'', function () {
    const { identity } = vaultLib.createVault({ master, lockPassword: LOCK, network: 'regtest' });
    const signer = vaultLib.identitySigner(identity);
    assert.strictEqual(signer.fabricKey.pubkey, identity.pubkey);
    const cosigner = vaultLib.cosignerKey(identity);
    assert.strictEqual(cosigner.pubkey, identity.cosigner.pubkey);
    const locked = vaultLib.lockIdentity(identity);
    assert.strictEqual(vaultLib.identitySigner(locked), null);
    assert.strictEqual(vaultLib.cosignerKey(locked), null);
    assert.strictEqual(vaultLib.walletSigningKeys(locked), null);
  });
});
