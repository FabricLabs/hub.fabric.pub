'use strict';

const assert = require('assert');
const BIP32Factory = require('bip32').default;
const ecc = require('@fabric/core/types/ecc');
const accountKeys = require('@fabric/core/functions/accountKeys');
const bitcoin = require('bitcoinjs-lib');
const vaultLib = require('../functions/hubAccountVault');
const {
  deriveWalletIdFromXpub,
  deriveAndStoreReceiveAddress,
  getSpendWalletContext,
  getCrowdfundingBeneficiaryPubkeyHex,
  getCrowdfundingBeneficiaryPrivateKey32,
  getCrowdfundingBeneficiaryPayoutAddress
} = require('../functions/bitcoinClient');

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function attachMockWindow () {
  const store = (data) => ({
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  });
  global.window = {
    sessionStorage: store(Object.create(null)),
    localStorage: store(Object.create(null)),
    dispatchEvent () {},
    CustomEvent: function MockCustomEvent (name, init) { this.type = name; this.detail = init && init.detail; }
  };
}

describe('bitcoinClient account wallet context', function () {
  this.timeout(20000);

  const master = vaultLib.masterFromMnemonic(PHRASE, '');

  beforeEach(attachMockWindow);
  afterEach(function () { delete global.window; });

  it('an unlocked identity spends from its SegWit account and watches the standard one', function () {
    const identity = vaultLib.unlockedIdentity(master, { account: 2, network: 'regtest' });
    const w = getSpendWalletContext(identity);
    assert.strictEqual(w.xpub, identity.wallet.segwit.xpub);
    assert.strictEqual(w.standardXpub, identity.wallet.standard.xpub);
    assert.strictEqual(w.walletId, deriveWalletIdFromXpub(identity.wallet.segwit.xpub));
    assert.strictEqual(w.account, 2);
    assert.strictEqual(w.hasPrivateKey, true);
    const root = new BIP32Factory(ecc).fromBase58(w.xprv, bitcoin.networks.testnet);
    // Account xpubs are shared with depth, parent fingerprint, and child number zeroed.
    const shared = accountKeys.shareableAccountXpub(root.neutered().toBase58(), 'regtest');
    assert.strictEqual(shared, w.xpub, 'xprv matches the SegWit account');
    assert.ok(w.standardXprv);
  });

  it('a locked identity keeps the wallet watchable but holds no keys', function () {
    const identity = vaultLib.lockIdentity(vaultLib.unlockedIdentity(master, { account: 0, network: 'regtest' }));
    const w = getSpendWalletContext(identity);
    assert.strictEqual(w.xpub, identity.wallet.segwit.xpub);
    assert.strictEqual(w.hasPrivateKey, false);
    assert.strictEqual(w.xprv, undefined);
  });

  it('a Passport identity without a shared wallet has no xpub', function () {
    const w = getSpendWalletContext({ id: 'p1', pubkey: '02' + 'ab'.repeat(32), linkedFromPassport: true });
    assert.strictEqual(w.xpub, '');
    assert.ok(w.walletId.startsWith('fabric-'));
  });

  it('accounts and networks get separate wallets', function () {
    const a0 = getSpendWalletContext(vaultLib.unlockedIdentity(master, { account: 0, network: 'regtest' }));
    const a1 = getSpendWalletContext(vaultLib.unlockedIdentity(master, { account: 1, network: 'regtest' }));
    const main0 = getSpendWalletContext(vaultLib.unlockedIdentity(master, { account: 0, network: 'mainnet' }));
    assert.notStrictEqual(a0.walletId, a1.walletId);
    assert.notStrictEqual(a0.walletId, main0.walletId);
  });

  it('new receive addresses are native SegWit', function () {
    const identity = vaultLib.unlockedIdentity(master, { account: 0, network: 'regtest' });
    const out = deriveAndStoreReceiveAddress(getSpendWalletContext(identity), { network: 'regtest' });
    assert.ok(/^bcrt1q/.test(out.currentAddress), out.currentAddress);
  });

  it('crowdfund beneficiary is the first SegWit receive key, signable only when unlocked', function () {
    const identity = vaultLib.unlockedIdentity(master, { account: 0, network: 'regtest' });
    const pub = getCrowdfundingBeneficiaryPubkeyHex(identity);
    const priv = getCrowdfundingBeneficiaryPrivateKey32(identity);
    assert.strictEqual(Buffer.from(ecc.pointFromScalar(priv, true)).toString('hex'), pub);
    assert.ok(/^bcrt1q/.test(getCrowdfundingBeneficiaryPayoutAddress(identity, 'regtest')));
    const locked = vaultLib.lockIdentity(identity);
    assert.strictEqual(getCrowdfundingBeneficiaryPubkeyHex(locked), pub);
    assert.strictEqual(getCrowdfundingBeneficiaryPrivateKey32(locked), null);
  });
});
