'use strict';

/**
 * Ops helper: confirm the Hub process is on a core tip that exposes
 * Peer#countNoiseHandshakeListeners (handshake-bus cut). Prefer live
 * `[HUB:HEAP]` lines after redeploy — this script only probes the installed
 * `@fabric/core` module graph so a bad pin fails before restart.
 *
 * Usage: `npm run verify:noise-handshake`
 */

const path = require('path');

function main () {
  let Peer;
  try {
    Peer = require('@fabric/core/types/peer');
  } catch (exception) {
    console.error('[verify:noise-handshake] cannot load @fabric/core/types/peer:', exception.message);
    process.exit(2);
  }

  if (typeof Peer.prototype.countNoiseHandshakeListeners !== 'function') {
    console.error(
      '[verify:noise-handshake] FAIL — Peer#countNoiseHandshakeListeners missing. ' +
      'Bump @fabric/core past the noiseProtocolStream tip and redeploy.'
    );
    process.exit(1);
  }

  let noise;
  try {
    noise = require('@fabric/core/functions/noiseProtocolStream');
  } catch (exception) {
    console.error('[verify:noise-handshake] FAIL — noiseProtocolStream missing:', exception.message);
    process.exit(1);
  }

  if (typeof noise.countHandshakeListeners !== 'function') {
    console.error('[verify:noise-handshake] FAIL — countHandshakeListeners export missing');
    process.exit(1);
  }

  console.log('[verify:noise-handshake] OK — handshake-bus core pin detected');
  try {
    const peerPath = require.resolve('@fabric/core/types/peer');
    console.log('  peer module:', peerPath);
  } catch (_) {
    /* ignore path display */
  }
  console.log('  After redeploy, watch [HUB:HEAP] retainers.noiseHandshakeListeners (must be non-null).');
  process.exit(0);
}

main();
