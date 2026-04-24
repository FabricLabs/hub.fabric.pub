'use strict';

const assert = require('assert');
const h = require('../functions/hubIdentityUiHints');

describe('hubIdentityUiHints', function () {
  it('classifies password-protected without xprv as password_locked', function () {
    assert.strictEqual(h.classifyHubBrowserIdentity({ id: 'a', xpub: 'xpub1', passwordProtected: true }), 'password_locked');
  });

  it('classifies xpub-only as watch_only', function () {
    assert.strictEqual(h.classifyHubBrowserIdentity({ id: 'a', xpub: 'xpub1' }), 'watch_only');
  });

  it('suffix mentions watch-only path when not password locked', function () {
    const s = h.fabricIdentityUnlockSuffixPlain({ xpub: 'xpub9' });
    assert.ok(/watch-only/i.test(s) || /import a full key/i.test(s));
    assert.ok(!/Locked control to enter your encryption password/i.test(s));
  });

  it('suffix mentions Locked password path when password protected', function () {
    const s = h.fabricIdentityUnlockSuffixPlain({ xpub: 'xpub9', passwordProtected: true });
    assert.ok(/Locked/i.test(s) && /password/i.test(s));
  });

  it('featuresPageIdentityButtonLabelFromStorage matches TopPanel-style states', function () {
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage({ xpub: 'xpub1234567890abcdef', passwordProtected: true }, null), 'Locked');
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage({ xpub: 'xpub1234567890abcdef' }, null), 'Watch-only');
    assert.strictEqual(h.featuresPageIdentityButtonLabelFromStorage({ xpub: 'xpub1234567890abcdef', xprv: 'xprv1' }, null), 'xpub1234…90abcdef');
  });
});
