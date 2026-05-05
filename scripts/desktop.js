'use strict';

const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');
const electron = require('electron');
if (!electron.ipcMain) {
  console.error('[DESKTOP] Run the Electron main process with the Electron binary, e.g. ./node_modules/.bin/electron scripts/desktop.js (not `node scripts/desktop.js` or a mis-resolved `npx electron`).');
  process.exit(1);
}
const { app, BrowserWindow, shell, ipcMain, dialog } = electron;

const settings = require('../settings/local');
const { fabricMessageSummaryFromHex, parseOpaqueFabricMessageHex } = require('../functions/fabricProtocolUrl');
const { hubPaymentsPathFromBitcoinUri } = require('../functions/bitcoinProtocolUrl');
const { runDesktopHubStartupProbe, isFabricHubSettingsListPayload } = require('./desktopHubProbe');
const HUB_PORT = Number(
  (settings.http && settings.http.port) ||
  process.env.FABRIC_HUB_PORT ||
  process.env.PORT ||
  8080
);
const FABRIC_P2P_PORT = Number(process.env.FABRIC_PORT || process.env.FABRIC_P2P_PORT || 7777);

/** Custom schemes re-registered on launch + activate (packaged app also declares them in electron-builder). */
const FABRIC_PROTOCOL = 'fabric';
const BITCOIN_PROTOCOL = 'bitcoin';

let mainWindow = null;
let hubProcess = null;
/** When true, loopback already runs Hub HTTP; do not spawn or kill `scripts/hub.js`. */
let usesExternalHub = false;

/** Queued until renderer pulls via IPC (covers subscribe race before React mount). */
let pendingLoginPromptPayload = null;

ipcMain.handle('fabric:get-pending-login-prompt', () => {
  const p = pendingLoginPromptPayload;
  pendingLoginPromptPayload = null;
  return p;
});

/**
 * BIP78 payjoin POST from main process (avoids browser CORS on third-party `pj=` URLs).
 * Body is PSBT base64 as plain text per BIP78.
 */
function nodePayjoinPost (urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(String(urlStr));
    } catch (_) {
      reject(new Error('Invalid payjoin URL'));
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      reject(new Error('Payjoin URL must be http or https'));
      return;
    }
    const body = Buffer.from(String(bodyStr != null ? bodyStr : ''), 'utf8');
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': body.length
      }
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const code = res.statusCode || 0;
        if (code < 200 || code >= 300) {
          reject(new Error(`Payjoin endpoint returned ${code}: ${text.slice(0, 400)}`));
          return;
        }
        resolve(String(text || '').trim());
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('fabric:payjoin-post', async (_event, payload) => {
  const url = payload && typeof payload.url === 'string' ? payload.url : '';
  const body = payload && payload.body != null ? String(payload.body) : '';
  if (!String(url).trim()) throw new Error('payjoin URL required');
  return nodePayjoinPost(url, body);
});

function deliverLoginPromptPayload (payload) {
  pendingLoginPromptPayload = payload;
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!w || !w.webContents) return;
  const send = () => {
    try {
      w.webContents.send('fabric-login-prompt', payload);
      w.focus();
    } catch (_) {}
  };
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', () => setTimeout(send, 300));
  } else {
    setTimeout(send, 300);
  }
}

/** macOS may emit open-url before ready; queue until Hub can accept POST /sessions/:id/signatures. */
let pendingFabricUrl = null;
/** Queued `bitcoin:` links until the main window exists (same pattern as fabric). */
let pendingBitcoinUrl = null;

