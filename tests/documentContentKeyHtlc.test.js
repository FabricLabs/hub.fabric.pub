'use strict';

const assert = require('assert');
const crypto = require('crypto');
const documentContentKey = require('../functions/documentContentKey');
const { publicFeatureFlags, FEATURE_FLAGS } = require('../constants');
const {
  defaultHubUiFeatureFlags,
  documentMarketUiFlags
} = require('../functions/hubUiFeatureFlags');
const { serverFeatureFlagsFromStatus } = require('../functions/hubServerFeatureFlags');

describe('documentContentKey + document-market flags', function () {
  it('seals plaintext and opens with the same content key', function () {
    const plain = Buffer.from('hello document market\n', 'utf8');
    const sealed = documentContentKey.sealPlaintext(plain);
    assert.strictEqual(sealed.key.length, 32);
    assert.strictEqual(sealed.encryption.scheme, documentContentKey.SCHEME);
    assert.ok(sealed.ciphertext.length > plain.length);
    const opened = documentContentKey.openCiphertext(sealed.ciphertext, sealed.key, sealed.iv);
    assert.ok(opened.equals(plain));
    const hash = documentContentKey.paymentHashHexFromKey(sealed.key);
    assert.strictEqual(hash.length, 64);
    assert.strictEqual(
      hash,
      crypto.createHash('sha256').update(sealed.key).digest('hex')
    );
  });

  it('isSealedDocument detects scheme', function () {
    assert.strictEqual(documentContentKey.isSealedDocument(null), false);
    assert.strictEqual(documentContentKey.isSealedDocument({}), false);
    assert.strictEqual(
      documentContentKey.isSealedDocument({ encryption: { scheme: documentContentKey.SCHEME } }),
      true
    );
  });

  it('write/read content key via mock fs', async function () {
    const store = Object.create(null);
    const fs = {
      publish: async (path, doc) => { store[path] = JSON.stringify(doc); },
      readFile: (path) => store[path] || null
    };
    const key = crypto.randomBytes(32);
    const id = 'abc123';
    await documentContentKey.writeContentKey(fs, id, key);
    const path = documentContentKey.contentKeyStorePath(id);
    assert.ok(store[path]);
    const read = documentContentKey.readContentKey(fs, id);
    assert.ok(read);
    assert.ok(read.equals(key));
  });

  it('document-market UI defaults hide unrelated surfaces', function () {
    const d = defaultHubUiFeatureFlags();
    assert.strictEqual(d.peers, true);
    assert.strictEqual(d.bitcoinInvoices, true);
    assert.strictEqual(d.bitcoinExplorer, true);
    assert.strictEqual(d.activities, false);
    assert.strictEqual(d.features, false);
    assert.strictEqual(d.sidechain, false);
    assert.strictEqual(d.bitcoinCrowdfund, false);
    assert.strictEqual(d.bitcoinLightning, false);
    const preset = documentMarketUiFlags();
    assert.deepStrictEqual(preset, d);
  });

  it('publicFeatureFlags expose distribute off and documentPurchase on by default', function () {
    const f = publicFeatureFlags();
    assert.strictEqual(f.documentPurchase, true);
    assert.strictEqual(f.distribute, false);
    assert.strictEqual(f.webrtc, FEATURE_FLAGS.WEBRTC);
    assert.strictEqual(f.payjoin, false);
    assert.strictEqual(f.lightning, false);
  });

  it('serverFeatureFlagsFromStatus defaults distribute false when missing', function () {
    const f = serverFeatureFlagsFromStatus({ featureFlags: { documentPurchase: true } });
    assert.strictEqual(f.distribute, false);
    assert.strictEqual(f.documentPurchase, true);
    const on = serverFeatureFlagsFromStatus({ featureFlags: { distribute: true } });
    assert.strictEqual(on.distribute, true);
  });
});
