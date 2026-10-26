'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const util = require('util');
const { URL } = require('url');
const electron = require('electron');
if (!electron.ipcMain) {
  console.error('[DESKTOP] Run the Electron main process with the Electron binary, e.g. ./node_modules/.bin/electron scripts/desktop.js (not `node scripts/desktop.js` or a mis-resolved `npx electron`).');
  process.exit(1);
}
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  utilityProcess
} = electron;

const settings = require('../settings/local');
const { fabricMessageSummaryFromHex, decodeOpaqueFabricUri } = require('../functions/fabricProtocolUrl');
const { hubPaymentsPathFromBitcoinUri } = require('../functions/bitcoinProtocolUrl');
const {
  APPROVAL_REQUEST: FABRIC_SIGN_REQUEST,
  APPROVAL_RESULT: FABRIC_SIGN_RESULT,
  fabricSignApprovalDialog
} = require('../functions/fabricSignApprovalDialog');
const { runDesktopHubStartupProbe, isFabricHubSettingsListPayload } = require('./desktopHubProbe');
const {
  argvRequestsHidden,
  desktopShellStatePath,
  electronLoginItemSettings,
  linuxAutostartPath,
  parseBoolEnv,
  readDesktopShellState,
  resolveOpenAtLogin,
  shouldStartHidden,
  syncLinuxAutostart,
  writeDesktopShellState
} = require('../functions/desktopOpenAtLogin');
const { configureDesktopUserData, hubStoreDir } = require('../functions/desktopUserData');
const { RotatingLogFile } = require('../functions/desktopLogFile');
const { createDesktopSecureStore } = require('../functions/desktopSecureStore');
const {
  HUB_ROOT_KEY_REQUEST,
  HUB_ROOT_KEY_RESULT,
  rootKeyPath,
  loadOrCreateHubRootKey
} = require('../functions/hubRootKey');
const {
  hubStatusLabel,
  restorableWindowBounds,
  trayStatusLines
} = require('../functions/desktopShellStatus');
const { reportIssuesUrl } = require('../functions/fabricReportHint');
const {
  checkPayjoinTarget,
  isPermissionAllowed,
  isPrivateAddress,
  isSafeExternalUrl,
  isTrustedIpcFrame,
  navigationAction
} = require('../functions/desktopShellPolicy');
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

const HUB_STOP_TIMEOUT_MS = 30000;
const HUB_RESTART_WINDOW_MS = 5 * 60 * 1000;
const HUB_MAX_RESTARTS = 5;
const HUB_STATUS_POLL_MS = 30000;
const MAIN_WINDOW_MIN = { width: 800, height: 600 };

let mainWindow = null;
let hubProcess = null;
/** Set while a graceful stop is in flight (so its exit is not treated as a crash). */
let hubStopPromise = null;
let hubRestartTimer = null;
let hubCrashTimes = [];
/** starting | running | restarting | stopping | stopped | external */
let hubStatus = 'starting';
/** Last loopback status bodies shown in the tray (aggregates only). */
let hubHealth = { peering: null, bitcoin: null, lightning: null };
let hubStatusPollTimer = null;
/** Notifications are kept referenced until closed so their click handlers survive GC. */
const liveNotifications = new Set();
let powerSaveBlockerId = null;
let restoreMaximizedOnShow = false;
let tray = null;
let isQuitting = false;
/** When true, loopback already runs Hub HTTP; do not spawn or kill `scripts/hub.js`. */
let usesExternalHub = false;

/** Queued until renderer pulls via IPC (covers subscribe race before React mount). */
let pendingMessagePromptPayload = null;

/** IPC is answered only for the Hub UI in the top-level frame, never for a page the window wandered to. */
function handleTrusted (channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcFrame(event.senderFrame, HUB_PORT)) {
      const from = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : 'unknown';
      console.warn('[DESKTOP] Refused IPC', channel, 'from', String(from).slice(0, 160));
      throw new Error('IPC is only available to the Fabric Hub UI');
    }
    return fn(event, ...args);
  });
}

handleTrusted('fabric:get-pending-message-prompt', () => {
  const p = pendingMessagePromptPayload;
  pendingMessagePromptPayload = null;
  return p;
});

handleTrusted('fabric:get-desktop-paths', () => {
  const userData = app.getPath('userData');
  return {
    userData: userData,
    hubStore: hubStoreDir(userData),
    usesExternalHub: !!usesExternalHub
  };
});

/**
 * OS-encrypted storage for UI secrets (Hub admin token). Linux without a keyring falls back to
 * Chromium's fixed-password `basic_text` backend, which is not real protection — report unavailable
 * there so the UI keeps its normal browser storage instead of pretending.
 */
function secureStorageAvailable () {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch (_) {
    return false;
  }
}

