'use strict';

// Dependencies
const Peer = require('@fabric/core/types/peer');

// Configuration
const settings = {
  listen: true,
  seed: process.env.FABRIC_SEED
};

// Main process
async function main () {
  const hub = new Peer(settings);

  hub.on('peer', function (peer) {
    console.log('[SCRIPTS:HUB]', `New peer connected: ${JSON.stringify(peer)}`);
  });

  await hub.start();
}

// Start & handle errors
main().catch((exception) => {
  console.error('[SCRIPTS:HUB]', 'Main process threw Exception:', exception);
});