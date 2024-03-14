'use strict';

// Dependencies
const Filesystem = require('@fabric/core/types/filesystem');

// Services
// const Hub = require('../services/hub');

// Settings
const settings = require('../settings/local');

// Main Process
async function main (input = {}) {
  const fs = new Filesystem(input);
  await fs.start();

  // const hub = new Hub(input);
  // await hub.start();

  return {
    fs: fs,
    // hub: hub.id
  };
}

// Start & handle errors
main(settings).catch((exception) => {
  console.error('[HUB:REPORT]', 'Main process threw Exception:', exception);
}).then((result) => {
  console.log('[HUB:REPORT]', 'Main process finished:', result);
});
