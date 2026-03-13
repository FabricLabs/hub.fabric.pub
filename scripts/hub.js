'use strict';

// Settings
const settings = require('../settings/local');

// Services
const Hub = require('../services/hub');

// Process Management
let activeHub = null;
let exiting = false;

async function exitWithHubStop (reason = 'unknown', exitCode = 0) {
  if (exiting) return;
  exiting = true;
  console.log('[FABRIC:HUB]', `Received ${reason}, shutting down...`);

  try {
    if (activeHub && typeof activeHub.stop === 'function') {
      await activeHub.stop();
    }
  } catch (err) {
    console.error('[FABRIC:HUB]', 'Error during shutdown:', err && err.stack ? err.stack : err);
    exitCode = 1;
  } finally {
    // Ensure managed bitcoind is killed so it does not dangle (e.g. if stop() timed out or threw)
    if (activeHub && activeHub._bitcoindPid) {
      try {
        process.kill(activeHub._bitcoindPid, 'SIGKILL');
        console.log('[FABRIC:HUB]', 'Killed managed bitcoind PID:', activeHub._bitcoindPid);
      } catch (e) {
        if (e.code !== 'ESRCH') console.warn('[FABRIC:HUB]', 'Could not kill managed bitcoind:', e.message || e);
      }
      activeHub._bitcoindPid = null;
    }
    process.exit(exitCode);
  }
}

// Main process
async function main (input = {}) {
  console.log('[FABRIC:HUB]', 'Hub settings:', input);
  const hub = new Hub(input);
  activeHub = hub;

  hub.on('error', (...error) => {
    console.error('[FABRIC:HUB]', 'Error:', ...error);
    void exitWithHubStop('hub:error', 1);
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
    await exitWithHubStop('startup failure', 1);
  }

  return {
    id: hub.id
  };
}

// Start & handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FABRIC:HUB] Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
  void exitWithHubStop('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  console.error('[FABRIC:HUB] Uncaught Exception:', err && err.stack ? err.stack : err);
  void exitWithHubStop('uncaughtException', 1);
});

process.once('SIGINT', () => {
  void exitWithHubStop('SIGINT', 0);
});

process.once('SIGTERM', () => {
  void exitWithHubStop('SIGTERM', 0);
});

process.on('exit', (code) => {
  if (code === 0) {
    console.log('[FABRIC:HUB]', 'Process exited cleanly.');
  } else {
    console.error('[FABRIC:HUB]', `Process exited with code ${code}.`);
  }
});

main(settings).catch((exception) => {
  console.error('[FABRIC:HUB]', 'Main process threw Exception:', exception && exception.stack ? exception.stack : exception);
  void exitWithHubStop('main exception', 1);
});
