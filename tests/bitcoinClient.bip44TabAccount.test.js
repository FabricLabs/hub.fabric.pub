'use strict';

const assert = require('assert');
const bip39 = require('bip39');
const BIP32Factory = require('bip32').default;
const ecc = require('@fabric/core/types/ecc');
const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function' ? ecpairMod : (ecpairMod.default || ecpairMod.ECPairFactory);
const ecpairFactory = ECPairFactory(ecc);
const {
  deriveFabricBitcoinAccountKeys,
  deriveWalletIdFromXpub,
  deriveAndStoreReceiveAddress,
  getNextReceiveWalletContext,
  getSpendWalletContext,
  loadSessionBip44Account,
  saveSessionBip44Account,
  savePersistedDefaultBip44Account,
  hasBip44SessionOverride,
  getCrowdfundingBeneficiaryPubkeyHex,
  getCrowdfundingBeneficiaryPrivateKey32
} = require('../functions/bitcoinClient');

const LEGACY_SESSION_KEY = 'fabric.bitcoin.bip44Account';

function attachMockWindow () {
  const sessionStore = Object.create(null);
  const localStore = Object.create(null);
  const storage = (store) => ({
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  });
  global.window = {
    sessionStorage: storage(sessionStore),
    localStorage: storage(localStore),
    dispatchEvent: () => {},
    CustomEvent: function MockCustomEvent (name, init) {
      this.type = name;
      this.detail = init && init.detail;
    }
  };
}

describe('bitcoinClient fixed BIP44 account for Hub/browser payments', function () {
  this.timeout(10000);
  afterEach(function () {
    delete global.window;
  });

  it('getSpendWalletContext and getNextReceiveWalletContext use account 0 despite session overrides', function () {
    attachMockWindow();
    saveSessionBip44Account(2, { role: 'send' });
    saveSessionBip44Account(3, { role: 'receive' });
    const seed = bip39.mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const bip32 = new BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterXprv = root.toBase58();
    const masterXpub = root.neutered().toBase58();
    const identity = { xprv: masterXprv, xpub: masterXpub };
    const acct0 = deriveFabricBitcoinAccountKeys(masterXprv, masterXpub, 0);
    const wSend = getSpendWalletContext(identity);
    const wRecv = getNextReceiveWalletContext(identity);
    assert.strictEqual(wSend.xpub, acct0.xpub);
    assert.strictEqual(wRecv.xpub, acct0.xpub);
    assert.strictEqual(wSend.bitcoinBip44Account, 0);
    assert.strictEqual(wRecv.bitcoinBip44Account, 0);
  });
});

describe('bitcoinClient BIP44 tab account derivation', function () {
  this.timeout(10000);
  it('derives distinct xpubs and walletIds for accounts 0 and 1 from same master', function () {
    const seed = bip39.mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const bip32 = new BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterXprv = root.toBase58();
    const masterXpub = root.neutered().toBase58();

    const a0 = deriveFabricBitcoinAccountKeys(masterXprv, masterXpub, 0);
    const a1 = deriveFabricBitcoinAccountKeys(masterXprv, masterXpub, 1);

    assert.ok(a0.xpub && a1.xpub);
    assert.notStrictEqual(a0.xpub, a1.xpub);
    assert.strictEqual(a0.path, "m/44'/0'/0'");
    assert.strictEqual(a1.path, "m/44'/0'/1'");

    const idMaster = deriveWalletIdFromXpub(masterXpub);
    const id0 = deriveWalletIdFromXpub(a0.xpub);
    const id1 = deriveWalletIdFromXpub(a1.xpub);
    assert.notStrictEqual(idMaster, id0);
    assert.notStrictEqual(id0, id1);
  });
});

