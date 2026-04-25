'use strict';

const fs = require('fs');
const path = require('path');

require('../functions/patchLinkedFabricNodePath');

// Settings
let settings = require('../settings/local');

// Default RPC port per Bitcoin network (bitcoind standard ports)
const defaultBitcoinRpcPort = (network) => {
  const n = String(network || 'mainnet').toLowerCase();
  if (n === 'regtest') return 18443;
  if (n === 'testnet') return 18332;
  if (n === 'signet') return 38332;
  return 8332;
};

/** Writable root for stores (Electron desktop sets FABRIC_HUB_USER_DATA to app.getPath('userData')). */
const userDataRoot = process.env.FABRIC_HUB_USER_DATA || process.cwd();

const { installHubDebugFileLog } = require('../functions/hubDebugFileLog');
const { isHttpSharedModeEnabled } = require('../functions/httpSharedMode');
const _hubDebugLog = installHubDebugFileLog({ userDataRoot });
if (_hubDebugLog.active && _hubDebugLog.filePath) {
  console.log(
    '[FABRIC:HUB] ERROR/WARN mirror →',
    _hubDebugLog.filePath,
    '(FABRIC_HUB_DEBUG_LOG=0 off, =all unfiltered; FABRIC_HUB_DEBUG_LOG_MAX_BYTES rotates, 0=unlimited)'
  );
}

function bitcoinDataDirForNetwork (root, network) {
  const n = String(network || 'regtest').toLowerCase();
  const rel = {
    mainnet: path.join('stores', 'bitcoin'),
    testnet: path.join('stores', 'bitcoin-testnet'),
    testnet4: path.join('stores', 'bitcoin-testnet4'),
    signet: path.join('stores', 'bitcoin-signet'),
    regtest: path.join('stores', 'bitcoin-regtest'),
    playnet: path.join('stores', 'bitcoin-playnet')
  }[n] || path.join('stores', 'bitcoin-regtest');
  return path.join(root, rel);
}

// Merge setup settings from internal Hub STATE store (`settings`).
const statePath = path.join(userDataRoot, 'stores', 'hub', 'STATE');
let setup = {};
try {
  if (fs.existsSync(statePath)) {
    const rawState = fs.readFileSync(statePath, 'utf8');
    const parsedState = JSON.parse(rawState);
    const candidate = parsedState && typeof parsedState === 'object' ? parsedState.settings : null;
    if (candidate && typeof candidate === 'object') {
      setup = candidate;
    }
  }
} catch (e) {
  setup = {};
}
try {
  if (setup && typeof setup === 'object' && Object.keys(setup).length) {
    const parseVal = (v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'string') {
        if (v === 'true') return true;
        if (v === 'false') return false;
        const n = Number(v);
        if (!isNaN(n) && String(n) === v) return n;
        return v;
      }
      return v;
    };
    if (setup.BITCOIN_NETWORK) {
      settings = { ...settings, bitcoin: { ...settings.bitcoin, network: parseVal(setup.BITCOIN_NETWORK) || setup.BITCOIN_NETWORK } };
    }
    if (setup.BITCOIN_MANAGED !== undefined) {
      const managed = parseVal(setup.BITCOIN_MANAGED);
      settings = { ...settings, bitcoin: { ...settings.bitcoin, managed: managed !== false } };
      if (managed === false) {
        const network = setup.BITCOIN_NETWORK || settings.bitcoin?.network || 'mainnet';
        const rpcPort = parseVal(setup.BITCOIN_RPC_PORT);
        settings = {
          ...settings,
          bitcoin: {
            ...settings.bitcoin,
            host: parseVal(setup.BITCOIN_HOST) || '127.0.0.1',
            rpcport: Number(rpcPort) || defaultBitcoinRpcPort(network),
            username: parseVal(setup.BITCOIN_USERNAME) || '',
            password: parseVal(setup.BITCOIN_PASSWORD) || ''
          }
        };
      }
    }
    if (setup.LIGHTNING_MANAGED !== undefined || setup.LIGHTNING_SOCKET) {
      settings = { ...settings, lightning: settings.lightning || {} };
      if (setup.LIGHTNING_MANAGED !== undefined) {
        settings.lightning.managed = parseVal(setup.LIGHTNING_MANAGED) !== false;
      }
      if (parseVal(setup.LIGHTNING_MANAGED) === false && setup.LIGHTNING_SOCKET) {
        settings.lightning.socketPath = parseVal(setup.LIGHTNING_SOCKET) || setup.LIGHTNING_SOCKET;
      }
    }
    // LAN / shared HTTP: initial bind only when env does not override (runtime toggles use hub rebind).
    if (setup.HTTP_SHARED_MODE !== undefined && !process.env.FABRIC_HUB_INTERFACE && !process.env.INTERFACE) {
      const shared = parseVal(setup.HTTP_SHARED_MODE);
      const bindAll = isHttpSharedModeEnabled(shared);
      settings = {
        ...settings,
        http: {
          ...(settings.http || {}),
          interface: bindAll ? '0.0.0.0' : '127.0.0.1'
        }
      };
    }
  }
} catch (e) {
  // Ignore; use defaults from local.js
}

