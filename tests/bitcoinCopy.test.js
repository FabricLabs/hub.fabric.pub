'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const t = require('../locales/en');
const SettingsBitcoinWallet = require('../components/SettingsBitcoinWallet');
const LightningHome = require('../components/LightningHome');
const BitcoinBlockList = require('../components/BitcoinBlockList');
const BitcoinHome = require('../components/BitcoinHome');

const copy = t.bitcoin;

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

function count (haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Render a class component with chosen state, without mounting (no network). */
function renderWithState (Component, props, state, method = 'render') {
  const instance = new Component(props);
  instance.state = { ...instance.state, ...state };
  instance.setState = () => {};
  return render(instance[method]());
}

describe('Bitcoin copy', function () {
  this.timeout(20000);

  it('wallet settings links to Payments once', function () {
    const html = render(React.createElement(SettingsBitcoinWallet, { identity: {} }), '/settings/bitcoin-wallet');
    assert.strictEqual(count(html, 'href="/payments"'), 1);
    assert.strictEqual(count(visibleText(html), copy.settingsWallet.payments), 1);
  });

  it('wallet settings tells a missing identity apart from Locked and Watch-only', function () {
    const none = visibleText(render(React.createElement(SettingsBitcoinWallet, { identity: {} })));
    assert.ok(none.includes(t.common.identity.needIdentity));
    assert.ok(!none.includes(copy.settingsWallet.lockedNote));

    const locked = visibleText(render(React.createElement(SettingsBitcoinWallet, {
      identity: { id: 'id1example', passwordProtected: true }
    })));
    assert.ok(locked.includes(t.common.identity.needUnlock));

    const watchOnly = visibleText(render(React.createElement(SettingsBitcoinWallet, {
      identity: { id: 'id1example' }
    })));
    assert.ok(watchOnly.includes(t.common.identity.needFullKey));
    assert.notStrictEqual(locked, watchOnly);
  });

  it('Lightning amount fields have labels, not values', function () {
    const html = render(React.createElement(LightningHome, { identity: {} }), '/services/lightning');
    for (const id of ['lightning-invoice-amount', 'lightning-invoice-memo', 'lightning-invoice-bolt11']) {
      assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `${id} is labeled`);
    }
    assert.ok(visibleText(html).includes(copy.lightning.invoiceAmount));
  });

  it('explorer with no blocks explains where blocks come from', function () {
    const html = renderWithState(
      BitcoinBlockList,
      { bitcoin: { network: 'regtest' } },
      { loading: false, status: { available: false, status: 'ERROR' } }
    );
    const text = visibleText(html);
    assert.ok(text.includes(copy.shared.noBlocks.title));
    assert.ok(text.includes(copy.shared.noBlocks.body));
    assert.ok(text.includes(copy.shared.noBlocks.check));
    assert.ok(text.includes(copy.shared.noBlocks.regtest));
    assert.ok(text.includes(copy.health.unreachable));
  });

  it('Bitcoin dashboard says when Bitcoin is off or unreachable', function () {
    const props = { identity: {}, bitcoinPage: 'dashboard' };
    const off = visibleText(renderWithState(BitcoinHome, props, {
      loading: false,
      bitcoinStatus: { available: false, status: 'UNAVAILABLE' }
    }));
    assert.ok(off.includes(copy.health.off));
    assert.ok(!off.includes(copy.health.unreachable));

    const unreachable = visibleText(renderWithState(BitcoinHome, props, {
      loading: false,
      bitcoinStatus: { available: false, status: 'ERROR', message: 'connect ECONNREFUSED 127.0.0.1:20444' }
    }));
    assert.ok(unreachable.includes(copy.health.unreachable));
    assert.ok(!unreachable.includes('ECONNREFUSED'), 'raw error stays under Developer details');
  });
});
