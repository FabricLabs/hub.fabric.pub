'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const PeerList = require('../components/PeerList');

describe('PeerList bandwidth columns', function () {
  this.timeout(15000);

  it('renders sortable In/Out and 10m budget columns from knownPeers fields', function () {
    const networkStatus = {
      fabricPeerId: '03ab',
      network: { address: '127.0.0.1:7777', listening: true },
      peers: [
        {
          id: 'hot-peer',
          address: '192.0.2.1:7777',
          status: 'connected',
          lastSeen: '2026-09-04T00:00:00.000Z',
          bytesIn: 20000,
          bytesOut: 4000,
          windowBytes: 24000,
          budgetBytes: 32768,
          overBudget: false
        }
      ]
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/peers'] },
        React.createElement(PeerList, {
          bridgeRef: { current: { networkStatus } }
        })
      )
    );
    assert.ok(html.includes('In / Out'), 'expected In / Out column');
    assert.ok(html.includes('10m / budget'), 'expected 10m budget column');
    assert.ok(html.includes('19.5 KiB') || html.includes('20000'), 'expected inbound bytes');
    assert.ok(html.includes('sortable') || html.includes('sorted'), 'expected sortable table chrome');
    assert.ok(html.includes('32 KiB') || html.includes('32768') || html.includes('L1'), 'expected L1 budget copy');
  });

  it('renders mesh alias as the human subtitle without borrowing another peer nickname', function () {
    const networkStatus = {
      fabricPeerId: '03ab',
      network: { address: '127.0.0.1:7777', listening: true },
      peers: [
        {
          id: `02${'aa'.repeat(32)}`,
          publicKey: `02${'aa'.repeat(32)}`,
          address: 'hub.fabric.pub:7777',
          status: 'disconnected',
          alias: 'Alice',
          nickname: 'local-alice'
        },
        {
          id: `03${'bb'.repeat(32)}`,
          publicKey: `03${'bb'.repeat(32)}`,
          address: 'hub.fabric.pub:7777',
          status: 'connected',
          alias: 'Bob'
        }
      ]
    };
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/peers'] },
        React.createElement(PeerList, {
          bridgeRef: { current: { networkStatus } }
        })
      )
    );
    assert.ok(html.includes('Alice'), 'expected Alice mesh alias');
    assert.ok(html.includes('Bob'), 'expected Bob mesh alias');
    assert.ok(!html.includes('Alice (local: Bob)') && !html.includes('Bob (local: Alice)'),
      'aliases must not be cross-wired onto the other identity');
  });
});
