'use strict';

/**
 * Ensures the Hub HTTP port (default 8080) is available for @fabric/hub, not the @fabric/http
 * `sample-hub-http-server`. Uses `@fabric/http/constants` + `isSampleHubHttpServerOptions` from `@fabric/http/sampleHubOptions`.
 *
 * 1) OPTIONS the port. If the listener is the sample, SIGTERM only PIDs whose command line
 *    references `sample-hub-http-server.js` (macOS / Linux: `lsof` + `ps`).
 * 2) Brief wait and re-probe. If the sample is still there, exit 1. If a real Hub or nothing, OK.
 *
 * Set `FABRIC_HUB_NO_KILL_SAMPLE=1` to only warn (used if you run the sample on 8080 on purpose).
 */
const http = require('http');
const { execSync } = require('child_process');
const { SAMPLE_HUB_HTTP_SERVER_NAME } = require('@fabric/http/constants');
const { isSampleHubHttpServerOptions } = require('@fabric/http/sampleHubOptions');

const port = Number(
  process.env.FABRIC_HUB_CHECK_PORT != null
    ? process.env.FABRIC_HUB_CHECK_PORT
    : (process.env.FABRIC_HUB_PORT || process.env.PORT || 8080)
);
const host = '127.0.0.1';
const noKill = process.env.FABRIC_HUB_NO_KILL_SAMPLE === '1'
  || String(process.env.FABRIC_HUB_NO_KILL_SAMPLE || '').toLowerCase() === 'true';

function get (path, method, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: host, port, path, method, headers: headers || {}, timeout: 2500 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch (_) {}
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function optionsJson () {
  return get('/', 'OPTIONS', { Accept: 'application/json' }).then((r) => {
    try {
      return r.body ? JSON.parse(r.body) : null;
    } catch (_) {
      return null;
    }
  });
}

function pidsListeningOnPort (p) {
  try {
    const out = execSync(`lsof -nP -iTCP:${p} -sTCP:LISTEN -t`, { encoding: 'utf8' });
    return out.trim().split(/\n/).map((s) => s.trim()).filter(Boolean).map((s) => Number(s));
  } catch (_) {
    return [];
  }
}

function commandLineForPid (pid) {
  try {
    return execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim();
  } catch (_) {
    return '';
  }
}

function killSampleProcesses (p) {
  const pids = pidsListeningOnPort(p);
  let killed = 0;
  for (const pid of pids) {
    if (!Number.isFinite(pid) || pid < 1) continue;
    const args = commandLineForPid(pid);
    if (args.includes('sample-hub-http-server.js')) {
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        // eslint-disable-next-line no-console
        console.error(`[hub] Sent SIGTERM to sample process pid ${pid} (sample-hub-http-server).`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[hub] Could not kill pid ${pid}:`, e && e.message ? e.message : e);
      }
    }
  }
  return killed;
}

function fail (msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

async function main () {
  let j = null;
  try {
    j = await optionsJson();
  } catch (e) {
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH')) {
      return;
    }
    return;
  }

  if (!isSampleHubHttpServerOptions(j)) {
    if (j && String(j.name || '') === 'hub.fabric.pub') {
      // Real Hub already on port — ok for prestart; desktop will use external
    }
    return;
  }

  if (noKill) {
    fail(
      [
        '',
        `[hub] Port ${port} is the @fabric/http sample (${SAMPLE_HUB_HTTP_SERVER_NAME}), not @fabric/hub.`,
        '[hub] Stop it, set FABRIC_HUB_NO_KILL_SAMPLE=0, or use PORT=8099 for `npm run sample:hub` in fabric-http.',
        `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        ''
      ].join('\n')
    );
  }

  // eslint-disable-next-line no-console
  console.error(`[hub] Port ${port} is the @fabric/http sample; stopping sample so @fabric/hub can bind…`);
  const killed = killSampleProcesses(port);
  if (killed === 0) {
    fail(
      [
        '',
        `[hub] Could not find a sample-hub-http-server process to stop on port ${port}.`,
        'Stop the process using this port or set FABRIC_HUB_PORT to a free port.',
        `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        ''
      ].join('\n')
    );
  }

  await new Promise((r) => setTimeout(r, 400));
  let j2 = null;
  try {
    j2 = await optionsJson();
  } catch (_) {
    return;
  }
  if (isSampleHubHttpServerOptions(j2)) {
    fail(
      [
        '',
        `[hub] Sample is still on port ${port} after SIGTERM. Stop it manually or change ports.`,
        ''
      ].join('\n')
    );
  }
}

main();