let desktopSecureStore = null;
function secureStore () {
  if (!secureStorageAvailable()) throw new Error('OS secure storage is not available');
  if (!desktopSecureStore) {
    desktopSecureStore = createDesktopSecureStore({
      filePath: path.join(app.getPath('userData'), 'secure-store.json'),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (buffer) => safeStorage.decryptString(buffer)
    });
  }
  return desktopSecureStore;
}

handleTrusted('fabric:secure-store-available', () => secureStorageAvailable());
handleTrusted('fabric:secure-store-get', (_event, key) => secureStore().get(key));
handleTrusted('fabric:secure-store-set', (_event, payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  secureStore().set(p.key, p.value);
  return true;
});
handleTrusted('fabric:secure-store-remove', (_event, key) => {
  secureStore().remove(key);
  return true;
});

const PAYJOIN_TIMEOUT_MS = 30000;
const PAYJOIN_MAX_REQUEST_BYTES = 1024 * 1024;
const PAYJOIN_MAX_RESPONSE_BYTES = 1024 * 1024;

/** `lookup` for http.request that refuses hostnames resolving to private addresses (no DNS rebinding to the LAN). */
function publicOnlyLookup (hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) {
      callback(err);
      return;
    }
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some((entry) => isPrivateAddress(entry && entry.address))) {
      callback(new Error(`Payjoin host ${hostname} resolves to a private address`));
      return;
    }
    callback(null, address, family);
  });
}

/**
 * BIP78 payjoin POST from main process (avoids browser CORS on third-party `pj=` URLs).
 * Body is PSBT base64 as plain text per BIP78.
 */
