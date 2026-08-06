'use strict';

/**
 * Start one Hub with settings merged over `settings/local.js`.
 * Used by `playnet-regtest-mesh-launch.js` for multi-process local meshes.
 *
 *   FABRIC_BITCOIN_SKIP_PLAYNET_PEER=1 node scripts/playnet-hub-with-settings.js path/to/fragment.json
 */

const fs = require('fs');
const path = require('path');
const { hubSettingsMerge } = require('../functions/hubSettingsMerge');

const fragmentPath = path.resolve(process.argv[2] || '');
if (!fragmentPath || !fs.existsSync(fragmentPath)) {
  console.error('Usage: node scripts/playnet-hub-with-settings.js <settings-fragment.json>');
  process.exit(1);
}

if (!process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER) {
  process.env.FABRIC_BITCOIN_SKIP_PLAYNET_PEER = '1';
}

const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
const base = require('../settings/local');
const Hub = require('../services/hub');
const { logCrashReportHint } = require('../functions/fabricReportHint');

let activeHub = null;

async function shutdown (code = 0) {
  try {
    if (activeHub && typeof activeHub.stop === 'function') {
      await activeHub.stop();
    }
  } catch (_) {}
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

(async () => {
  const hub = new Hub(hubSettingsMerge(base, fragment));
  activeHub = hub;
  hub.on('error', (err) => {
    console.error('[playnet-hub-with-settings]', err && err.message ? err.message : err);
  });
  await hub.start();
  console.log('[playnet-hub-with-settings] Hub started; Ctrl+C to stop.');
})().catch((e) => {
  console.error('[playnet-hub-with-settings]', e && e.stack ? e.stack : e);
  logCrashReportHint('[playnet-hub-with-settings]');
  process.exit(1);
});
