'use strict';

// Settings
const settings = require('../settings/local');

// Services
const Hub = require('../services/hub');

// Main process
async function main (input = {}) {
  console.log('[FABRIC:HUB]', 'Hub settings:', input);
  const hub = new Hub(input);

  hub.on('error', (...error) => {
    console.error('[FABRIC:HUB]', `Error: ${error}`, ...error);
    process.exit(1);
  });

  hub.on('ready', function (node) {
    console.log('[FABRIC:HUB]', `Hub is now started, pubkey ${hub.key.pubkey} listening on:`, node.address);
  });

  hub.on('log', function (...log) {
    console.log('[FABRIC:HUB]', `[LOG] ${log}`, ...log);
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

  try {
    await hub.start();
  } catch (err) {
    console.error('[FABRIC:HUB]', 'Failed to start hub:', err);
    process.exit(1);
  }

  return {
    id: hub.id
  };
}

// Start & handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FABRIC:HUB] Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[FABRIC:HUB] Uncaught Exception:', err && err.stack ? err.stack : err);
  process.exit(1);
});

main(settings).catch((exception) => {
  console.error('[FABRIC:HUB]', 'Main process threw Exception:', exception && exception.stack ? exception.stack : exception);
  process.exit(1);
});

process.on('exit', (code) => {
  if (code === 0) {
    console.log('[FABRIC:HUB]', 'Process exited cleanly.');
  } else {
    console.error('[FABRIC:HUB]', `Process exited with code ${code}.`);
  }
});
