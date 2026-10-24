'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const t = require('../locales/en');
const SettingsHome = require('../components/SettingsHome');
const AdminHome = require('../components/AdminHome');
const HubRegtestAdminTokenPanel = require('../components/HubRegtestAdminTokenPanel');
const TrackedApplicationContractsPanel = require('../components/TrackedApplicationContractsPanel');
const { FLAG_KEYS } = require('../functions/hubUiFeatureFlags');
const { HubUiRuntimeContext, HUB_UI_RUNTIME_HUB } = require('../components/hubUiRuntime');

function render (element, initialPath = '/') {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      HubUiRuntimeContext.Provider,
      { value: HUB_UI_RUNTIME_HUB },
      React.createElement(MemoryRouter, { initialEntries: [initialPath] }, element)
    )
  );
}

/** Visible text, with collapsed Developer details removed. */
function visibleText (html) {
  return html
    .replace(/<details[\s\S]*?<\/details>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function count (haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe('Settings and Admin copy', function () {
  this.timeout(15000);

  it('Settings overview names each destination once', function () {
    const html = render(React.createElement(SettingsHome), '/settings');
    const text = visibleText(html);
    assert.strictEqual(count(html, `</i> ${t.settings.home.wallet.title}</div>`), 1, 'one Bitcoin wallet card');
    assert.strictEqual(count(html, 'href="/settings/bitcoin-wallet"'), 1);
    assert.ok(!text.includes('derivation'), 'identity card no longer repeats the wallet card');
    assert.ok(!text.includes('Distributed federation'));
    assert.ok(!/\/settings\b|\/sessions|JSON/.test(text), 'no API paths in visible copy');
  });

  it('Admin without a token shows one banner with a labeled token field', function () {
    const html = render(React.createElement(AdminHome), '/settings/admin');
    const text = visibleText(html);
    assert.strictEqual(count(html, 'id="admin-token-banner"'), 1);
    assert.ok(text.includes(t.settings.admin.token.missingTitle));
    assert.ok(html.includes('for="admin-token-input"') && html.includes('id="admin-token-input"'));
    assert.ok(!text.includes('hidden until'), 'no second missing-token banner');
    assert.ok(!/you opened/i.test(text));
    assert.ok(!/error|crash/i.test(text), 'browser smoke test rejects these words on /settings/admin');
    assert.ok(!text.includes('localStorage'));
  });

  it('Admin with a token names every Feature visibility toggle', function () {
    const html = render(React.createElement(AdminHome, { adminToken: 'test-token' }), '/settings/admin');
    const text = visibleText(html);
    assert.ok(text.includes(t.settings.admin.flagsSection.title));
    assert.ok(text.includes(t.settings.admin.token.present));
    assert.ok(!html.includes('id="admin-token-banner"'));
    for (const key of FLAG_KEYS) {
      const id = `fabric-hub-ui-flag-${key}`;
      assert.ok(html.includes(`id="${id}"`), `${key} input id`);
      assert.ok(html.includes(`for="${id}"`), `${key} has a label`);
      assert.ok(t.settings.admin.flags[key], `${key} has copy`);
    }
    assert.ok(html.includes('for="admin-http-shared-mode"'));
    assert.ok(!/hub UI feature flag/.test(html), 'aria-label no longer differs from the visible label');
    assert.ok(!text.includes('localStorage') && !text.includes('HTTP_SHARED_MODE'));
    assert.ok(html.includes('localStorage'), 'technical detail stays under Developer details');
  });

  it('regtest token panel labels its field and stays off other networks', function () {
    const html = render(React.createElement(HubRegtestAdminTokenPanel, { network: 'regtest' }));
    assert.ok(html.includes(t.settings.adminToken.title));
    assert.ok(html.includes('for="hub-admin-token-input"'));
    assert.strictEqual(render(React.createElement(HubRegtestAdminTokenPanel, { network: 'mainnet' })), '');
    const formOnly = render(React.createElement(HubRegtestAdminTokenPanel, { network: 'mainnet', formOnly: true }));
    assert.ok(formOnly.includes(t.settings.adminToken.label));
  });

  it('tracked contracts panel keeps protocol names under Developer details', function () {
    const html = render(React.createElement(TrackedApplicationContractsPanel));
    const text = visibleText(html);
    assert.ok(text.includes(t.settings.trackedContracts.title));
    assert.ok(!text.includes('CONTRACT_PUBLISH'));
    assert.ok(html.includes('CONTRACT_PUBLISH'));
  });
});
