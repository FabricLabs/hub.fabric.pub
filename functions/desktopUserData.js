'use strict';

/**
 * Stable Electron userData for Fabric Hub.
 *
 * Unpackaged `electron scripts/desktop.js` otherwise uses Chromium's **Electron**
 * profile (`~/Library/Application Support/Electron` on macOS). First-time setup
 * then lives there, so wiping the git checkout `stores/hub` does not reset it.
 */

const fs = require('fs');
const path = require('path');

const { PRODUCT_NAME } = require('./desktopOpenAtLogin');

const LEGACY_ELECTRON_PROFILE = 'Electron';
const MIGRATE_NAMES = ['stores', 'desktop-shell.json', 'logs'];

/**
 * @param {string} appDataDir
 * @returns {string}
 */
function defaultDesktopUserDataDir (appDataDir) {
  return path.join(String(appDataDir || ''), PRODUCT_NAME);
}

/**
 * @param {string} userDataDir
 * @returns {string}
 */
function hubStoreDir (userDataDir) {
  return path.join(String(userDataDir || ''), 'stores', 'hub');
}

/**
 * @param {string} userDataDir
 * @returns {string}
 */
function hubStatePath (userDataDir) {
  return path.join(hubStoreDir(userDataDir), 'STATE');
}

/**
 * @param {string} filePath
 * @param {object} [fsApi]
 * @returns {boolean}
 */
function pathExists (filePath, fsApi) {
  const io = fsApi || fs;
  try {
    return io.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

/**
 * @param {Object} opts
 * @param {string} opts.appDataDir
 * @param {Object} [opts.env]
 * @param {boolean} [opts.isPackaged]
 * @param {object} [opts.fs]
 * @returns {{
 *   userDataDir: string,
 *   source: string,
 *   migratedFrom: string|null,
 *   skipMigrate: boolean
 * }}
 */
function resolveDesktopUserDataPlan (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const env = o.env || {};
  const fsApi = o.fs || fs;
  const appData = String(o.appDataDir || '');
  const preferred = defaultDesktopUserDataDir(appData);
  const legacy = path.join(appData, LEGACY_ELECTRON_PROFILE);
  const envRaw = env.FABRIC_HUB_USER_DATA != null ? String(env.FABRIC_HUB_USER_DATA).trim() : '';
  if (envRaw) {
    return {
      userDataDir: envRaw,
      source: 'env',
      migratedFrom: null,
      skipMigrate: true
    };
  }

  const skipMigrate = env.FABRIC_DESKTOP_SKIP_ELECTRON_MIGRATE === '1' ||
    String(env.FABRIC_DESKTOP_SKIP_ELECTRON_MIGRATE || '').toLowerCase() === 'true';

  if (o.isPackaged) {
    return {
      userDataDir: preferred,
      source: 'packaged',
      migratedFrom: null,
      skipMigrate: true
    };
  }

  const destHasState = pathExists(hubStatePath(preferred), fsApi);
  const legacyHasState = pathExists(hubStatePath(legacy), fsApi);
  if (!skipMigrate && !destHasState && legacyHasState) {
    return {
      userDataDir: preferred,
      source: 'migrate_electron',
      migratedFrom: legacy,
      skipMigrate: false
    };
  }

  return {
    userDataDir: preferred,
    source: 'product',
    migratedFrom: null,
    skipMigrate: true
  };
}

/**
 * Copy Hub-owned files out of the unpackaged Electron profile.
 *
 * @param {string} fromRoot
 * @param {string} toRoot
 * @param {object} [fsApi]
 * @returns {{ copied: boolean, names: string[], reason?: string }}
 */
function migrateHubOwnedFiles (fromRoot, toRoot, fsApi) {
  const io = fsApi || fs;
  const dest = String(toRoot || '');
  const srcRoot = String(fromRoot || '');
  if (!srcRoot || !dest) {
    return { copied: false, names: [], reason: 'missing_path' };
  }
  if (pathExists(hubStatePath(dest), io)) {
    return { copied: false, names: [], reason: 'dest_exists' };
  }
  io.mkdirSync(dest, { recursive: true });
  const names = [];
  for (let i = 0; i < MIGRATE_NAMES.length; i++) {
    const name = MIGRATE_NAMES[i];
    const src = path.join(srcRoot, name);
    if (!pathExists(src, io)) continue;
    io.cpSync(src, path.join(dest, name), { recursive: true });
    names.push(name);
  }
  return { copied: names.length > 0, names };
}

/**
 * Pin app name + userData before `app.ready` / `requestSingleInstanceLock`.
 *
 * @param {object} app Electron `app`
 * @param {Object} [opts]
 * @param {Object} [opts.env]
 * @param {object} [opts.fs]
 * @returns {{
 *   userDataDir: string,
 *   hubStoreDir: string,
 *   source: string,
 *   migratedFrom: string|null,
 *   migrated?: { copied: boolean, names: string[], reason?: string }
 * }}
 */
function configureDesktopUserData (app, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const env = o.env || process.env;
  const fsApi = o.fs || fs;
  if (!app || typeof app.getPath !== 'function' || typeof app.setPath !== 'function') {
    throw new Error('configureDesktopUserData requires Electron app');
  }

  let appData = '';
  try {
    appData = app.getPath('appData');
  } catch (e) {
    throw e;
  }

  const plan = resolveDesktopUserDataPlan({
    appDataDir: appData,
    env: env,
    isPackaged: !!app.isPackaged,
    fs: fsApi
  });

  if (typeof app.setName === 'function') {
    try {
      app.setName(PRODUCT_NAME);
    } catch (_) {}
  }

  let migrated = null;
  if (plan.migratedFrom) {
    migrated = migrateHubOwnedFiles(plan.migratedFrom, plan.userDataDir, fsApi);
  }

  const current = app.getPath('userData');
  if (path.resolve(String(current || '')) !== path.resolve(plan.userDataDir)) {
    app.setPath('userData', plan.userDataDir);
  }

  const userDataDir = app.getPath('userData');
  return {
    userDataDir: userDataDir,
    hubStoreDir: hubStoreDir(userDataDir),
    source: plan.source,
    migratedFrom: plan.migratedFrom,
    migrated: migrated || undefined
  };
}

module.exports = {
  PRODUCT_NAME,
  LEGACY_ELECTRON_PROFILE,
  MIGRATE_NAMES,
  defaultDesktopUserDataDir,
  hubStoreDir,
  hubStatePath,
  resolveDesktopUserDataPlan,
  migrateHubOwnedFiles,
  configureDesktopUserData
};
