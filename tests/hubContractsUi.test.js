'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter, Routes, Route } = require('react-router-dom');
const FederationPage = require('../components/FederationPage');
const FabricMessagesHome = require('../components/FabricMessagesHome');
const FabricMessageRecord = require('../components/FabricMessageRecord');
const CollectionRecordPage = require('../components/CollectionRecordPage');
const ContractJournal = require('../components/ContractJournal');
const YourFederations = require('../components/YourFederations');
const t = require('../locales/en');

function render (path, url, element) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [url] },
      React.createElement(Routes, null, React.createElement(Route, { path, element })))
  );
}

describe('Hub contract and federation pages (server render)', function () {
  this.timeout(15000);

  it('renders the federation, message, and collection pages while they load', function () {
    assert.ok(render('/federations/:id', '/federations/abcdef012345', React.createElement(FederationPage)).includes(t.federation.page.loading));
    assert.ok(render('/messages', '/messages?type=ChatMessage', React.createElement(FabricMessagesHome)).includes(t.messages.home.title));
    assert.ok(render('/messages/:id', '/messages/abc', React.createElement(FabricMessageRecord)).includes(t.messages.record.loading));
    assert.ok(render('/collections/:kind/:id', '/collections/group/g1', React.createElement(CollectionRecordPage)).includes(t.messages.collection.loading));
    assert.ok(render('/yours', '/yours', React.createElement(YourFederations)).length > 0);
  });

  it('sends Hub kinds on /collections to their own page', function () {
    const html = render('/collections/:kind/:id', '/collections/federation/abc', React.createElement(CollectionRecordPage));
    assert.ok(!html.includes(t.messages.collection.loading), 'redirects instead of loading');
  });

  it('renders a contract journal with log, seal, and queue rows', function () {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ContractJournal, {
      application: {
        contractId: 'ab'.repeat(32),
        seals: [{ seq: 1, clock: 4, at: '2026-01-02T00:00:00.000Z' }],
        queue: { count: 1, entries: [{ hash: 'q'.repeat(64), type: 'GroupChange', enqueuedAt: '2026-01-03T00:00:00.000Z' }] },
        messages: [{ id: 'm1', seq: 1, type: 'CONTRACT_PUBLISH', created: '2026-01-01T00:00:00.000Z', frameId: 'f'.repeat(64) }]
      }
    })));
    assert.ok(html.includes('Statechain sealed (clock 4)'));
    assert.ok(html.includes('Queued group change'));
    assert.ok(html.includes('Contract publish'));
    assert.ok(html.includes(`/messages/${'f'.repeat(64)}`), 'log rows link to their Fabric message');
    assert.ok(html.includes(t.messages.journal.sources.seal));
  });

  it('says when a journal is empty', function () {
    const html = ReactDOMServer.renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ContractJournal, { journal: [] })));
    assert.ok(html.includes(t.messages.journal.none));
  });
});
