'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const TopPanel = require('../components/TopPanel');

function renderTopPanel (props = {}) {
  const merged = { publicHubVisitor: true, ...props };
  if (merged.localIdentity && (merged.localIdentity.xprv || merged.localIdentity.private)) {
    merged.publicHubVisitor = false;
  }
  if (merged.auth && (merged.auth.xprv || merged.auth.private)) {
    merged.publicHubVisitor = false;
  }
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      React.createElement(TopPanel, merged)
    )
  );
}

describe('TopPanel identity label behavior', function () {
  this.timeout(15000);

  it('shows Log in when no identity is present', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: null,
      hasLocalIdentity: false,
      hasLockedIdentity: false
    });

    assert.ok(html.includes('Log in'), 'expected Log in label when no identity exists');
  });

  it('shows local identity label immediately after first login', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        id: 'fabricid1234567890abcdef',
        xprv: 'xprv9s21ZrQH143K3...'
      },
      hasLocalIdentity: true,
      hasLockedIdentity: false
    });

    assert.ok(!html.includes('>Log in<'), 'should not render Log in after local unlock');
    assert.ok(html.includes('fabricid'), 'should render the Fabric ID');
    assert.ok(!html.includes('xpub'), 'never an extended key');
  });

  it('shows Watch-only for an identity with no key and no password (not password Locked)', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        id: 'id1'
      },
      hasLocalIdentity: true,
      hasLockedIdentity: false
    });

    assert.ok(html.includes('Watch-only'), 'watch-only signing should not use Locked label');
    assert.ok(!html.includes('>Locked<'), 'Locked is reserved for password-protected key in memory');
  });

  it('shows a Passport login as the identity, not Watch-only', function () {
    const html = renderTopPanel({
      publicHubVisitor: false,
      showHubNav: true,
      auth: null,
      localIdentity: {
        id: 'passportid1234567890',
        wallet: { segwit: { xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp8MS4fN5f8m6v1n9Tk5V9p6WmR5AqYeR8' } },
        linkedFromPassport: true
      },
      hasLocalIdentity: true,
      hasLockedIdentity: false,
      clientBalance: { balanceSats: 1000 }
    });

    assert.ok(html.includes('hub-identity-chip-passport'), 'Passport chip rendered');
    assert.ok(html.includes('passport…34567890'), 'chip shows the Fabric ID');
    assert.ok(!html.includes('Watch-only'), 'Passport login is not watch-only');
    assert.ok(html.includes('1,000 sats'), 'wallet chip shows the balance of the shared wallet');
  });

  it('shows Locked when password-protected identity has no xprv in memory', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        id: 'id1',
        passwordProtected: true
      },
      hasLocalIdentity: true,
      hasLockedIdentity: true
    });

    assert.ok(html.includes('>Locked<'), 'password identity without xprv shows Locked');
  });

  it('balance chip prompts unlock instead of implying a live balance when password-locked', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        id: 'id1',
        wallet: { segwit: { xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp8MS4fN5f8m6v1n9Tk5V9p6WmR5AqYeR8' } },
        passwordProtected: true
      },
      hasLocalIdentity: true,
      hasLockedIdentity: true,
      clientBalance: { balanceSats: 1000 }
    });

    assert.ok(html.includes('Unlock for balance'), 'chip should not show sats while locked');
    assert.ok(!html.includes('1,000 sats'), 'balance text hidden until unlock');
  });

  it('lists Your profile and Manage identity separately when unlocked', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        id: '02' + 'ab'.repeat(32),
        xprv: 'xprv9s21ZrQH143K3...'
      },
      hasLocalIdentity: true,
      hasLockedIdentity: false
    });
    assert.ok(html.includes('Your profile'), 'Your profile menu item');
    assert.ok(html.includes('Manage identity'), 'Manage identity opens keys modal');
  });
});