function nodePayjoinPost (urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    const target = checkPayjoinTarget(urlStr, {
      hubPort: HUB_PORT,
      allowPrivate: parseBoolEnv(process.env.FABRIC_DESKTOP_PAYJOIN_ALLOW_PRIVATE) === true
    });
    if (!target.ok) {
      reject(new Error(target.error));
      return;
    }
    const u = target.url;
    const body = Buffer.from(String(bodyStr != null ? bodyStr : ''), 'utf8');
    if (body.length > PAYJOIN_MAX_REQUEST_BYTES) {
      reject(new Error('Payjoin proposal is too large'));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      timeout: PAYJOIN_TIMEOUT_MS,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': body.length
      }
    };
    if (target.checkResolvedAddress) opts.lookup = publicOnlyLookup;
    const req = lib.request(opts, (res) => {
      const chunks = [];
      let received = 0;
      res.on('data', (c) => {
        received += c.length;
        if (received > PAYJOIN_MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Payjoin response is too large'));
          return;
        }
        chunks.push(c);
      });
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
    req.on('timeout', () => req.destroy(new Error('Payjoin endpoint timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

handleTrusted('fabric:payjoin-post', async (_event, payload) => {
  const url = payload && typeof payload.url === 'string' ? payload.url : '';
  const body = payload && payload.body != null ? String(payload.body) : '';
  if (!String(url).trim()) throw new Error('payjoin URL required');
  return nodePayjoinPost(url, body);
});

function deliverMessagePromptPayload (payload) {
  pendingMessagePromptPayload = payload;
  if (payload) notifyWhenAway('Fabric message', 'A Fabric message is waiting for your review.');
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!w || !w.webContents) return;
  const send = () => {
    try {
      showMainWindow();
      w.webContents.send('fabric-message-prompt', payload);
    } catch (_) {}
  };
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', () => setTimeout(send, 300));
  } else {
    setTimeout(send, 300);
  }
}

/** macOS may emit open-url before ready; queue until the window exists. */
let pendingFabricUrl = null;
/** Queued `bitcoin:` links until the main window exists (same pattern as fabric). */
let pendingBitcoinUrl = null;

/** Pin userData to "Fabric Hub" before the instance lock (unpackaged Electron otherwise uses the Electron profile). */
const desktopUserData = configureDesktopUserData(app);
console.log(
  '[DESKTOP] Hub data:',
  desktopUserData.userDataDir,
  'store:',
  desktopUserData.hubStoreDir,
  'source:',
  desktopUserData.source
);
if (desktopUserData.migratedFrom && desktopUserData.migrated && desktopUserData.migrated.copied) {
  console.log(
    '[DESKTOP] Migrated Hub files from unpackaged Electron profile:',
    desktopUserData.migratedFrom,
    '→',
    desktopUserData.userDataDir,
    desktopUserData.migrated.names.join(', ')
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

/** Main-process console and Hub child output, secrets scrubbed (packaged builds have no terminal). */
const desktopLogPath = path.join(app.getPath('userData'), 'logs', 'fabric-hub.log');
const desktopLog = new RotatingLogFile({ filePath: desktopLogPath });
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    desktopLog.write(`${new Date().toISOString()} ${util.format(...args)}\n`);
  };
}

// Blank-window workaround: some environments never emit `ready-to-show` when a subresource stalls.
if (process.env.FABRIC_DESKTOP_NO_GPU === '1' || String(process.env.FABRIC_DESKTOP_NO_GPU || '').toLowerCase() === 'true') {
  app.disableHardwareAcceleration();
}
app.on('second-instance', (_event, commandLine) => {
  const btc = commandLine.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${BITCOIN_PROTOCOL}:`));
  if (btc) {
    void handleBitcoinProtocolUrl(btc);
    if (app.isReady()) showMainWindow();
    return;
  }
  const prefix = `${FABRIC_PROTOCOL}:`;
  const url = commandLine.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  if (url) void handleFabricProtocolUrl(url);
  if (app.isReady()) showMainWindow();
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
          },
          timeout: 5000
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
      req.on('timeout', () => {
        req.destroy(new Error('Hub /settings request timed out'));
      });
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

function resolveAppIcon () {
  const root = getAppRoot();
  const candidates = [
    path.join(root, 'assets', 'icons', 'icon-512.png'),
    path.join(root, 'build', 'icon.png'),
    path.join(root, 'assets', 'favicon.ico')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file;
    } catch (_) {}
  }
  return undefined;
}

function resolveTrayImage () {
  const root = getAppRoot();
  const candidates = [
    path.join(root, 'assets', 'icons', 'icon-32.png'),
    path.join(root, 'assets', 'icons', 'icon-48.png'),
    path.join(root, 'assets', 'icons', 'icon-16.png'),
    path.join(root, 'build', 'icon.png'),
    path.join(root, 'assets', 'icons', 'icon.png')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const img = nativeImage.createFromPath(file);
        if (img && !img.isEmpty()) return img;
      }
    } catch (_) {}
  }
  return nativeImage.createEmpty();
}

function shellStatePath () {
  return desktopShellStatePath(app.getPath('userData'));
}

function persistedOpenAtLogin () {
  const state = readDesktopShellState(shellStatePath());
  return typeof state.openAtLogin === 'boolean' ? state.openAtLogin : undefined;
}

function openAtLoginEnabled () {
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    if (process.platform === 'linux') {
      try {
        return fs.existsSync(linuxAutostartPath(app.getPath('home')));
      } catch (_err) {
        return false;
      }
    }
    return false;
  }
}

function desiredOpenAtLogin () {
  return resolveOpenAtLogin({
    env: process.env,
    persisted: persistedOpenAtLogin(),
    settingsOpenAtLogin: settings.openAtLogin,
    isPackaged: !!app.isPackaged
  });
}

function applyOpenAtLogin (enabled) {
  const on = !!enabled;
  try {
    app.setLoginItemSettings(electronLoginItemSettings({
      openAtLogin: on,
      platform: process.platform,
      execPath: process.execPath
    }));
  } catch (error) {
    console.warn('[DESKTOP] Could not set login item:', error && error.message ? error.message : error);
  }
  if (process.platform === 'linux') {
    try {
      syncLinuxAutostart({
        enabled: on,
        homeDir: app.getPath('home'),
        execPath: process.execPath,
        iconPath: resolveAppIcon() || ''
      });
    } catch (error) {
      console.warn('[DESKTOP] Could not write Linux autostart:', error && error.message ? error.message : error);
    }
  }
  try {
    writeDesktopShellState(shellStatePath(), { openAtLogin: on });
  } catch (error) {
    console.warn('[DESKTOP] Could not persist Run at startup:', error && error.message ? error.message : error);
  }
  console.log('[DESKTOP] Run at startup:', on ? 'on' : 'off');
  rebuildTrayMenu();
}

function configureAutoLaunch () {
  const env = parseBoolEnv(process.env.FABRIC_OPEN_AT_LOGIN);
  const persisted = persistedOpenAtLogin();
  if (!app.isPackaged && env === null && typeof persisted !== 'boolean') {
    return;
  }
  applyOpenAtLogin(desiredOpenAtLogin());
}

function startHiddenRequested () {
  let login = {};
  try {
    login = app.getLoginItemSettings() || {};
  } catch (_) {
    login = {};
  }
  return shouldStartHidden({
    argv: process.argv,
    wasOpenedAtLogin: !!login.wasOpenedAtLogin
  }) || argvRequestsHidden(process.argv);
}

function showMainWindow () {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow({ show: true }).catch((err) => {
      console.error('[DESKTOP] show window failed:', err && err.message ? err.message : err);
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (restoreMaximizedOnShow) {
    restoreMaximizedOnShow = false;
    mainWindow.maximize();
  }
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin' && app.dock) app.dock.show();
}

function hideMainWindow () {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
}

function quitApp () {
  isQuitting = true;
  app.quit();
}

function revealDataFolder () {
  shell.openPath(app.getPath('userData')).then((err) => {
    if (err) console.warn('[DESKTOP] openPath userData failed:', err);
  });
}

function revealLogs () {
  shell.showItemInFolder(desktopLogPath);
}

function devtoolsEnabled () {
  return !app.isPackaged || parseBoolEnv(process.env.FABRIC_DESKTOP_DEVTOOLS) === true;
}

/** Keep-awake: env wins, then the tray choice. Off by default. */
function preventSleepWanted () {
  const env = parseBoolEnv(process.env.FABRIC_DESKTOP_PREVENT_SLEEP);
  if (env !== null) return env;
  return readDesktopShellState(shellStatePath()).preventSleep === true;
}

function applyPreventSleep () {
  const want = preventSleepWanted();
  if (want && powerSaveBlockerId == null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[DESKTOP] Keeping the computer awake while Fabric Hub runs');
  } else if (!want && powerSaveBlockerId != null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
    console.log('[DESKTOP] Allowing the computer to sleep');
  }
}

function setPreventSleep (on) {
  try {
    writeDesktopShellState(shellStatePath(), { preventSleep: !!on });
  } catch (error) {
    console.warn('[DESKTOP] Could not persist Keep computer awake:', error && error.message ? error.message : error);
  }
  applyPreventSleep();
  rebuildTrayMenu();
}

function setHubStatus (status) {
  if (hubStatus === status) return;
  hubStatus = status;
  console.log('[DESKTOP] Hub status:', hubStatusLabel(status));
  if (status === 'running' || status === 'external') {
    scheduleHubStatusPoll(1000);
  } else {
    hubHealth = { peering: null, bitcoin: null, lightning: null };
  }
  refreshTrayStatus();
}

function refreshTrayStatus () {
  const lines = trayStatusLines({ hubStatus, ...hubHealth });
  if (tray) {
    // Windows truncates tray tooltips at 127 characters.
    const tip = ['Fabric Hub', ...lines].join('\n');
    tray.setToolTip(process.platform === 'win32' ? tip.slice(0, 127) : tip);
  }
  rebuildTrayMenu(lines);
}

/** GET a loopback Hub JSON resource; null on any failure (the tray just shows less). */
function loopbackJson (pathname, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const req = http.get(`${hubBaseFromSettings()}${pathname}`, {
      headers: { Accept: 'application/json' },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 1024 * 1024) req.destroy();
        else chunks.push(c);
      });
      res.on('end', () => {
        try {
          resolve(res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
        } catch (_) {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function scheduleHubStatusPoll (delayMs) {
  if (hubStatusPollTimer) clearTimeout(hubStatusPollTimer);
  hubStatusPollTimer = setTimeout(() => {
    hubStatusPollTimer = null;
    void pollHubStatus();
  }, delayMs);
}

async function pollHubStatus () {
  if (hubStatus !== 'running' && hubStatus !== 'external') return;
  const [peering, bitcoin, lightning] = await Promise.all([
    loopbackJson('/services/peering'),
    loopbackJson('/services/bitcoin'),
    loopbackJson('/services/lightning')
  ]);
  if (hubStatus !== 'running' && hubStatus !== 'external') return;
  hubHealth = { peering, bitcoin, lightning };
  refreshTrayStatus();
  scheduleHubStatusPoll(HUB_STATUS_POLL_MS);
}

function mainWindowIsAway () {
  return !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused();
}

/** Native notification only when the user is not already looking at the Hub; click brings it up. */
function notifyWhenAway (title, body) {
  if (!mainWindowIsAway()) return;
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: resolveAppIcon() });
    liveNotifications.add(n);
    const release = () => liveNotifications.delete(n);
    n.on('click', () => {
      release();
      showMainWindow();
    });
    n.on('close', release);
    n.show();
  } catch (e) {
    console.warn('[DESKTOP] Notification failed:', e && e.message ? e.message : e);
  }
}

function restartHubFromMenu () {
  if (usesExternalHub) {
    void dialog.showMessageBox({
      type: 'info',
      message: 'This window is using a Hub that was already running.',
      detail: 'Restart that Hub where it was started.'
    });
    return;
  }
  hubCrashTimes = [];
  void restartHub();
}

function rebuildTrayMenu (statusLines) {
  if (!tray) return;
  const lines = statusLines || trayStatusLines({ hubStatus, ...hubHealth });
  const atLogin = (function () {
    const persisted = persistedOpenAtLogin();
    if (typeof persisted === 'boolean') return persisted;
    return openAtLoginEnabled();
  }());
  const menu = Menu.buildFromTemplate([
    ...lines.map((label) => ({ label, enabled: false })),
    { type: 'separator' },
    {
      label: 'Show Fabric Hub',
      click: () => showMainWindow()
    },
    {
      label: 'Restart Hub',
      enabled: hubStatus !== 'stopping' && hubStatus !== 'starting',
      click: () => restartHubFromMenu()
    },
    { type: 'separator' },
    {
      label: 'Run at startup',
      type: 'checkbox',
      checked: !!atLogin,
      click: (item) => applyOpenAtLogin(item.checked)
    },
    {
      label: 'Keep computer awake',
      type: 'checkbox',
      checked: preventSleepWanted(),
      enabled: parseBoolEnv(process.env.FABRIC_DESKTOP_PREVENT_SLEEP) === null,
      click: (item) => setPreventSleep(item.checked)
    },
    {
      label: 'Reveal Hub data folder',
      click: () => revealDataFolder()
    },
    {
      label: 'Reveal logs',
      click: () => revealLogs()
    },
    { type: 'separator' },
    {
      label: 'Quit Fabric Hub',
      click: () => quitApp()
    }
  ]);
  tray.setContextMenu(menu);
}

/** Reload / DevTools only in unpackaged runs or with FABRIC_DESKTOP_DEVTOOLS=1. */
function buildApplicationMenu () {
  const isMac = process.platform === 'darwin';
  app.setAboutPanelOptions({
    applicationName: 'Fabric Hub',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    website: 'https://hub.fabric.pub',
    ...(resolveAppIcon() ? { iconPath: resolveAppIcon() } : {})
  });
  const template = [];
  if (isMac) template.push({ role: 'appMenu' });
  template.push({
    label: 'File',
    submenu: [
      { label: 'Reveal Hub Data Folder', click: () => revealDataFolder() },
      { label: 'Reveal Logs', click: () => revealLogs() },
      { label: 'Restart Hub', click: () => restartHubFromMenu() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  });
  template.push({ role: 'editMenu' });
  template.push({
    label: 'View',
    submenu: [
      ...(devtoolsEnabled()
        ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
        : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  });
  template.push({ role: 'windowMenu' });
  template.push({
    role: 'help',
    submenu: [
      ...(isMac ? [] : [{ label: 'About Fabric Hub', click: () => app.showAboutPanel() }]),
      { label: 'Report an Issue…', click: () => openExternalIfSafe(reportIssuesUrl()) }
    ]
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray () {
  if (tray) return;
  const image = resolveTrayImage();
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  refreshTrayStatus();
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      hideMainWindow();
    } else {
      showMainWindow();
    }
  });
  tray.on('double-click', () => showMainWindow());
}

function getHubScriptPath () {
  return path.join(getAppRoot(), 'scripts', 'hub.js');
}

function bundledBinariesDir () {
  const id = `${process.platform}-${process.arch}`;
  if (app.isPackaged && process.resourcesPath) {
    return path.join(process.resourcesPath, 'binaries', id);
  }
  return path.join(getAppRoot(), 'binaries', id);
}

function pipeHubOutput (stream, sink) {
  if (!stream) return;
  stream.on('data', (chunk) => {
    try {
      sink.write(chunk);
    } catch (_) {}
    desktopLog.write(chunk);
  });
}

/**
 * The Hub runs as an Electron utilityProcess (a Node child without `ELECTRON_RUN_AS_NODE`),
 * so packaged builds can turn the RunAsNode fuse off.
 */
function spawnHub () {
  if (usesExternalHub) return;
  if (hubProcess) return;
  const appRoot = getAppRoot();
  const userData = app.getPath('userData');
  const hubScript = getHubScriptPath();
  console.log('[DESKTOP] Starting Hub with FABRIC_HUB_USER_DATA=', userData, 'store=', hubStoreDir(userData));

  const loopbackHubOrigin = `http://127.0.0.1:${HUB_PORT}`;
  const env = {
    ...process.env,
    FABRIC_HUB_PORT: String(HUB_PORT),
    PORT: String(HUB_PORT),
    FABRIC_HUB_APP_ROOT: appRoot,
    FABRIC_HUB_USER_DATA: userData,
    FABRIC_HUB_BINARIES: process.env.FABRIC_HUB_BINARIES || bundledBinariesDir(),
    // Do not set FABRIC_HUB_INTERFACE: hub reads HTTP_SHARED_MODE from settings (Admin) and binds 0.0.0.0 when shared.
    FABRIC_HUB_HOSTNAME: '127.0.0.1',
    /** Same-origin L1 HTTP explorer as the UI so `@fabric/core` Bitcoin can use Hub `/services/bitcoin` for block/tx fallbacks (playnet / desktop). */
    FABRIC_EXPLORER_URL: process.env.FABRIC_EXPLORER_URL != null && String(process.env.FABRIC_EXPLORER_URL).trim() !== ''
      ? process.env.FABRIC_EXPLORER_URL
      : loopbackHubOrigin
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = utilityProcess.fork(hubScript, [], {
    // Packaged, appRoot is the app.asar file; a utilityProcess with a file cwd exits 1 before running.
    cwd: app.isPackaged ? userData : appRoot,
    env,
    stdio: 'pipe',
    serviceName: 'Fabric Hub'
  });
  hubProcess = child;
  hubStopPromise = null;
  setHubStatus('starting');
  pipeHubOutput(child.stdout, process.stdout);
  pipeHubOutput(child.stderr, process.stderr);
  child.on('message', (msg) => {
    if (msg && msg.type === 'ready') setHubStatus('running');
    if (msg && msg.type === FABRIC_SIGN_REQUEST) void answerFabricSignRequest(child, msg);
    if (msg && msg.type === HUB_ROOT_KEY_REQUEST && child === hubProcess) answerHubRootKeyRequest(child, msg);
  });
  child.once('exit', (code) => onHubExit(child, code));
}

/** The Hub has no operator key: hand it the one kept (sealed with safeStorage) in its store. */
function answerHubRootKeyRequest (child, msg) {
  let reply;
  try {
    const sealing = secureStorageAvailable()
      ? { seal: (value) => safeStorage.encryptString(value), unseal: (buffer) => safeStorage.decryptString(buffer) }
      : {};
    const filePath = rootKeyPath(hubStoreDir(app.getPath('userData')));
    const result = loadOrCreateHubRootKey({ filePath, ...sealing });
    reply = { type: HUB_ROOT_KEY_RESULT, id: msg.id, xprv: result.xprv, created: result.created, sealed: result.sealed };
  } catch (err) {
    reply = { type: HUB_ROOT_KEY_RESULT, id: msg.id, error: err && err.message ? err.message : String(err) };
  }
  try {
    child.postMessage(reply);
  } catch (_) {}
}

/** Passport asked the Hub to sign in or link: only a native dialog here can approve it. */
async function answerFabricSignRequest (child, msg) {
  let approved = false;
  // Close the dialog when the request expires, so a late click can't approve it.
  const expiry = new AbortController();
  const ms = Math.max(0, Number(msg.expiresAt || 0) - Date.now());
  const timer = setTimeout(() => expiry.abort(), ms);
  try {
    const options = Object.assign(fabricSignApprovalDialog(msg), { signal: expiry.signal });
    notifyWhenAway(options.title, options.message);
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (parent) {
      if (!parent.isVisible()) parent.show();
      parent.focus();
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    approved = response === 0 && !expiry.signal.aborted;
  } catch (e) {
    console.warn('[DESKTOP] fabric sign approval failed:', e && e.message ? e.message : e);
  } finally {
    clearTimeout(timer);
  }
  try {
    child.postMessage({ type: FABRIC_SIGN_RESULT, id: msg.id, approved });
  } catch (_) {}
}

function onHubExit (child, code) {
  if (hubProcess === child) hubProcess = null;
  if (hubStopPromise || isQuitting) {
    setHubStatus('stopped');
    return;
  }
  console.error('[DESKTOP] Hub process exited unexpectedly with code', code);
  const now = Date.now();
  hubCrashTimes = hubCrashTimes.filter((t) => now - t < HUB_RESTART_WINDOW_MS);
  hubCrashTimes.push(now);
  if (hubCrashTimes.length > HUB_MAX_RESTARTS) {
    setHubStatus('stopped');
    void promptHubCrashed(code);
    return;
  }
  const delay = Math.min(30000, 1000 * Math.pow(2, hubCrashTimes.length - 1));
  setHubStatus('restarting');
  console.warn(`[DESKTOP] Restarting Hub in ${Math.round(delay / 1000)}s`);
  hubRestartTimer = setTimeout(() => {
    hubRestartTimer = null;
    void restartHub();
  }, delay);
}

async function restartHub () {
  if (usesExternalHub || isQuitting) return;
  if (hubProcess) await stopHub();
  spawnHub();
  try {
    await waitForHub();
    if (mainWindow && !mainWindow.isDestroyed()) await loadHubUiWithRetries(mainWindow);
  } catch (e) {
    console.error('[DESKTOP] Hub restart did not come up:', e && e.message ? e.message : e);
  }
}

async function promptHubCrashed (code) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Fabric Hub stopped',
    message: 'Fabric Hub stopped unexpectedly.',
    detail: `The node exited (code ${code}) ${hubCrashTimes.length} times in five minutes and was not restarted again. ` +
      `The log may say why:\n${desktopLogPath}`,
    buttons: ['Restart', 'Show log', 'Quit Fabric Hub'],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) {
    hubCrashTimes = [];
    void restartHub();
  } else if (response === 1) {
    shell.showItemInFolder(desktopLogPath);
  } else {
    quitApp();
  }
}

/**
 * Ask the Hub to shut down (it stops Bitcoin / Lightning / LevelDB cleanly), then kill it if it
 * has not exited within `timeoutMs`.
 * @returns {Promise<void>}
 */
function stopHub (timeoutMs = HUB_STOP_TIMEOUT_MS) {
  if (hubRestartTimer) {
    clearTimeout(hubRestartTimer);
    hubRestartTimer = null;
  }
  if (hubStopPromise) return hubStopPromise;
  const child = hubProcess;
  if (usesExternalHub || !child) return Promise.resolve();
  setHubStatus('stopping');
  hubStopPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[DESKTOP] Hub did not stop within ${timeoutMs}ms; killing it`);
      try {
        child.kill();
      } catch (_) {}
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.postMessage({ type: 'shutdown' });
    } catch (_) {
      child.kill();
    }
  });
  return hubStopPromise;
}

/**
 * Canonical opaque link: **fabric:<frame>** (base64url or hex, serialized {@link Message}),
 * checked by core `decodeFabricUri` (hash, type, author signature when signed), and
 * `fabric://message?hex=…`. Both are shown for review only; nothing here signs.
 * Sign-in is Passport (`/sessions`), never a `fabric://` link.
 */
async function handleFabricProtocolUrl (urlStr) {
  if (/^fabric:(?!\/\/)/i.test(String(urlStr || '').trim())) {
    const fm = decodeOpaqueFabricUri(urlStr);
    if (fm.ok) {
      deliverMessagePromptPayload({
        kind: 'fabricMessage',
        fabricMessageHex: fm.hex,
        fabricMessageSummary: Object.assign({}, fm.summary, {
          signed: fm.signed,
          author: fm.author,
          verified: fm.verified
        })
      });
      console.log('[DESKTOP] opaque fabric: message delivered to renderer');
    } else {
      console.warn('[DESKTOP] opaque fabric: rejected:', fm.error);
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

  const host = url.hostname;
  if (host === 'link') {
    console.warn('[DESKTOP] fabric://link is handled by the renderer / device-link UI; open Hub Identity to complete.');
    return;
  }
  if (host !== 'message' && host !== 'msg') {
    console.warn('[DESKTOP] Unknown fabric host (expected message):', host);
    return;
  }
  const fm = fabricMessageSummaryFromHex(url.searchParams.get('hex') || url.searchParams.get('messageHex') || '');
  if (!fm.ok) {
    console.warn('[DESKTOP] fabric://message requires valid hex= (serialized Fabric Message):', fm.error);
    return;
  }
  deliverMessagePromptPayload({
    kind: 'fabricMessage',
    fabricMessageHex: fm.hex,
    fabricMessageSummary: fm.summary
  });
  console.log('[DESKTOP] fabric message delivered to renderer');
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
    showMainWindow();
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

function openExternalIfSafe (url) {
  if (!isSafeExternalUrl(url)) {
    console.warn('[DESKTOP] Refused to open external URL with unsafe scheme:', String(url || '').slice(0, 160));
    return;
  }
  shell.openExternal(url).catch((e) => {
    console.warn('[DESKTOP] openExternal failed:', e && e.message ? e.message : e);
  });
}

/** The window shows only the Hub UI; other http(s) / mailto links open in the OS, the rest are dropped. */
function guardNavigation (event, url) {
  const action = navigationAction(url, HUB_PORT);
  if (action === 'allow') return;
  event.preventDefault();
  if (action === 'external') openExternalIfSafe(url);
  else console.warn('[DESKTOP] Blocked navigation to', String(url || '').slice(0, 160));
}

/** Static "starting" card while the Hub comes up (no preload, no JavaScript). */
function showLoadingWindow () {
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Fabric Hub</title><style>' +
    'html,body{margin:0;height:100%;background:#f7f7f7;color:#222;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-user-select:none;-webkit-app-region:drag}' +
    'body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}' +
    '.s{width:28px;height:28px;border:3px solid #ddd;border-top-color:#555;border-radius:50%;animation:r 1s linear infinite}' +
    '@keyframes r{to{transform:rotate(360deg)}}h1{font-size:16px;margin:6px 0 0}p{margin:0;color:#666;font-size:12px}' +
    '</style></head><body><div class="s"></div><h1>Loading Your Hub...</h1><p>Bitcoin, Fabric, and Lightning are coming up.</p></body></html>';
  const win = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Fabric Hub',
    icon: resolveAppIcon(),
    backgroundColor: '#f7f7f7',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      devTools: false
    }
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
  return win;
}

function savedWindowState () {
  const state = readDesktopShellState(shellStatePath());
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  return {
    bounds: restorableWindowBounds(state.windowBounds, workAreas, MAIN_WINDOW_MIN),
    maximized: state.windowMaximized === true
  };
}

function persistWindowState (win) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    writeDesktopShellState(shellStatePath(), {
      windowBounds: win.getNormalBounds(),
      windowMaximized: win.isMaximized()
    });
  } catch (error) {
    console.warn('[DESKTOP] Could not save window position:', error && error.message ? error.message : error);
  }
}

async function createWindow (opts) {
  const showWindow = !(opts && opts.show === false);
  const loading = showWindow && !(mainWindow && !mainWindow.isDestroyed()) ? showLoadingWindow() : null;
  try {
    await openMainWindow(showWindow);
  } finally {
    if (loading && !loading.isDestroyed()) loading.destroy();
  }
}

async function openMainWindow (showWindow) {
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
  if (usesExternalHub) setHubStatus('external');

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showWindow) showMainWindow();
    return;
  }

  const preload = path.join(__dirname, 'desktop-preload.js');
  const saved = savedWindowState();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    ...(saved.bounds || {}),
    minWidth: MAIN_WINDOW_MIN.width,
    minHeight: MAIN_WINDOW_MIN.height,
    title: 'Fabric Hub',
    icon: resolveAppIcon(),
    // Shown once the Hub UI has loaded, unless this is a login-item / --hidden start (tray still runs Hub).
    show: false,
    backgroundColor: '#f7f7f7',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: devtoolsEnabled(),
      // Linux spellcheck downloads Hunspell dictionaries from Google; macOS / Windows use the OS checker.
      spellcheck: process.platform !== 'linux' || parseBoolEnv(process.env.FABRIC_DESKTOP_SPELLCHECK) === true
    }
  });
  // maximize() also shows the window, so wait until it is shown (hidden login-item starts stay hidden).
  restoreMaximizedOnShow = saved.maximized;

  let persistTimer = null;
  const persistSoon = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistWindowState(win);
    }, 1000);
  };
  win.on('resize', persistSoon);
  win.on('move', persistSoon);

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[DESKTOP] did-fail-load', code, desc, url || '');
    if (process.env.FABRIC_DESKTOP_DEVTOOLS === '1' || String(process.env.FABRIC_DESKTOP_DEVTOOLS || '').toLowerCase() === 'true') {
      try {
        win.webContents.openDevTools({ mode: 'detach' });
      } catch (_) {}
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => guardNavigation(event, url));
  win.webContents.on('will-redirect', (event, url) => guardNavigation(event, url));

  await loadHubUiWithRetries(win);
  if (process.env.FABRIC_DESKTOP_DEVTOOLS === '1' || String(process.env.FABRIC_DESKTOP_DEVTOOLS || '').toLowerCase() === 'true') {
    try {
      win.webContents.openDevTools({ mode: 'detach' });
    } catch (_) {}
  }
  mainWindow = win;
  if (showWindow) showMainWindow();

  win.on('close', (event) => {
    persistWindowState(win);
    if (isQuitting) return;
    event.preventDefault();
    hideMainWindow();
  });

  win.on('closed', () => {
    mainWindow = null;
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
});

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

