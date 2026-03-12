'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const TopPanel = require('../components/TopPanel');

function renderTopPanel (props = {}) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      React.createElement(TopPanel, props)
    )
  );
}

describe('TopPanel identity label behavior', function () {
  it('shows Login when no identity is present', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: null,
      hasLocalIdentity: false,
      hasLockedIdentity: false
    });

    assert.ok(html.includes('Login'), 'expected Login label when no identity exists');
  });

  it('shows local identity label immediately after first login', function () {
    const html = renderTopPanel({
      auth: null,
      localIdentity: {
        xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp8MS4fN5f8m6v1n9Tk5V9p6WmR5AqYeR8',
        xprv: 'xprv9s21ZrQH143K3...'
      },
      hasLocalIdentity: true,
      hasLockedIdentity: false
    });

    assert.ok(!html.includes('>Login<'), 'should not render Login after local unlock');
    assert.ok(html.includes('xpub6CUG'), 'should render local identity-derived label');
  });
});

