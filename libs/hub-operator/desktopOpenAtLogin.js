'use strict';

/**
 * Desktop login-item helpers for Fabric Hub (Bitcoin + Fabric + Lightning).
 * Electron applies these via `app.setLoginItemSettings`; Linux also writes
 * `~/.config/autostart/pub.fabric.hub.desktop`. Preference is stored in
 * userData `desktop-shell.json` (asar `settings/local.js` is read-only when packed).
 */

const path = require('path');

const DESKTOP_SHELL_FILE = 'desktop-shell.json';
const LINUX_AUTOSTART_ID = 'pub.fabric.hub.desktop';
const HIDDEN_FLAG = '--hidden';
const PRODUCT_NAME = 'Fabric Hub';

/**
 * @param {string|null|undefined} raw
 * @returns {boolean|null}
 */
function parseBoolEnv (raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return null;
}

/**
 * Env wins, then persisted tray choice, then settings/local.js, then packaged default on.
 *
 * @param {Object} opts
 * @param {Object} [opts.env]
 * @param {boolean} [opts.persisted]
 * @param {boolean} [opts.settingsOpenAtLogin]
 * @param {boolean} [opts.isPackaged]
 * @returns {boolean}
 */
function resolveOpenAtLogin (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const env = parseBoolEnv(o.env && o.env.FABRIC_OPEN_AT_LOGIN);
  if (env !== null) return env;
  if (typeof o.persisted === 'boolean') return o.persisted;
  if (typeof o.settingsOpenAtLogin === 'boolean') return o.settingsOpenAtLogin;
  return !!o.isPackaged;
}

/**
 * @param {Array<string>} [argv]
 * @returns {boolean}
 */
function argvRequestsHidden (argv) {
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i] || '');
    if (a === HIDDEN_FLAG || a === '--startup') return true;
  }
  return false;
}

/**
 * @param {Object} opts
 * @param {Array<string>} [opts.argv]
 * @param {boolean} [opts.wasOpenedAtLogin]
 * @param {boolean} [opts.wasOpenedAsHidden]
 * @returns {boolean}
 */
function shouldStartHidden (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (argvRequestsHidden(o.argv)) return true;
  if (o.wasOpenedAsHidden) return true;
  if (o.wasOpenedAtLogin) return true;
  return false;
}

/**
 * @param {string} userDataDir
 * @returns {string}
 */
function desktopShellStatePath (userDataDir) {
  return path.join(String(userDataDir || ''), DESKTOP_SHELL_FILE);
}

/**
 * @param {string} filePath
 * @param {Object} [fsApi]
 * @returns {Object}
 */
function readDesktopShellState (filePath, fsApi) {
  const fs = fsApi || require('fs');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (_err) {
    /* missing or invalid */
  }
  return {};
}

/**
 * @param {string} filePath
 * @param {Object} patch
 * @param {Object} [fsApi]
 * @returns {Object}
 */
function writeDesktopShellState (filePath, patch, fsApi) {
  const fs = fsApi || require('fs');
  const prev = readDesktopShellState(filePath, fs);
  const next = Object.assign({}, prev, patch && typeof patch === 'object' ? patch : {});
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

/**
 * @param {string} homeDir
 * @returns {string}
 */
function linuxAutostartPath (homeDir) {
  return path.join(String(homeDir || ''), '.config', 'autostart', LINUX_AUTOSTART_ID);
}

/**
 * @param {string} execPath
 * @param {Array<string>} [args]
 * @returns {string}
 */
function quoteDesktopExec (execPath, args) {
  const exe = String(execPath || '');
  const quoted = (exe.includes(' ') || exe.includes('\t')) ? `"${exe.replace(/"/g, '\\"')}"` : exe;
  const extra = Array.isArray(args) ? args.map((a) => String(a)) : [];
  return [quoted].concat(extra).join(' ').trim();
}

/**
 * @param {Object} opts
 * @param {string} opts.execPath
 * @param {string} [opts.iconPath]
 * @param {Array<string>} [opts.args]
 * @returns {string}
 */
function linuxAutostartDesktopFile (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const exec = quoteDesktopExec(o.execPath, o.args || [HIDDEN_FLAG]);
  const icon = o.iconPath ? String(o.iconPath) : '';
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${PRODUCT_NAME}`,
    'Comment=Start Bitcoin, Fabric, and Lightning with Fabric Hub',
    `Exec=${exec}`,
    'Terminal=false',
    'Categories=Utility;Network;',
    'X-GNOME-Autostart-enabled=true',
    'StartupNotify=false',
    'Hidden=false'
  ];
  if (icon) lines.splice(7, 0, `Icon=${icon}`);
  return lines.join('\n') + '\n';
}

/**
 * @param {Object} opts
 * @param {boolean} opts.enabled
 * @param {string} opts.homeDir
 * @param {string} opts.execPath
 * @param {string} [opts.iconPath]
 * @param {Object} [opts.fsApi]
 */
function syncLinuxAutostart (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const fs = o.fsApi || require('fs');
  const filePath = linuxAutostartPath(o.homeDir);
  if (!o.enabled) {
    try {
      fs.unlinkSync(filePath);
    } catch (_err) {
      /* already absent */
    }
    return { path: filePath, enabled: false };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, linuxAutostartDesktopFile({
    execPath: o.execPath,
    iconPath: o.iconPath,
    args: [HIDDEN_FLAG]
  }), 'utf8');
  return { path: filePath, enabled: true };
}

/**
 * Payload for Electron `app.setLoginItemSettings`.
 * Packaged macOS must omit `path` so the .app bundle is registered.
 *
 * @param {Object} opts
 * @param {boolean} opts.openAtLogin
 * @param {string} opts.platform
 * @param {string} opts.execPath
 * @returns {Object}
 */
function electronLoginItemSettings (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const enable = !!o.openAtLogin;
  const out = {
    openAtLogin: enable,
    openAsHidden: true,
    args: enable ? [HIDDEN_FLAG] : []
  };
  if (String(o.platform || '') !== 'darwin') {
    out.path = String(o.execPath || '');
  }
  return out;
}

/**
 * LaunchAgent for operators who prefer a plist over Login Items.
 *
 * @param {Object} opts
 * @param {string} opts.execPath
 * @param {string} [opts.label]
 * @returns {string}
 */
function macosLaunchAgentPlist (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const label = o.label || 'pub.fabric.hub';
  const exe = String(o.execPath || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${label}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${exe}</string>`,
    `    <string>${HIDDEN_FLAG}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <false/>',
    '</dict>',
    '</plist>',
    ''
  ].join('\n');
}

module.exports = {
  DESKTOP_SHELL_FILE,
  LINUX_AUTOSTART_ID,
  HIDDEN_FLAG,
  PRODUCT_NAME,
  parseBoolEnv,
  resolveOpenAtLogin,
  argvRequestsHidden,
  shouldStartHidden,
  desktopShellStatePath,
  readDesktopShellState,
  writeDesktopShellState,
  linuxAutostartPath,
  quoteDesktopExec,
  linuxAutostartDesktopFile,
  syncLinuxAutostart,
  electronLoginItemSettings,
  macosLaunchAgentPlist
};
