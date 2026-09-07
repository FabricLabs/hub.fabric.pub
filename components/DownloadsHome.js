'use strict';

/**
 * Public `/downloads` page: FileBrowser over build-generated `assets/downloads`.
 */

const React = require('react');
const FileBrowser = require('./FileBrowser');

function DownloadsHome (props) {
  return (
    <div data-testid="hub-downloads-page">
      <FileBrowser
        rootPath="/downloads"
        indexUrl="/downloads/index.json"
        title="Downloads"
        description="Desktop installers for this Hub. Folders are browsable in the app; files are served from this origin."
        {...props}
      />
    </div>
  );
}

module.exports = DownloadsHome;