let delegationPollTimer = null;
const delegationInFlight = new Set();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Blank-window workaround: some environments never emit `ready-to-show` when a subresource stalls.
if (process.env.FABRIC_DESKTOP_NO_GPU === '1' || String(process.env.FABRIC_DESKTOP_NO_GPU || '').toLowerCase() === 'true') {
  app.disableHardwareAcceleration();
}
app.on('second-instance', (_event, commandLine) => {
  const btc = commandLine.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${BITCOIN_PROTOCOL}:`));
  if (btc) {
    void handleBitcoinProtocolUrl(btc);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    return;
  }
  const prefix = `${FABRIC_PROTOCOL}:`;
  const url = commandLine.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  if (url) void handleFabricProtocolUrl(url);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
});

function hubUrl () {
  return `http://127.0.0.1:${HUB_PORT}/`;
}

function hubBaseFromSettings () {
  return `http://127.0.0.1:${HUB_PORT}`;
}

function waitForHub (timeoutMs = 120000) {
  const start = Date.now();
  const settingsUrl = `${hubBaseFromSettings()}/settings`;
  return new Promise((resolve, reject) => {
    function ping () {
      const req = http.get(
        settingsUrl,
        {
          headers: {
            Accept: 'application/json'
          }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const statusOk = res.statusCode >= 200 && res.statusCode < 300;
            let json = null;
            if (body && !String(body).trim().startsWith('<')) {
              try {
                json = JSON.parse(body);
              } catch (_) {
                json = null;
              }
            }
            const looksLikeHub = statusOk && isFabricHubSettingsListPayload(json);
            if (looksLikeHub) {
              resolve();
              return;
            }
            if (Date.now() - start > timeoutMs) {
              const detail = !statusOk
                ? `HTTP ${res.statusCode || 0} on ${settingsUrl}`
                : 'GET /settings did not return this Hub’s expected JSON (wrong app on the port, or hub not up yet)';
              reject(
                new Error(
                  `Hub is not ready (${detail}). Check that port ${HUB_PORT} is the Fabric Hub from this tree ` +
                    '(not another server). Run `npm run build:browser` and ensure the embedded hub can bind, ' +
                    'or set FABRIC_DESKTOP_TRUST_LOOPBACK_HUB=1 only if you intentionally share the port with another Hub instance.'
                )
              );
              return;
            }
            setTimeout(ping, 400);
          });
        }
      );
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Hub HTTP did not become ready in time'));
          return;
        }
        setTimeout(ping, 400);
      });
    }
    ping();
  });
}

function isConnectionRefusedLoadError (err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  return msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('(-102)');
}

/**
 * Retry navigation to the Hub shell. Node's `waitForHub()` can observe GET /settings while the
 * embedded process is still racing to listen; Chromium sometimes reaches `loadURL` first and
 * fails with ERR_CONNECTION_REFUSED (-102).
 *
 * @param {import('electron').BrowserWindow} win
 */
async function loadHubUiWithRetries (win) {
  const url = hubUrl();
  const maxAttempts = 10;
  const gapMs = 400;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      lastErr = e;
      if (!isConnectionRefusedLoadError(e) || attempt === maxAttempts) {
        break;
      }
      console.warn(`[DESKTOP] loadURL connection refused; retry ${attempt}/${maxAttempts} after short wait…`);
      await new Promise((r) => setTimeout(r, gapMs));
      try {
        await waitForHub(25000);
      } catch (_) {
        /* Hub still waking up — next attempt */
      }
    }
  }
  if (lastErr) {
    console.error(
      '[DESKTOP] Could not load Hub UI after retries. If nothing listens on',
      HUB_PORT + ',',
      'run `npm start` in another terminal (same repo), or ensure `scripts/hub.js` did not exit',
      '(see stderr above). External hub: same port must serve this Hub’s GET /settings JSON.'
    );
  }
  throw lastErr || new Error('loadURL failed');
}

/**
 * Read-only app root (contains `assets/`, `scripts/hub.js`, `node_modules/`).
 * In dev, `electron scripts/desktop.js` makes `app.getAppPath()` point at `scripts/`, not the repo root — use `__dirname`.
 */
function getAppRoot () {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.join(__dirname, '..');
}

function getHubScriptPath () {
  return path.join(getAppRoot(), 'scripts', 'hub.js');
}

function spawnHub () {
  if (usesExternalHub) return;
  if (hubProcess) return;
  const appRoot = getAppRoot();
  const userData = app.getPath('userData');
  const hubScript = getHubScriptPath();

  const loopbackHubOrigin = `http://127.0.0.1:${HUB_PORT}`;
  hubProcess = spawn(process.execPath, [hubScript], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FABRIC_HUB_PORT: String(HUB_PORT),
      PORT: String(HUB_PORT),
      FABRIC_HUB_APP_ROOT: appRoot,
      FABRIC_HUB_USER_DATA: userData,
      // Do not set FABRIC_HUB_INTERFACE: hub reads HTTP_SHARED_MODE from settings (Admin) and binds 0.0.0.0 when shared.
      FABRIC_HUB_HOSTNAME: '127.0.0.1',
      /** Same-origin L1 HTTP explorer as the UI so `@fabric/core` Bitcoin can use Hub `/services/bitcoin` for block/tx fallbacks (playnet / desktop). */
      FABRIC_EXPLORER_URL: process.env.FABRIC_EXPLORER_URL != null && String(process.env.FABRIC_EXPLORER_URL).trim() !== ''
        ? process.env.FABRIC_EXPLORER_URL
        : loopbackHubOrigin
    },
    stdio: 'inherit'
  });

  hubProcess.on('exit', (code, signal) => {
    hubProcess = null;
    if (code !== 0 && code !== null) {
      console.error('[DESKTOP] Hub process exited with code', code, signal || '');
    }
  });
}