describe('bitcoinClient BIP44 receive vs send session keys', function () {
  this.timeout(10000);
  afterEach(function () {
    delete global.window;
  });

  it('persists receive and send branches independently', function () {
    attachMockWindow();
    saveSessionBip44Account(0, { role: 'receive' });
    saveSessionBip44Account(1, { role: 'send' });
    assert.strictEqual(loadSessionBip44Account({ role: 'receive' }), 0);
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), 1);
    assert.strictEqual(loadSessionBip44Account(), 1);
  });

  it('migrates legacy fabric.bitcoin.bip44Account into both keys', function () {
    attachMockWindow();
    window.sessionStorage.setItem(LEGACY_SESSION_KEY, '2');
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), 2);
    assert.strictEqual(loadSessionBip44Account({ role: 'receive' }), 2);
    assert.strictEqual(window.sessionStorage.getItem(LEGACY_SESSION_KEY), null);
  });

  it('uses Settings default send path when session has no override', function () {
    attachMockWindow();
    savePersistedDefaultBip44Account('send', 2);
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), 2);
    assert.strictEqual(hasBip44SessionOverride('send'), false);
  });

  it('session index overrides Settings default', function () {
    attachMockWindow();
    savePersistedDefaultBip44Account('send', 2);
    saveSessionBip44Account(1, { role: 'send' });
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), 1);
    assert.strictEqual(hasBip44SessionOverride('send'), true);
  });

  it('clearing session falls back to Settings default', function () {
    attachMockWindow();
    savePersistedDefaultBip44Account('send', 2);
    saveSessionBip44Account(1, { role: 'send' });
    saveSessionBip44Account(null, { role: 'send' });
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), 2);
    assert.strictEqual(hasBip44SessionOverride('send'), false);
  });

  it('session master forces master xpub even when default is an account', function () {
    attachMockWindow();
    savePersistedDefaultBip44Account('send', 1);
    saveSessionBip44Account('master', { role: 'send' });
    assert.strictEqual(loadSessionBip44Account({ role: 'send' }), null);
    assert.strictEqual(hasBip44SessionOverride('send'), true);
  });
});

describe('bitcoinClient crowdfund beneficiary key (m/44\'/0\'/0\'/0/0)', function () {
  this.timeout(10000);
  it('returns null private key without master xprv', function () {
    assert.strictEqual(
      getCrowdfundingBeneficiaryPrivateKey32({ xpub: 'xpub661MyMwAqRbcF6GygV6Q6XAg8dqhPvDuhYHGniequi6HMbYhNNH5XC13Np3qRANHVD2mmnNGtMGBfDT69s2ovpHLr7q8syoAuyWqtRGEsYQ' }),
      null
    );
  });

  it('beneficiary pubkey matches ECPair derived from private key leaf', function () {
    const seed = bip39.mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const bip32 = new BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterXprv = root.toBase58();
    const masterXpub = root.neutered().toBase58();
    const identity = { xprv: masterXprv, xpub: masterXpub };
    const pubHex = getCrowdfundingBeneficiaryPubkeyHex(identity);
    const priv32 = getCrowdfundingBeneficiaryPrivateKey32(identity);
    assert.ok(pubHex && /^0[23][0-9a-f]{64}$/i.test(pubHex));
    assert.ok(priv32 && priv32.length === 32);
    const kp = ecpairFactory.fromPrivateKey(priv32);
    assert.strictEqual(Buffer.from(kp.publicKey).toString('hex'), pubHex);
  });
});

describe('bitcoinClient receive address pool (identity-scoped storage)', function () {
  this.timeout(10000);
  afterEach(function () {
    delete global.window;
  });

  it('migrates legacy walletId bucket to root|recv|account when identity is passed', function () {
    attachMockWindow();
    const seed = bip39.mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const bip32 = new BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterXprv = root.toBase58();
    const masterXpub = root.neutered().toBase58();

    saveSessionBip44Account(0, { role: 'receive' });
    const identity = { xprv: masterXprv, xpub: masterXpub };
    const wallet = getNextReceiveWalletContext(identity);
    assert.ok(wallet.walletId && wallet.xpub);

    const first = deriveAndStoreReceiveAddress(wallet, { network: 'regtest' });
    assert.ok(first && first.currentAddress);
    const legacyKey = wallet.walletId;
    const storeMid = JSON.parse(window.localStorage.getItem('fabric.bitcoin.wallets'));
    assert.ok(storeMid[legacyKey]);

    const poolKey = `${deriveWalletIdFromXpub(masterXpub)}|recv|0`;
    deriveAndStoreReceiveAddress(wallet, { network: 'regtest', identity });
    const storeFinal = JSON.parse(window.localStorage.getItem('fabric.bitcoin.wallets'));
    assert.ok(storeFinal[poolKey], 'pool key should exist after migration');
    assert.strictEqual(storeFinal[poolKey].receiveAddresses.length, 1);
  });
});
