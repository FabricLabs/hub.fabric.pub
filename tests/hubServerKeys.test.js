'use strict';

const assert = require('assert');
const Key = require('@fabric/core/types/key');
const Peer = require('@fabric/core/types/peer');
const { FIXTURE_SEED } = require('@fabric/core/constants');
const { importSeed, deriveAccount } = require('@fabric/core/functions/accountKeys');
const { hubNetwork, hubServerKeys } = require('../functions/hubAccount');

const MASTER = importSeed(FIXTURE_SEED);

function hubWith (settings) {
  return { settings, _rootKey: new Key({ xprv: MASTER }) };
}

describe('hubServerKeys', function () {
  it('derives identity and cosigner from account 0 on the Hub network', function () {
    const keys = hubServerKeys(hubWith({ bitcoin: { network: 'regtest' } }));
    const expected = deriveAccount(MASTER, { account: 0, network: 'regtest' });
    assert.strictEqual(keys.network, 'regtest');
    assert.strictEqual(keys.identity.pubkey, expected.identity.pubkey);
    assert.strictEqual(keys.cosigner.pubkey, expected.cosigner.pubkey);
    assert.notStrictEqual(keys.identity.pubkey, new Key({ xprv: MASTER }).pubkey);
  });

  it('switching network changes both keys', function () {
    const regtest = hubServerKeys(hubWith({ bitcoin: { network: 'regtest' } }));
    const mainnet = hubServerKeys(hubWith({ bitcoin: { network: 'mainnet' } }));
    assert.strictEqual(mainnet.network, 'mainnet');
    assert.notStrictEqual(mainnet.identity.pubkey, regtest.identity.pubkey);
    assert.notStrictEqual(mainnet.cosigner.pubkey, regtest.cosigner.pubkey);
  });

  it('the identity key is the key core Peer uses for the same settings', function () {
    for (const network of ['regtest', 'mainnet']) {
      const settings = { key: { xprv: MASTER }, bitcoin: { network }, networking: false };
      const keys = hubServerKeys(hubWith(settings));
      // The Hub hands its key network to the Peer (core Peer defaults to regtest).
      const peer = new Peer({ ...settings, network: keys.network });
      assert.strictEqual(keys.identity.pubkey, peer.key.pubkey, network);
    }
  });

  it('follows settings.network before settings.bitcoin.network, like Peer', function () {
    assert.strictEqual(hubNetwork({ settings: { network: 'signet', bitcoin: { network: 'regtest' } } }), 'signet');
    assert.strictEqual(hubNetwork({ settings: {} }), 'regtest');
    assert.strictEqual(hubNetwork({ settings: { bitcoin: { network: 'nonsense' } } }), 'regtest');
  });

  it('has no keys without a private root', function () {
    const pub = new Key({ xprv: MASTER });
    const keys = hubServerKeys({ settings: {}, _rootKey: new Key({ xpub: pub.xpub }) });
    assert.strictEqual(keys.identity, null);
    assert.strictEqual(keys.cosigner, null);
  });
});
