'use strict';

// Dependencies
const Peer = require('@fabric/core/types/peer');
const defaults = require('../settings/default');

// Configuration
const settings = {
  listen: true,
  port: process.env.FABRIC_PORT || defaults.port,
  seed: process.env.FABRIC_SEED || defaults.seed
};

// Main process
async function main () {
  const hub = new Peer(settings);

  hub.on('ready', function (node) {
    console.log('[FABRIC:HUB]', `Hub is now started, pubkey ${hub.key.pubkey} listening on:`, node.address);
  });

  hub.on('peer', function (peer) {
    console.log('[FABRIC:HUB]', `New peer connected: ${JSON.stringify(peer)}`);
  });

  hub.on('connections:close', function (peer) {
    console.log('[FABRIC:HUB]', `Peer closed connection: ${JSON.stringify(peer)}`);
  });

  await hub.start();
}

// Start & handle errors
main().catch((exception) => {
  console.error('[FABRIC:HUB]', 'Main process threw Exception:', exception);
});
