'use strict';

// Settings
const defaults = require('../settings/default');

// Services
const Hub = require('../services/hub');

// Configuration
const settings = {
  listen: true,
  port: process.env.FABRIC_PORT || defaults.port,
  seed: process.env.FABRIC_SEED || defaults.seed,
  peers: [
    'localhost:7779'
  ]
};

// Main process
async function main (input = {}) {
  const hub = new Hub(input);

  hub.on('error', (error) => {
    console.error('[FABRIC:HUB]', `Error: ${error}`);
  });

  hub.on('ready', function (node) {
    console.log('[FABRIC:HUB]', `Hub is now started, pubkey ${hub.key.pubkey} listening on:`, node.address);
  });

  hub.on('log', function (log) {
    console.log('[FABRIC:HUB]', `[LOG] ${JSON.stringify(log)}`);
  });

  hub.on('peer', function (peer) {
    console.log('[FABRIC:HUB]', `New peer connected: ${JSON.stringify(peer)}`);
  });

  hub.on('chat', function (chat) {
    const ts = new Date(chat.object.created);
    console.log('[FABRIC:CHAT]', `[${ts.toISOString()}]`, `[@${chat.actor.id}]: ${chat.object.content}`);
  });

  hub.on('connections:open', function (peer) {
    console.log('[FABRIC:HUB]', `Peer opened connection: ${JSON.stringify(peer)}`);
  });

  hub.on('connections:close', function (peer) {
    console.log('[FABRIC:HUB]', `Peer closed connection: ${JSON.stringify(peer)}`);
  });

  await hub.start();

  return {
    id: hub.id
  };
}

// Start & handle errors
main(settings).catch((exception) => {
  console.error('[FABRIC:HUB]', 'Main process threw Exception:', exception);
});