function configureSessionPermissions () {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const requestingUrl = (details && (details.requestingUrl || details.securityOrigin)) || '';
    const allowed = isPermissionAllowed(permission, requestingUrl, HUB_PORT);
    if (!allowed) console.warn('[DESKTOP] Denied permission', permission, 'for', String(requestingUrl).slice(0, 160));
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return isPermissionAllowed(permission, requestingOrigin, HUB_PORT);
  });
  ses.setDevicePermissionHandler(() => false);
}

app.whenReady().then(async () => {
  configureSessionPermissions();
  registerFabricProtocol();
  registerBitcoinProtocol();
  buildApplicationMenu();
  createTray();
  configureAutoLaunch();
  applyPreventSleep();
  const hidden = startHiddenRequested();
  try {
    await createWindow({ show: !hidden });
    if (hidden && process.platform === 'darwin' && app.dock) app.dock.hide();
  } catch (err) {
    console.error('[DESKTOP] Failed to start:', err && err.stack ? err.stack : err);
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Fabric Hub could not start',
      message: 'Fabric Hub could not start.',
      detail: `${err && err.message ? err.message : err}\n\nThe log may say why:\n${desktopLogPath}`,
      buttons: ['Quit', 'Show log'],
      defaultId: 0,
      cancelId: 0
    });
    if (response === 1) revealLogs();
    quitApp();
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
  // Keep Hub (Bitcoin / Fabric / Lightning) running in the tray.
});

let hubShutdownDone = false;
app.on('before-quit', (event) => {
  isQuitting = true;
  if (hubStatusPollTimer) {
    clearTimeout(hubStatusPollTimer);
    hubStatusPollTimer = null;
  }
  if (hubShutdownDone || usesExternalHub || !hubProcess) return;
  event.preventDefault();
  void stopHub().finally(() => {
    hubShutdownDone = true;
    desktopLog.close();
    app.quit();
  });
});

app.on('activate', () => {
  registerFabricProtocol();
  registerBitcoinProtocol();
  showMainWindow();
});
