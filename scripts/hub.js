'use strict';

require('../functions/patchLinkedFabricNodePath');

let loadFabricHomeEnv;
try {
  ({ loadFabricHomeEnv } = require('@fabric/core/functions/fabricHomeEnv'));
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') throw err;
}
if (typeof loadFabricHomeEnv === 'function') loadFabricHomeEnv();

try {
  require('../functions/hubManagedBinaries').applyManagedNodeBinariesToProcessEnv();
} catch (_) {}

/** Writable root for stores (Electron desktop sets FABRIC_HUB_USER_DATA to app.getPath('userData')). */
const userDataRoot = process.env.FABRIC_HUB_USER_DATA || process.cwd();

const { installHubDebugFileLog } = require('../functions/hubDebugFileLog');
const { spawnedBitcoindPid } = require('../functions/bitcoinManagedAttach');
const { resolveHubRuntimeSettings, keyBagHasAny, hubRootKeyFile, withPersistentHubKey } = require('../functions/hubRuntimeSettings');
const _hubDebugLog = installHubDebugFileLog({ userDataRoot });
if (_hubDebugLog.active && _hubDebugLog.filePath) {
  console.log(
    '[FABRIC:HUB] ERROR/WARN mirror →',
    _hubDebugLog.filePath,
    '(FABRIC_HUB_DEBUG_LOG=0 off, =all unfiltered; FABRIC_HUB_DEBUG_LOG_MAX_BYTES rotates, 0=unlimited)'
  );
}

// Settings: settings/local.js + first-time setup (STATE) + env, desktop paths, operator key.
let { settings } = resolveHubRuntimeSettings({ userDataRoot });

/** The desktop main process holds the OS keychain, so it reads (or creates) the sealed key. */
function requestRootKeyFromDesktop (timeoutMs = 30000) {
  const { HUB_ROOT_KEY_REQUEST, HUB_ROOT_KEY_RESULT } = require('../functions/hubRootKey');
  return new Promise((resolve, reject) => {
    const id = require('crypto').randomBytes(8).toString('hex');
    const done = () => {
      clearTimeout(timer);
      process.parentPort.removeListener('message', onMessage);
    };
    const onMessage = (event) => {
      const msg = event && event.data;
      if (!msg || msg.type !== HUB_ROOT_KEY_RESULT || msg.id !== id) return;
      done();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('The desktop app did not provide the Hub key'));
    }, timeoutMs);
    process.parentPort.on('message', onMessage);
    process.parentPort.postMessage({ type: HUB_ROOT_KEY_REQUEST, id });
  });
}

/** Without an operator key, keep one Hub root key in the store instead of a new one per start. */
async function ensurePersistentHubKey () {
  if (keyBagHasAny(settings.key)) return;
  if (process.parentPort && process.env.FABRIC_HUB_USER_DATA) {
    const filePath = hubRootKeyFile(settings, userDataRoot);
    const result = await requestRootKeyFromDesktop();
    settings = { ...settings, key: { xprv: result.xprv } };
    console.log('[FABRIC:HUB] Hub key', result.created ? 'created in' : 'loaded from', filePath, result.sealed ? '(sealed with the OS keychain)' : '');
    return;
  }
  const result = withPersistentHubKey(settings, { userDataRoot });
  settings = result.settings;
  console.log('[FABRIC:HUB] Hub key', result.created ? 'created in' : 'loaded from', result.filePath, result.sealed ? '(sealed with the OS keychain)' : '');
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
    // Kill only a bitcoind this Hub spawned (not an attached orphan we reused).
    const bitcoindPid = spawnedBitcoindPid(activeHub);
    if (bitcoindPid) {
      try {
        process.kill(bitcoindPid, 'SIGKILL');
        console.log('[FABRIC:HUB]', 'Killed managed bitcoind PID:', bitcoindPid);
      } catch (e) {
        if (e.code !== 'ESRCH') console.warn('[FABRIC:HUB]', 'Could not kill managed bitcoind:', e.message || e);
      }
      if (activeHub) activeHub._bitcoindPid = null;
    }
    process.exit(exitCode);
  }
}

// Main process
async function main (input = {}) {
  let logSettings = input;
  try {
    const { redactHubSettingsForLog } = require('../functions/redactHubSettings');
    logSettings = redactHubSettingsForLog(input);
  } catch (_) {}
  console.log('[FABRIC:HUB]', 'Hub settings:', logSettings);
  const hub = new Hub(input);
  activeHub = hub;

  hub.on('error', (...error) => {
    console.error('[FABRIC:HUB]', 'Error:', ...error);
    void exitWithHubStop('hub:error', 1);
  });

  hub.on('ready', function (node) {
    console.log('[FABRIC:HUB]', `Hub is now started, pubkey ${hub.key.pubkey} listening on:`, node.address);
    if (process.parentPort) process.parentPort.postMessage({ type: 'ready' });
  });

  hub.on('log', function (...log) {
    console.log('[FABRIC:HUB]', `[LOG] ${log}`, ...log);
  });

  hub.on('peer', function (peer) {
    console.log('[FABRIC:HUB]', `New peer connected: ${JSON.stringify(peer)}`);
  });

  hub.on('chat', function (chat) {
    const obj = (chat && chat.object) || {};
    const text = obj.content || obj.body || '';
    const actor = (chat && chat.actor && chat.actor.id) || 'unknown';
    const ts = new Date(obj.created || Date.now());
    console.log('[FABRIC:CHAT]', `[${ts.toISOString()}]`, `[@${actor}]: ${text}`);
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

// Electron desktop runs this file as a utilityProcess; Windows has no SIGTERM, so it asks over parentPort.
if (process.parentPort) {
  process.parentPort.on('message', (event) => {
    const msg = event && event.data;
    if (msg && msg.type === 'shutdown') void exitWithHubStop('desktop shutdown', 0);
  });
}

process.on('exit', (code) => {
  if (code === 0) {
    console.log('[FABRIC:HUB]', 'Process exited cleanly.');
  } else {
    console.error('[FABRIC:HUB]', `Process exited with code ${code}.`);
  }
});

ensurePersistentHubKey().then(() => main(settings)).catch((exception) => {
  console.error('[FABRIC:HUB]', 'Main process threw Exception:', exception && exception.stack ? exception.stack : exception);
  logCrashReportHint('[FABRIC:HUB]');
  void exitWithHubStop('main exception', 1);
});
