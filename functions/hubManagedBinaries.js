'use strict';

/**
 * @fileoverview Resolve, download, and PATH-wire Bitcoin Core / Core Lightning
 * binaries under `binaries/<platform>-<arch>/` (or Electron userData).
 */

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const {
  BITCOIN_CORE_VERSION,
  CORE_LIGHTNING_VERSION,
  DOWNLOAD_USER_AGENT,
  INSTALLER_PLATFORM_IDS,
  managedBinaryPlatformId,
  artifactsForPlatform,
  lightningSupportForPlatform
} = require('./hubManagedBinariesManifest');

const LIGHTNING_BIN_RELATIVE = Object.freeze([
  path.join('lightning', 'usr', 'local', 'bin'),
  path.join('lightning', 'usr', 'bin'),
  'bin'
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function commandOnPath (name) {
  const bin = process.platform === 'win32' && !String(name).endsWith('.exe')
    ? `${name}.exe`
    : String(name);
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, [bin], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} [platformId]
 * @returns {string}
 */
function platformFamily (platformId) {
  const id = String(platformId || managedBinaryPlatformId());
  if (id.indexOf('win32') === 0) return 'win32';
  if (id.indexOf('darwin') === 0) return 'darwin';
  if (id.indexOf('linux') === 0) return 'linux';
  return process.platform;
}

function hostMatchesPlatform (platformId) {
  return String(platformId || managedBinaryPlatformId()) === managedBinaryPlatformId();
}

function bitcoindName (platformId) {
  return platformFamily(platformId) === 'win32' ? 'bitcoind.exe' : 'bitcoind';
}

function lightningdName (platformId) {
  return platformFamily(platformId) === 'win32' ? 'lightningd.exe' : 'lightningd';
}

function bitcoinCliName (platformId) {
  return platformFamily(platformId) === 'win32' ? 'bitcoin-cli.exe' : 'bitcoin-cli';
}

/**
 * @returns {string}
 */
function hubStoreRoot () {
  return process.env.FABRIC_HUB_USER_DATA || process.cwd();
}

/**
 * @returns {string}
 */
function hubAppRoot () {
  return process.env.FABRIC_HUB_APP_ROOT || process.cwd();
}

/**
 * Writable install target for downloads (desktop: userData; CLI: repo `binaries/`).
 * @param {string} [platformId]
 * @returns {string}
 */
function writablePlatformDir (platformId) {
  const id = String(platformId || managedBinaryPlatformId());
  return path.join(hubStoreRoot(), 'binaries', id);
}

/**
 * @param {string} [platformId]
 * @returns {string[]}
 */
function candidatePlatformDirs (platformId) {
  const id = String(platformId || managedBinaryPlatformId());
  const dirs = [];
  dirs.push(writablePlatformDir(id));
  const envRaw = process.env.FABRIC_HUB_BINARIES;
  if (envRaw && String(envRaw).trim()) {
    const envPath = path.resolve(String(envRaw).trim());
    dirs.push(path.basename(envPath) === id ? envPath : path.join(envPath, id));
  }
  dirs.push(path.join(hubAppRoot(), 'binaries', id));
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    dirs.push(path.join(process.resourcesPath, 'binaries', id));
  }
  const seen = new Set();
  return dirs.filter((d) => {
    const n = path.normalize(d);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/**
 * @param {string} dir
 * @param {string} exe
 * @returns {string|null}
 */
function exeIfPresent (dir, exe) {
  if (!dir) return null;
  const full = path.join(dir, exe);
  try {
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  } catch (_) {}
  return null;
}

/**
 * @param {string} platformDir
 * @returns {string[]}
 */
function binDirsUnderPlatform (platformDir) {
  const out = [path.join(platformDir, 'bin')];
  for (const rel of LIGHTNING_BIN_RELATIVE) {
    out.push(path.join(platformDir, rel));
  }
  return out;
}

/**
 * @param {string} [platformId]
 * @returns {string|null}
 */
function resolveBitcoindPath (platformId) {
  const exe = bitcoindName(platformId);
  for (const root of candidatePlatformDirs(platformId)) {
    const hit = exeIfPresent(path.join(root, 'bin'), exe);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {string} [platformId]
 * @returns {string|null}
 */
function resolveLightningdPath (platformId) {
  const exe = lightningdName(platformId);
  for (const root of candidatePlatformDirs(platformId)) {
    for (const binDir of binDirsUnderPlatform(root)) {
      const hit = exeIfPresent(binDir, exe);
      if (hit) return hit;
    }
  }
  return null;
}

function bitcoindAvailable (platformId) {
  return !!(
    resolveBitcoindPath(platformId)
    || (hostMatchesPlatform(platformId) && commandOnPath(bitcoindName(platformId)))
  );
}

function lightningdAvailable (platformId) {
  return !!(
    resolveLightningdPath(platformId)
    || (hostMatchesPlatform(platformId) && commandOnPath(lightningdName(platformId)))
  );
}

/**
 * Prepend managed `bin` directories so `@fabric/core` `spawn('bitcoind')` / `lightningd` resolve.
 * @param {string} [platformId]
 * @returns {string[]} directories prepended
 */
function applyManagedNodeBinariesToProcessEnv (platformId) {
  const prepend = [];
  for (const root of candidatePlatformDirs(platformId)) {
    for (const binDir of binDirsUnderPlatform(root)) {
      try {
        if (fs.existsSync(binDir) && fs.statSync(binDir).isDirectory()) prepend.push(binDir);
      } catch (_) {}
    }
  }
  if (!prepend.length) return [];
  const parts = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const next = [];
  const seen = new Set();
  for (const d of prepend.concat(parts)) {
    const n = path.normalize(d);
    if (seen.has(n)) continue;
    seen.add(n);
    next.push(d);
  }
  process.env.PATH = next.join(path.delimiter);
  return prepend;
}

/**
 * @param {object} [opts]
 * @returns {object}
 */
function getManagedBinariesStatus (opts = {}) {
  const platformId = String(opts.platformId || managedBinaryPlatformId());
  const artifacts = artifactsForPlatform(platformId);
  const lightning = lightningSupportForPlatform(platformId);
  const bitcoind = resolveBitcoindPath(platformId);
  const lightningd = resolveLightningdPath(platformId);
  return {
    platform: platformId,
    os: process.platform,
    arch: process.arch,
    bitcoin: {
      version: BITCOIN_CORE_VERSION,
      installed: !!(bitcoind || (hostMatchesPlatform(platformId) && commandOnPath(bitcoindName(platformId)))),
      bundled: !!bitcoind,
      artifact: artifacts && artifacts.bitcoin ? artifacts.bitcoin.file : null
    },
    lightning: {
      version: CORE_LIGHTNING_VERSION,
      supported: lightning.supported,
      source: lightning.source,
      reason: lightning.reason || null,
      installed: !!(lightningd || (hostMatchesPlatform(platformId) && commandOnPath(lightningdName(platformId)))),
      bundled: !!lightningd,
      artifact: artifacts && artifacts.lightning ? artifacts.lightning.file : null
    },
    writableDir: writablePlatformDir(platformId)
  };
}

function sha256File (filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function downloadHttpsFile (urlString, destPath, expectedSha256, onProgress) {
  return new Promise((resolve, reject) => {
    const tmpPath = `${destPath}.partial`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const finishOk = async () => {
      try {
        const digest = await sha256File(tmpPath);
        if (String(expectedSha256).toLowerCase() !== digest.toLowerCase()) {
          try { fs.unlinkSync(tmpPath); } catch (_) {}
          reject(new Error(`SHA-256 mismatch for ${path.basename(destPath)}`));
          return;
        }
        fs.renameSync(tmpPath, destPath);
        resolve(destPath);
      } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      }
    };

    const get = (urlStr, redirectsLeft) => {
      let u;
      try {
        u = new URL(urlStr);
      } catch (err) {
        reject(err);
        return;
      }
      if (u.protocol !== 'https:') {
        reject(new Error('Refusing non-HTTPS binary download'));
        return;
      }
      const req = https.get({
        hostname: u.hostname,
        servername: u.hostname,
        path: `${u.pathname}${u.search}`,
        port: u.port || 443,
        headers: {
          'User-Agent': DOWNLOAD_USER_AGENT,
          Accept: '*/*'
        }
      }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, u);
          } catch (err) {
            reject(err);
            return;
          }
          if (next.protocol !== 'https:') {
            reject(new Error('Refusing non-HTTPS redirect'));
            return;
          }
          get(next.toString(), redirectsLeft - 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`Download failed: HTTP ${code} for ${u.hostname}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        const out = fs.createWriteStream(tmpPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (typeof onProgress === 'function') {
            onProgress({ received, total, file: path.basename(destPath) });
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close((err) => {
            if (err) reject(err);
            else finishOk();
          });
        });
        out.on('error', reject);
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(10 * 60 * 1000, () => {
        req.destroy(new Error('Download timed out'));
      });
    };

    get(urlString, 5);
  });
}

const HTTPS_GET_TEXT_MAX_BYTES = 512 * 1024;

/**
 * HTTPS GET of a small text body (release indexes, SHA256SUMS, GitHub JSON).
 *
 * @param {string} urlString
 * @param {Object} [opts]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.accept]
 * @param {function} [opts.onProgress]
 * @returns {Promise<string>}
 */
function httpsGetText (urlString, opts = {}) {
  const maxBytes = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : HTTPS_GET_TEXT_MAX_BYTES;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 30000;
  const accept = opts.accept || 'text/plain, text/html, application/json;q=0.9, */*;q=0.1';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  return new Promise((resolve, reject) => {
    const get = (urlStr, redirectsLeft) => {
      let u;
      try {
        u = new URL(urlStr);
      } catch (err) {
        reject(err);
        return;
      }
      if (u.protocol !== 'https:') {
        reject(new Error('Refusing non-HTTPS request'));
        return;
      }
      const req = https.get({
        hostname: u.hostname,
        servername: u.hostname,
        path: `${u.pathname}${u.search}`,
        port: u.port || 443,
        headers: {
          'User-Agent': DOWNLOAD_USER_AGENT,
          Accept: accept
        }
      }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, u);
          } catch (err) {
            reject(err);
            return;
          }
          if (next.protocol !== 'https:') {
            reject(new Error('Refusing non-HTTPS redirect'));
            return;
          }
          get(next.toString(), redirectsLeft - 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`HTTP ${code} for ${u.hostname}${u.pathname}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
          if (onProgress) {
            onProgress({ received, total, file: path.basename(u.pathname) || u.hostname });
          }
        });
        res.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Request timed out'));
      });
    };

    get(urlString, 5);
  });
}

function extractArchive (archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const tarBin = process.platform === 'win32' ? 'tar.exe' : 'tar';
  execFileSync(tarBin, ['-xf', archivePath, '-C', destDir], {
    stdio: 'ignore',
    timeout: 180000,
    windowsHide: true
  });
}

function chmodIfUnix (filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (_) {}
}

function copyDirFiles (srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    const to = path.join(destDir, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) continue;
    fs.copyFileSync(from, to);
    chmodIfUnix(to);
  }
}

function installBitcoinFromExtract (extractDir, platformDir) {
  const names = fs.readdirSync(extractDir);
  let root = extractDir;
  const nested = names.map((n) => path.join(extractDir, n)).find((p) => {
    try {
      return fs.statSync(p).isDirectory() && /^bitcoin-/i.test(path.basename(p));
    } catch (_) {
      return false;
    }
  });
  if (nested) root = nested;
  const srcBin = path.join(root, 'bin');
  if (!fs.existsSync(srcBin)) {
    throw new Error('Bitcoin archive did not contain a bin/ directory');
  }
  copyDirFiles(srcBin, path.join(platformDir, 'bin'));
}

function installLightningFromExtract (extractDir, platformDir) {
  const dest = path.join(platformDir, 'lightning');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(extractDir, dest, { recursive: true });
  for (const rel of LIGHTNING_BIN_RELATIVE) {
    const binDir = path.join(platformDir, rel);
    if (!fs.existsSync(binDir)) continue;
    for (const name of fs.readdirSync(binDir)) {
      chmodIfUnix(path.join(binDir, name));
    }
  }
  if (!resolveLightningdPathFromDir(platformDir)) {
    throw new Error('Core Lightning archive did not contain lightningd');
  }
}

function resolveLightningdPathFromDir (platformDir, platformId) {
  const exe = lightningdName(platformId);
  for (const binDir of binDirsUnderPlatform(platformDir)) {
    const hit = exeIfPresent(binDir, exe);
    if (hit) return hit;
  }
  return null;
}

async function installLightningViaHomebrew (onProgress) {
  if (process.platform !== 'darwin') {
    throw new Error('Homebrew Lightning install is macOS-only');
  }
  if (!commandOnPath('brew')) {
    throw new Error('Homebrew is not installed. Install brew, then retry, or uncheck managed Lightning.');
  }
  if (typeof onProgress === 'function') {
    onProgress({ phase: 'homebrew', message: 'Installing Core Lightning with Homebrew…' });
  }
  await execFileAsync('brew', ['install', 'core-lightning'], {
    timeout: 20 * 60 * 1000,
    env: process.env
  });
  applyManagedNodeBinariesToProcessEnv();
  if (!commandOnPath(lightningdName())) {
    throw new Error('brew install core-lightning finished but lightningd is still not on PATH');
  }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.bitcoin]
 * @param {boolean} [opts.lightning]
 * @param {string} [opts.platformId]
 * @param {boolean} [opts.allowHomebrew]
 * @param {function} [opts.onProgress]
 * @returns {Promise<object>}
 */
async function installManagedBinaries (opts = {}) {
  const platformId = String(opts.platformId || managedBinaryPlatformId());
  const wantBitcoin = opts.bitcoin !== false;
  const wantLightning = opts.lightning === true;
  const allowHomebrew = opts.allowHomebrew !== false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const artifacts = artifactsForPlatform(platformId);
  if (!artifacts || !artifacts.bitcoin) {
    throw new Error(`No pinned Bitcoin Core artifact for ${platformId}`);
  }

  const platformDir = writablePlatformDir(platformId);
  fs.mkdirSync(platformDir, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-node-binaries-'));
  const result = {
    platform: platformId,
    bitcoin: { skipped: !wantBitcoin },
    lightning: { skipped: !wantLightning }
  };

  try {
    if (wantBitcoin) {
      const already = resolveBitcoindPath(platformId);
      if (already) {
        result.bitcoin = { ok: true, skipped: true, path: already };
      } else {
        onProgress({ phase: 'download', component: 'bitcoin', file: artifacts.bitcoin.file });
        const archivePath = path.join(tmpRoot, artifacts.bitcoin.file);
        await downloadHttpsFile(
          artifacts.bitcoin.url,
          archivePath,
          artifacts.bitcoin.sha256,
          (p) => onProgress(Object.assign({ phase: 'download', component: 'bitcoin' }, p))
        );
        onProgress({ phase: 'extract', component: 'bitcoin' });
        const extractDir = path.join(tmpRoot, 'bitcoin-extract');
        extractArchive(archivePath, extractDir);
        installBitcoinFromExtract(extractDir, platformDir);
        const installed = resolveBitcoindPath(platformId);
        if (!installed) throw new Error('bitcoind missing after extract');
        result.bitcoin = { ok: true, path: installed, version: BITCOIN_CORE_VERSION };
      }
    }

    if (wantLightning) {
      const support = lightningSupportForPlatform(platformId);
      if (!support.supported) {
        result.lightning = { ok: false, skipped: true, reason: support.reason };
      } else if (
        resolveLightningdPath(platformId)
        || (hostMatchesPlatform(platformId) && commandOnPath(lightningdName(platformId)))
      ) {
        result.lightning = {
          ok: true,
          skipped: true,
          path: resolveLightningdPath(platformId) || lightningdName(platformId)
        };
      } else if (artifacts.lightning) {
        onProgress({ phase: 'download', component: 'lightning', file: artifacts.lightning.file });
        const archivePath = path.join(tmpRoot, artifacts.lightning.file);
        await downloadHttpsFile(
          artifacts.lightning.url,
          archivePath,
          artifacts.lightning.sha256,
          (p) => onProgress(Object.assign({ phase: 'download', component: 'lightning' }, p))
        );
        onProgress({ phase: 'extract', component: 'lightning' });
        const extractDir = path.join(tmpRoot, 'lightning-extract');
        extractArchive(archivePath, extractDir);
        installLightningFromExtract(extractDir, platformDir);
        result.lightning = {
          ok: true,
          path: resolveLightningdPath(platformId),
          version: CORE_LIGHTNING_VERSION
        };
      } else if (allowHomebrew && support.source === 'homebrew') {
        await installLightningViaHomebrew(onProgress);
        result.lightning = { ok: true, source: 'homebrew', version: CORE_LIGHTNING_VERSION };
      } else {
        result.lightning = { ok: false, reason: support.reason || 'No Lightning artifact for this platform.' };
      }
    }
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  }

  applyManagedNodeBinariesToProcessEnv(platformId);
  result.status = getManagedBinariesStatus({ platformId });
  return result;
}

module.exports = {
  INSTALLER_PLATFORM_IDS,
  managedBinaryPlatformId,
  artifactsForPlatform,
  lightningSupportForPlatform,
  commandOnPath,
  bitcoindName,
  lightningdName,
  hostMatchesPlatform,
  bitcoindAvailable,
  lightningdAvailable,
  writablePlatformDir,
  candidatePlatformDirs,
  resolveBitcoindPath,
  resolveLightningdPath,
  applyManagedNodeBinariesToProcessEnv,
  getManagedBinariesStatus,
  downloadHttpsFile,
  httpsGetText,
  extractArchive,
  installBitcoinFromExtract,
  installLightningFromExtract,
  installManagedBinaries,
  sha256File
};
