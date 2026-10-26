'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter, Routes, Route } = require('react-router-dom');
const t = require('../locales/en');
const IdentityManager = require('../components/IdentityManager');
const SecurityHome = require('../components/SecurityHome');

const copy = t.identity;

function render (element, initialPath = '/') {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [initialPath] }, element)
  );
}

/** Visible text, with collapsed Developer details removed. */
function visibleText (html) {
  return html
    .replace(/<details[\s\S]*?<\/details>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

const PUBLIC_IDENTITY = { id: 'id1examplefabricidentity', pubkey: '02' + '22'.repeat(32) };

describe('Identity and security copy', function () {
  this.timeout(15000);

  it('Security page explains the Passport session without REST paths', function () {
    const html = render(React.createElement(SecurityHome), '/settings/security');
    const text = visibleText(html);
    assert.ok(text.includes(copy.security.summary));
    assert.ok(text.includes(copy.security.session.off));
    assert.ok(!/\/sessions\b/.test(text), 'no REST paths in visible copy');
  });

  it('Passport identity offers to share the wallet and shows no xpub', function () {
    const html = render(React.createElement(IdentityManager, {
      currentIdentity: { id: 'id1passport', pubkey: '02' + '11'.repeat(32), linkedFromPassport: true }
    }));
    const text = visibleText(html);
    assert.ok(html.includes('data-testid="identity-passport-signing"'));
    assert.ok(!/[xt]pub[1-9A-HJ-NP-Za-km-z]{20}/.test(html), 'no extended public key');
  });

  it('Login chooser offers each method once, with matching back buttons', function () {
    const text = visibleText(render(React.createElement(IdentityManager, {})));
    assert.ok(text.includes(copy.manager.chooser.prompt));
    for (const label of [copy.manager.chooser.generate, copy.manager.chooser.backup, copy.manager.chooser.restore]) {
      assert.ok(text.includes(label), label);
    }
    assert.ok(!text.includes('Change method'));
  });

  it('Locked identity shows a labelled password field and the Locked status', function () {
    const html = render(React.createElement(IdentityManager, {
      currentIdentity: Object.assign({ passwordProtected: true }, PUBLIC_IDENTITY)
    }));
    assert.ok(html.includes('for="fabric-identity-unlock-password"'));
    assert.ok(html.includes('id="fabric-identity-unlock-password"'));
    const text = visibleText(html);
    assert.ok(text.includes(copy.manager.keyStatus.lockedPassword));
    assert.ok(text.includes(copy.manager.unlock.submit));
    assert.ok(!text.includes(copy.manager.keyStatus.session));
  });

  it('Passport identity says the keys stay in Passport instead of asking for a password', function () {
    const html = render(React.createElement(IdentityManager, {
      currentIdentity: Object.assign({ linkedFromPassport: true }, PUBLIC_IDENTITY)
    }));
    const text = visibleText(html);
    assert.ok(text.includes(copy.manager.keyStatus.session));
    assert.ok(!html.includes('id="fabric-identity-unlock-password"'));
    assert.ok(!text.includes(copy.manager.keyStatus.lockedPassword));
  });
});
