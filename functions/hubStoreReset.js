'use strict';

/**
 * Paths wiped to restart Hub first-time setup (CLI cwd, desktop userData, legacy Electron).
 * Does not remove `binaries/` or isolated test trees (`stores/hub-test*`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PRODUCT_NAME,
  LEGACY_ELECTRON_PROFILE,
  hubStoreDir
} = require('./desktopUserData');

const HUB_RELATIVE = path.join('stores', 'hub');
const CHAIN_RELATIVE = Object.freeze([
  path.join('stores', 'bitcoin-regtest'),
  path.join('stores', 'bitcoin-signet'),
  path.join('stores', 'bitcoin-testnet'),
  path.join('stores', 'bitcoin-mainnet'),
  path.join('stores', 'lightning')
]);
const LOGS_RELATIVE = 'logs';

/**
 * Chromium / Electron appData directory for this OS.
 * @param {string} [platform]
 * @param {string} [homedir]
 * @returns {string}
 */
function defaultAppDataDir (platform, homedir) {
  const plat = platform || process.platform;
  const home = homedir || os.homedir();
  if (plat === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (plat === 'win32') return path.join(home, 'AppData', 'Roaming');
  return path.join(home, '.config');
}

/**
 * Writable Hub roots that may hold `stores/hub` (desktop + env override).
 * @param {Object} [opts]
 * @param {string} [opts.homedir]
 * @param {string} [opts.platform]
 * @param {Object} [opts.env]
 * @returns {string[]}
 */
function desktopStoreRoots (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const env = o.env || process.env;
  const appData = defaultAppDataDir(o.platform, o.homedir);
  const roots = [];
  const seen = new Set();
  const push = (raw) => {
    const abs = path.resolve(String(raw || ''));
    if (!abs || abs === path.sep) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    roots.push(abs);
  };
  const envRaw = env.FABRIC_HUB_USER_DATA != null ? String(env.FABRIC_HUB_USER_DATA).trim() : '';
  if (envRaw) push(envRaw);
  push(path.join(appData, PRODUCT_NAME));
  push(path.join(appData, LEGACY_ELECTRON_PROFILE));
  return roots;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {boolean} [opts.setupOnly] When true, only `stores/hub` (leave Bitcoin/Lightning/logs).
 * @param {string} [opts.homedir]
 * @param {string} [opts.platform]
 * @param {Object} [opts.env]
 * @returns {Array<{ path: string, kind: string, root: string }>}
 */
function listHubStoreResetTargets (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const repoRoot = path.resolve(o.repoRoot || process.cwd());
  const setupOnly = !!o.setupOnly;
  const targets = [];
  const seen = new Set();
  const add = (abs, kind, root) => {
    const p = path.resolve(abs);
    if (seen.has(p)) return;
    seen.add(p);
    targets.push({ path: p, kind, root });
  };

  add(path.join(repoRoot, HUB_RELATIVE), 'cli-hub', repoRoot);
  if (!setupOnly) {
    CHAIN_RELATIVE.forEach((rel) => add(path.join(repoRoot, rel), 'cli-chain', repoRoot));
    add(path.join(repoRoot, LOGS_RELATIVE), 'cli-logs', repoRoot);
  }

  desktopStoreRoots(o).forEach((root) => {
    add(hubStoreDir(root), 'desktop-hub', root);
    if (!setupOnly) {
      CHAIN_RELATIVE.forEach((rel) => add(path.join(root, rel), 'desktop-chain', root));
      add(path.join(root, LOGS_RELATIVE), 'desktop-logs', root);
    }
  });

  return targets;
}

/**
 * Refuse to rm paths that are not under a listed reset root.
 * @param {string} absPath
 * @param {string[]} allowedRoots
 */
function assertSafeToRemove (absPath, allowedRoots) {
  const abs = path.resolve(absPath);
  if (!abs || abs === path.sep) {
    throw new Error('refusing to remove filesystem root');
  }
  const home = path.resolve(os.homedir());
  if (abs === home) {
    throw new Error('refusing to remove homedir');
  }
  const roots = Array.isArray(allowedRoots) ? allowedRoots : [];
  const ok = roots.some((root) => {
    const r = path.resolve(root);
    return abs === r || abs.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new Error('refusing to remove path outside reset roots: ' + abs);
  }
}

/**
 * @param {string} absPath
 * @param {object} [fsApi]
 * @returns {{ path: string, status: string, error?: string }}
 */
function removeResetTarget (absPath, fsApi) {
  const io = fsApi || fs;
  const p = path.resolve(absPath);
  try {
    if (!io.existsSync(p)) return { path: p, status: 'absent' };
    io.rmSync(p, { recursive: true, force: true });
    return { path: p, status: 'removed' };
  } catch (err) {
    return {
      path: p,
      status: 'error',
      error: err && err.message ? err.message : String(err)
    };
  }
}

/**
 * @param {Object} [opts]
 * @returns {{ targets: Array, results: Array, errors: number }}
 */
function resetHubStores (opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const dryRun = !!o.dryRun;
  const targets = listHubStoreResetTargets(o);
  const allowedRoots = Array.from(new Set(targets.map((t) => t.root)));
  const results = [];
  let errors = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    assertSafeToRemove(t.path, allowedRoots);
    if (dryRun) {
      const exists = (o.fs || fs).existsSync(t.path);
      results.push({
        path: t.path,
        kind: t.kind,
        status: exists ? 'would-remove' : 'absent'
      });
      continue;
    }
    const out = removeResetTarget(t.path, o.fs);
    results.push(Object.assign({ kind: t.kind }, out));
    if (out.status === 'error') errors += 1;
  }
  return { targets, results, errors };
}

module.exports = {
  CHAIN_RELATIVE,
  HUB_RELATIVE,
  PRODUCT_NAME,
  assertSafeToRemove,
  defaultAppDataDir,
  desktopStoreRoots,
  listHubStoreResetTargets,
  removeResetTarget,
  resetHubStores
};