// Explicit Bitcoin env wins over first-time setup (e.g. `npm run start:mainnet-local` while settings still says regtest).
if (process.env.FABRIC_BITCOIN_NETWORK && String(process.env.FABRIC_BITCOIN_NETWORK).trim()) {
  settings = {
    ...settings,
    bitcoin: {
      ...settings.bitcoin,
      network: String(process.env.FABRIC_BITCOIN_NETWORK).trim()
    }
  };
}
if (Object.prototype.hasOwnProperty.call(process.env, 'FABRIC_BITCOIN_MANAGED') && String(process.env.FABRIC_BITCOIN_MANAGED).trim() !== '') {
  const v = String(process.env.FABRIC_BITCOIN_MANAGED).toLowerCase();
  const managed = v !== 'false' && v !== '0';
  settings = {
    ...settings,
    bitcoin: {
      ...settings.bitcoin,
      managed
    }
  };
}

// Desktop (Electron): default HTTP to loopback unless operator set HTTP_SHARED_MODE in settings.
// Without this, settings/local.js default interface would be 0.0.0.0. CLI/dev without FABRIC_HUB_USER_DATA keeps LAN-open default.
if (process.env.FABRIC_HUB_USER_DATA && !process.env.FABRIC_HUB_INTERFACE && !process.env.INTERFACE) {
  const sharedDefined = setup && Object.prototype.hasOwnProperty.call(setup, 'HTTP_SHARED_MODE');
  if (!sharedDefined) {
    settings = {
      ...settings,
      http: { ...(settings.http || {}), interface: '127.0.0.1' }
    };
  }
}

// Electron / packaged desktop: writable stores + absolute bitcoind datadir under userData
if (process.env.FABRIC_HUB_USER_DATA) {
  const u = process.env.FABRIC_HUB_USER_DATA;
  const net = (settings.bitcoin && settings.bitcoin.network) || 'regtest';
  const hubStore = path.join(u, 'stores', 'hub');
  settings = {
    ...settings,
    path: hubStore,
    fs: { ...settings.fs, path: hubStore },
    peersDb: process.env.FABRIC_HUB_PEERS_DB || path.join(hubStore, 'peers'),
    bitcoin: {
      ...settings.bitcoin,
      datadir: bitcoinDataDirForNetwork(u, net)
    },
    lightning: {
      ...(settings.lightning || {}),
      datadir: path.join(u, 'stores', 'lightning', 'hub')
    }
  };
}

// Services
const Hub = require('../services/hub');
const { logCrashReportHint } = require('../functions/fabricReportHint');

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
    logCrashReportHint('[FABRIC:HUB]');
    await exitWithHubStop('startup failure', 1);
  }

  return {
    id: hub.id
  };
}

// Start & handle errors
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason && (reason.message != null ? String(reason.message) : String(reason));
  // Managed Lightning can stall (no clightning, slow RPC); @fabric/core rejects with timeout — do not take down Bitcoin/HTTP.
  if (typeof msg === 'string' && /Lightning RPC timeout/i.test(msg)) {
    console.warn('[FABRIC:HUB] Transient Lightning RPC timeout (Hub continues):', msg);
    return;
  }
  console.error('[FABRIC:HUB] Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
  logCrashReportHint('[FABRIC:HUB]');
  void exitWithHubStop('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  console.error('[FABRIC:HUB] Uncaught Exception:', err && err.stack ? err.stack : err);
  logCrashReportHint('[FABRIC:HUB]');
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
  logCrashReportHint('[FABRIC:HUB]');
  void exitWithHubStop('main exception', 1);
});
