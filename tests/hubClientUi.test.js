'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const TopPanel = require('../components/TopPanel');
const SettingsHome = require('../components/SettingsHome');
const Home = require('../components/Home');
const {
  HubUiRuntimeContext,
  HubMeshContext,
  HUB_UI_RUNTIME_CLIENT,
  HUB_UI_RUNTIME_HUB
} = require('../components/hubUiRuntime');

function renderWithRuntime (element, runtime, initialPath = '/', meshAvailable = false) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      HubUiRuntimeContext.Provider,
      { value: runtime },
      React.createElement(
        HubMeshContext.Provider,
        { value: !!meshAvailable },
        React.createElement(MemoryRouter, { initialEntries: [initialPath] }, element)
      )
    )
  );
}

describe('Hub UI client vs hub chrome', function () {
  this.timeout(15000);

  it('TopPanel default (hub) keeps Documents and hides client Settings nav', function () {
    const html = renderWithRuntime(React.createElement(TopPanel, { publicHubVisitor: true }), HUB_UI_RUNTIME_HUB);
    assert.ok(html.includes('Documents'), 'hub chrome should include Documents');
    assert.ok(!html.includes('data-testid="hub-nav-downloads"'), 'hub chrome should not put Downloads in the header');
    assert.ok(!html.includes('data-testid="hub-nav-settings"'), 'hub chrome should not swap Documents for Settings');
  });

  it('TopPanel client origin shows Settings instead of Documents', function () {
    const html = renderWithRuntime(React.createElement(TopPanel, { publicHubVisitor: true }), HUB_UI_RUNTIME_CLIENT);
    assert.ok(html.includes('data-testid="hub-nav-settings"'), 'client chrome should expose Settings');
    assert.ok(!html.includes('data-testid="hub-nav-downloads"'), 'client chrome should not put Downloads in the header');
    assert.ok(!html.includes('data-testid="hub-nav-documents"'), 'client chrome should hide Documents');
    assert.ok(!html.includes('>Peers<'), 'client chrome should hide Peers');
  });

  it('SettingsHome client origin keeps identity and local wallet, hides Documents', function () {
    const html = renderWithRuntime(React.createElement(SettingsHome), HUB_UI_RUNTIME_CLIENT, '/settings');
    assert.ok(html.includes('data-testid="hub-client-settings"'));
    assert.ok(html.includes('Fabric identity'));
    assert.ok(html.includes('Bitcoin wallet'));
    assert.ok(!html.includes('href="/documents"'), 'client settings should not advertise Documents');
    assert.ok(!html.includes('Bitcoin dashboard'), 'client settings should hide Hub Bitcoin dashboard');
    assert.ok(!html.includes('Security &amp; delegation'), 'client settings should hide /sessions security');
  });

  it('SettingsHome hub origin keeps operator cards', function () {
    const html = renderWithRuntime(React.createElement(SettingsHome), HUB_UI_RUNTIME_HUB, '/settings');
    assert.ok(html.includes('data-testid="hub-settings-home"'));
    assert.ok(html.includes('Documents'));
    assert.ok(html.includes('Bitcoin dashboard'));
  });

  it('Home client origin does not wait on a hub snapshot', function () {
    const html = renderWithRuntime(React.createElement(Home), HUB_UI_RUNTIME_CLIENT);
    assert.ok(html.includes('data-testid="hub-client-home"'));
    assert.ok(!html.includes('Waiting for hub snapshot'));
    assert.ok(!html.includes('Opening WebSocket'));
    assert.ok(html.includes('data-testid="hub-client-downloads"'));
  });

  it('TopPanel client origin with seed mesh shows Documents and Settings', function () {
    const html = renderWithRuntime(
      React.createElement(TopPanel, { publicHubVisitor: true }),
      HUB_UI_RUNTIME_CLIENT,
      '/',
      true
    );
    assert.ok(html.includes('data-testid="hub-nav-documents"'), 'mesh chrome should expose Documents');
    assert.ok(html.includes('data-testid="hub-nav-settings"'), 'client chrome should keep Settings');
  });

  it('Home client origin with seed mesh links to Documents', function () {
    const html = renderWithRuntime(React.createElement(Home), HUB_UI_RUNTIME_CLIENT, '/', true);
    assert.ok(html.includes('data-testid="hub-client-home"'));
    assert.ok(html.includes('data-testid="hub-client-documents"'));
  });
});