function killHub () {
  if (usesExternalHub) return;
  if (!hubProcess || !hubProcess.pid) return;
  try {
    hubProcess.kill('SIGTERM');
  } catch (e) {
    console.warn('[DESKTOP] Could not SIGTERM hub:', e && e.message ? e.message : e);
  }
  hubProcess = null;
}

/**
 * Canonical opaque link: **fabric:deadbeef…** (hex only, serialized {@link Message}).
 * Legacy: fabric://login?…, fabric://message?hex=…, fabric://login?…&messageHex=…
 */
async function handleFabricProtocolUrl (urlStr) {
  const opaqueHex = parseOpaqueFabricMessageHex(urlStr);
  if (opaqueHex) {
    const fm = fabricMessageSummaryFromHex(opaqueHex);
    if (fm.ok) {
      deliverLoginPromptPayload({
        kind: 'fabricMessage',
        sessionId: null,
        hubBase: hubBaseFromSettings(),
        fabricMessageHex: fm.hex,
        fabricMessageSummary: fm.summary,
        fabricMessageOnly: true
      });
      console.log('[DESKTOP] opaque fabric:<hex> delivered to renderer');
    } else {
      console.warn('[DESKTOP] opaque fabric: parse failed:', fm.error);
    }
    return;
  }

  let url;
  try {
    url = new URL(urlStr);
  } catch (e) {
    console.error('[DESKTOP] Invalid fabric URL:', urlStr);
    return;
  }
  if (url.protocol !== `${FABRIC_PROTOCOL}:`) return;

  const hubBase = (url.searchParams.get('hub') || hubBaseFromSettings()).replace(/\/$/, '');
  const hexParam = url.searchParams.get('hex') || url.searchParams.get('messageHex');
  let fabricMessageHex = null;
  let fabricMessageSummary = null;
  if (hexParam) {
    const fm = fabricMessageSummaryFromHex(hexParam);
    if (fm.ok) {
      fabricMessageHex = fm.hex;
      fabricMessageSummary = fm.summary;
      console.log('[DESKTOP] fabric URL hex → Fabric message', fm.summary.typeName, fm.summary.byteLength, 'bytes');
    } else {
      console.warn('[DESKTOP] fabric URL hex parse failed:', fm.error);
    }
  }

  const host = url.hostname;
  if (host === 'message' || host === 'msg') {
    if (!fabricMessageHex || !fabricMessageSummary) {
      console.warn('[DESKTOP] fabric://message requires valid hex= (serialized Fabric Message)');
      return;
    }
    deliverLoginPromptPayload({
      kind: 'fabricMessage',
      sessionId: null,
      hubBase,
      fabricMessageHex,
      fabricMessageSummary,
      fabricMessageOnly: true
    });
    console.log('[DESKTOP] fabric message-only prompt delivered (no login session)');
    return;
  }

  if (host !== 'login') {
    console.warn('[DESKTOP] Unknown fabric host (expected login or message):', host);
    return;
  }

  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    console.warn('[DESKTOP] fabric login missing sessionId');
    return;
  }

  try {
    await waitForHub();
  } catch (e) {
    console.error('[DESKTOP] Hub not ready for fabric login:', e && e.message ? e.message : e);
    return;
  }

  try {
    const hubOrigin = String(hubBase || '').replace(/\/$/, '');
    const infoRes = await fetch(`${hubOrigin}/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Accept: 'application/json',
        // Hub requires Origin/Referer to match session.origin when the TCP client is not loopback (e.g. hub bound on LAN).
        ...(hubOrigin ? { Origin: hubOrigin, Referer: `${hubOrigin}/` } : {})
      }
    });
    const info = await infoRes.json().catch(() => ({}));
    if (!infoRes.ok || !info || info.status !== 'pending') {
      console.error('[DESKTOP] login session not pending or GET failed:', infoRes.status, info);
      return;
    }
    const origin = typeof info.origin === 'string' ? info.origin : '';
    const message = typeof info.message === 'string' ? info.message : '';
    const nonce = typeof info.nonce === 'string' ? info.nonce : '';
    deliverLoginPromptPayload({
      kind: 'login',
      sessionId,
      hubBase,
      origin,
      message,
      nonce,
      fabricMessageHex,
      fabricMessageSummary
    });
    console.log('[DESKTOP] fabric login prompt delivered to renderer:', sessionId);
  } catch (e) {
    console.error('[DESKTOP] fabric login fetch error:', e && e.message ? e.message : e);
  }
}

function registerFabricProtocol () {
  try {
    let ok = false;
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const mainScript = path.resolve(process.argv[1]);
        ok = app.setAsDefaultProtocolClient(FABRIC_PROTOCOL, process.execPath, [mainScript]);
      } else {
        console.warn('[DESKTOP] Cannot register fabric: — missing argv[1] (main script)');
      }
    } else {
      ok = app.setAsDefaultProtocolClient(FABRIC_PROTOCOL);
    }
    if (!ok) {
      console.warn('[DESKTOP] setAsDefaultProtocolClient(fabric) returned false (handler may belong to another app until you reinstall or run as admin on some Windows setups)');
    }
  } catch (e) {
    console.warn('[DESKTOP] setAsDefaultProtocolClient:', e && e.message ? e.message : e);
  }
}

function registerBitcoinProtocol () {
  try {
    let ok = false;
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const mainScript = path.resolve(process.argv[1]);
        ok = app.setAsDefaultProtocolClient(BITCOIN_PROTOCOL, process.execPath, [mainScript]);
      } else {
        console.warn('[DESKTOP] Cannot register bitcoin: — missing argv[1] (main script)');
      }
    } else {
      ok = app.setAsDefaultProtocolClient(BITCOIN_PROTOCOL);
    }
    if (!ok) {
      console.warn('[DESKTOP] setAsDefaultProtocolClient(bitcoin) returned false (another wallet may own bitcoin:; pick Fabric Hub in OS “Default apps” if you want)');
    }
  } catch (e) {
    console.warn('[DESKTOP] setAsDefaultProtocolClient bitcoin:', e && e.message ? e.message : e);
  }
}

/**
 * BIP21 payment links → Payments / Make Payment (prefill address or full URI for Payjoin `pj=`).
 */
async function handleBitcoinProtocolUrl (urlStr) {
  const parsed = hubPaymentsPathFromBitcoinUri(urlStr);
  if (!parsed) {
    console.warn('[DESKTOP] Ignoring invalid or unsupported bitcoin: URL:', String(urlStr || '').slice(0, 160));
    return;
  }
  try {
    await waitForHub();
  } catch (e) {
    console.error('[DESKTOP] Hub not ready for bitcoin: link:', e && e.message ? e.message : e);
    return;
  }
  const target = `${hubBaseFromSettings()}${parsed.relativePath}`;
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!w || !w.webContents) {
    pendingBitcoinUrl = urlStr;
    return;
  }
  try {
    await w.loadURL(target);
    w.focus();
    console.log('[DESKTOP] Opened Payments from bitcoin: URI');
  } catch (e) {
    console.error('[DESKTOP] loadURL failed for bitcoin URI:', e && e.message ? e.message : e);
  }
}

function drainArgvFabricUrl () {
  const arg = process.argv.find((a) => typeof a === 'string' && a.startsWith('fabric:'));
  if (arg) void handleFabricProtocolUrl(arg);
}

function drainArgvBitcoinUrl () {
  const arg = process.argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith('bitcoin:'));
  if (arg) void handleBitcoinProtocolUrl(arg);
}

async function createWindow () {
  const forceInternal = process.env.FABRIC_DESKTOP_ALWAYS_SPAWN_HUB === '1'
    || String(process.env.FABRIC_DESKTOP_ALWAYS_SPAWN_HUB || '').toLowerCase() === 'true';
  let probeSummary = { useExternalHub: false, reason: 'forced_internal' };
  if (!forceInternal) {
    try {
      probeSummary = await runDesktopHubStartupProbe({
        httpPort: HUB_PORT,
        p2pHost: process.env.FABRIC_DESKTOP_P2P_PROBE_HOST || '127.0.0.1',
        p2pPort: FABRIC_P2P_PORT
      });
    } catch (e) {
      console.warn('[DESKTOP] Hub startup probe failed; will spawn embedded hub:', e && e.message ? e.message : e);
    }
  }
  usesExternalHub = !!probeSummary.useExternalHub;
  if (usesExternalHub) {
    console.log('[DESKTOP] Using existing loopback Hub (embedded hub not started):', probeSummary.reason);
  }
  spawnHub();
  await waitForHub();

  const preload = path.join(__dirname, 'desktop-preload.js');
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    title: 'Fabric Hub',
    // Show immediately: waiting only on `ready-to-show` can leave a forever-hidden window if a asset hangs.
    show: true,
    backgroundColor: '#f7f7f7',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[DESKTOP] did-fail-load', code, desc, url || '');
    if (process.env.FABRIC_DESKTOP_DEVTOOLS === '1' || String(process.env.FABRIC_DESKTOP_DEVTOOLS || '').toLowerCase() === 'true') {
      try {
        win.webContents.openDevTools({ mode: 'detach' });
      } catch (_) {}
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await loadHubUiWithRetries(win);
  if (process.env.FABRIC_DESKTOP_DEVTOOLS === '1' || String(process.env.FABRIC_DESKTOP_DEVTOOLS || '').toLowerCase() === 'true') {
    try {
      win.webContents.openDevTools({ mode: 'detach' });
    } catch (_) {}
  }
  mainWindow = win;

  win.on('closed', () => {
    mainWindow = null;
  });
}


function startDelegationSignPoll () {
  if (delegationPollTimer) return;
  delegationPollTimer = setInterval(() => {
    void (async () => {
      try {
        await waitForHub();
        const base = hubBaseFromSettings();
        const res = await fetch(`${base}/sessions`, { headers: { Accept: 'application/json' } });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok || !Array.isArray(j.sessions)) return;
        const pendingItems = [];
        for (const s of j.sessions) {
          const sid = s && s.tokenId ? String(s.tokenId) : '';
          const arr = s && Array.isArray(s.pendingDelegationMessages) ? s.pendingDelegationMessages : [];
          for (const p of arr) {
            if (p && p.messageId && sid) pendingItems.push({ sessionId: sid, ...p });
          }
        }
        if (pendingItems.length === 0) return;
        for (const p of pendingItems) {
          if (!p || !p.messageId || delegationInFlight.has(p.messageId)) continue;
          delegationInFlight.add(p.messageId);
          try {
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            const { response } = await dialog.showMessageBox(win || undefined, {
              type: 'question',
              buttons: ['Approve', 'Reject'],
              defaultId: 0,
              cancelId: 1,
              title: 'Fabric Hub — delegation signature',
              message: String(p.preview || '(empty message)').slice(0, 800),
              detail: `Purpose: ${p.purpose || 'sign'}\nOrigin: ${p.origin || ''}`
            });
            const approve = response === 0;
            const r2 = await fetch(`${base}/services/rpc`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'ResolveDelegationSignatureMessage',
                params: [{
                  sessionId: p.sessionId,
                  messageId: p.messageId,
                  status: approve ? 'approved' : 'rejected'
                }]
              })
            });
            const j2 = await r2.json().catch(() => ({}));
            const ok = r2.ok && j2 && !j2.error && j2.jsonrpc === '2.0' && j2.result && j2.result.ok;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('fabric-delegation-resolved', { messageId: p.messageId, ok });
            }
          } catch (e) {
            console.error('[DESKTOP] delegation sign dialog:', e && e.message ? e.message : e);
          } finally {
            delegationInFlight.delete(p.messageId);
          }
        }
      } catch (e) {
        console.error('[DESKTOP] delegation poll:', e && e.message ? e.message : e);
      }
    })();
  }, 2000);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (typeof url === 'string' && url.toLowerCase().startsWith(`${BITCOIN_PROTOCOL}:`)) {
    pendingBitcoinUrl = url;
    if (app.isReady()) {
      void handleBitcoinProtocolUrl(url);
      pendingBitcoinUrl = null;
    }
    return;
  }
  pendingFabricUrl = url;
  if (app.isReady()) {
    void handleFabricProtocolUrl(url);
    pendingFabricUrl = null;
  }
});

app.whenReady().then(async () => {
  registerFabricProtocol();
  registerBitcoinProtocol();
  try {
    await createWindow();
  } catch (err) {
    console.error('[DESKTOP] Failed to start:', err && err.stack ? err.stack : err);
    app.quit();
    return;
  }
  drainArgvFabricUrl();
  drainArgvBitcoinUrl();
  if (pendingFabricUrl) {
    void handleFabricProtocolUrl(pendingFabricUrl);
    pendingFabricUrl = null;
  }
  if (pendingBitcoinUrl) {
    void handleBitcoinProtocolUrl(pendingBitcoinUrl);
    pendingBitcoinUrl = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    killHub();
    app.quit();
  }
});

app.on('before-quit', () => {
  killHub();
});

app.on('activate', () => {
  registerFabricProtocol();
  registerBitcoinProtocol();
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((err) => {
      console.error('[DESKTOP] activate failed:', err && err.message ? err.message : err);
    });
  }
});
