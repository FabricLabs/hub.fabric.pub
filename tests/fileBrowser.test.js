'use strict';

const assert = require('assert');
require('@babel/register');

const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');
const FileBrowser = require('../components/FileBrowser');
const DownloadsHome = require('../components/DownloadsHome');

function renderAt (pathname, element) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [pathname] }, element)
  );
}

const SAMPLE_INDEX = {
  generatedAt: '2026-08-20T00:00:00.000Z',
  files: [
    { path: 'mac/Hub.dmg', size: 2048 },
    { path: 'linux/hub.AppImage', size: 4096 }
  ]
};

describe('FileBrowser / DownloadsHome', function () {
  it('lists folders at /downloads from a provided index', function () {
    const html = renderAt(
      '/downloads',
      React.createElement(DownloadsHome, { index: SAMPLE_INDEX })
    );
    assert.ok(html.includes('data-testid="hub-downloads-page"'));
    assert.ok(html.includes('data-testid="hub-file-browser"'));
    assert.ok(html.includes('href="/downloads/mac"'));
    assert.ok(html.includes('href="/downloads/linux"'));
    assert.ok(!html.includes('Hub.dmg'), 'root listing should not dump nested file names as top-level rows');
  });

  it('links files as static hrefs inside a folder', function () {
    const html = renderAt(
      '/downloads/mac',
      React.createElement(FileBrowser, {
        rootPath: '/downloads',
        index: SAMPLE_INDEX,
        title: 'Downloads'
      })
    );
    assert.ok(html.includes('href="/downloads/mac/Hub.dmg"'));
    assert.ok(html.includes('Hub.dmg'));
    assert.ok(html.includes('2.0 KiB'));
  });

  it('shows the empty-state copy when the index has no files', function () {
    const html = renderAt(
      '/downloads',
      React.createElement(DownloadsHome, { index: { files: [] } })
    );
    assert.ok(html.includes('No files here yet'));
    assert.ok(html.includes('build:installers'));
  });
});
