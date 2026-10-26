'use strict';

const assert = require('assert');
const h = require('../functions/hubIdentityUiHints');

const PUBKEY = `02${'ab'.repeat(32)}`;

describe('hubIdentityUiHints', function () {
  it('classifies password-protected without xprv as password_locked', function () {
    assert.strictEqual(h.classifyHubBrowserIdentity({ id: 'a', passwordProtected: true }), 'password_locked');
  });

  it('classifies an identity without keys or password as watch_only', function () {
    assert.strictEqual(h.classifyHubBrowserIdentity({ id: 'a', linkedFromPassport: true }), 'watch_only');
  });

  it('classifies an xpub alone as no identity', function () {
    assert.strictEqual(h.classifyHubBrowserIdentity({ xpub: 'xpub1' }), 'none');
  });

  it('suffix mentions watch-only path when not password locked', function () {
    const s = h.fabricIdentityUnlockSuffixPlain({ id: 'a' });
    assert.ok(/import your full key/i.test(s));
    assert.ok(!/Locked control to enter your encryption password/i.test(s));
  });

  it('suffix mentions Locked password path when password protected', function () {
    const s = h.fabricIdentityUnlockSuffixPlain({ id: 'a', passwordProtected: true });
    assert.ok(/Locked/i.test(s) && /password/i.test(s));
  });

  it('featuresPageIdentityButtonLabelFromStorage reads only the vault or Passport record', function () {
    const { createVault } = require('../functions/hubAccountVault');
    const Key = require('@fabric/core/types/key');
    const master = new Key({ seed: 'ab'.repeat(32) }).master.toBase58();
    const { vault } = createVault({ master, lockPassword: 'correct horse', network: 'regtest' });
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage(vault), 'Locked');
    assert.strictEqual(
      h.featuresPageIdentityButtonLabelFromStorage({ id: 'abcdef0123456789abcdef', pubkey: PUBKEY, linkedFromPassport: true }),
      'abcdef01…89abcdef'
    );
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage({ xpub: 'xpub1234567890abcdef', xprv: 'xprv1' }), 'Log in');
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage(null), 'Log in');
  });
});
