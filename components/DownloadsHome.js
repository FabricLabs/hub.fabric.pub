'use strict';

/**
 * Public `/downloads` page: FileBrowser over build-generated `assets/downloads`.
 */

const React = require('react');
const FileBrowser = require('./FileBrowser');
const t = require('../locales/en');

function DownloadsHome (props) {
  return (
    <div data-testid="hub-downloads-page">
      <FileBrowser
        rootPath="/downloads"
        indexUrl="/downloads/index.json"
        title={t.home.downloads.title}
        description={t.home.downloads.description}
        {...props}
      />
    </div>
  );
}

module.exports = DownloadsHome;
