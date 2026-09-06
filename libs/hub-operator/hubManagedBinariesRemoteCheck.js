'use strict';

/**
 * @fileoverview Compare Hub-pinned Bitcoin Core / Core Lightning versions to
 * local installs and publisher “latest” listings. Does not bump pins or install
 * a newer remote release — missing local copies still download the Hub pin.
 */

const { execFileSync } = require('child_process');

const {
  BITCOIN_CORE_VERSION,
  CORE_LIGHTNING_VERSION,
  artifactsForPlatform,
  managedBinaryPlatformId,
  lightningSupportForPlatform
} = require('./hubManagedBinariesManifest');

const {
  bitcoindName,
  lightningdName,
  commandOnPath,
  hostMatchesPlatform,
  resolveBitcoindPath,
  resolveLightningdPath,
  getManagedBinariesStatus,
  installManagedBinaries,
  httpsGetText
} = require('./hubManagedBinaries');

const BITCOIN_CORE_BIN_INDEX_URL = 'https://bitcoincore.org/bin/';
const LIGHTNING_GITHUB_LATEST_URL =
  'https://api.github.com/repos/ElementsProject/lightning/releases/latest';

const CHECK_HOSTS = Object.freeze({
  'bitcoincore.org': true,
  'api.github.com': true
});

/**
 * @param {string} raw
 * @returns {number[]}
 */
function versionParts (raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^v/i, '');
  const core = s.split(/[^\d.]+/)[0] || '';
  if (!core) return [];
  return core.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions (a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa.length && !pb.length) return 0;
  if (!pa.length) return -1;
  if (!pb.length) return 1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function versionsMatch (a, b) {
  if (!a || !b) return false;
  return compareVersions(a, b) === 0;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function parseBitcoinCoreVersionsFromBinIndex (html) {
  const re = /bitcoin-core-(\d+\.\d+(?:\.\d+)?)\//gi;
  const seen = new Set();
  const versions = [];
  let m = re.exec(String(html || ''));
  while (m) {
    const v = m[1];
    if (!seen.has(v)) {
      seen.add(v);
      versions.push(v);
    }
    m = re.exec(String(html || ''));
  }
  versions.sort(compareVersions);
  return versions;
}

/**
 * @param {string[]} versions
 * @returns {string|null}
 */
function latestVersion (versions) {
  if (!Array.isArray(versions) || !versions.length) return null;
  return versions[versions.length - 1];
}

/**
 * @param {string} sumsText
 * @param {string} fileName
 * @returns {string|null}
 */
function sha256ForFileName (sumsText, fileName) {
  const want = String(fileName || '').trim();
  if (!want) return null;
  const lines = String(sumsText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([0-9a-f]{64})\s+\*?(\S+)\s*$/i);
    if (!m) continue;
    const listed = m[2].replace(/^.*\//, '');
    if (listed === want) return m[1].toLowerCase();
  }
  return null;
}

/**
 * @param {object|string} json
 * @returns {string|null}
 */
function parseGithubLatestTag (json) {
  let obj = json;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch (_) {
      return null;
    }
  }
  const tag = obj && (obj.tag_name || obj.name);
  const s = String(tag || '').trim().replace(/^v/i, '');
  return s || null;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function parseBitcoinCoreVersionFromOutput (text) {
  const s = String(text || '');
  const m = s.match(/Bitcoin Core version v?(\d+\.\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  const m2 = s.match(/\bv?(\d+\.\d+\.\d+)\b/);
  return m2 ? m2[1] : null;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function parseLightningVersionFromOutput (text) {
  const s = String(text || '').trim();
  const m = s.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function readProcessOutput (exe, args) {
  try {
    return execFileSync(exe, args, {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } catch (err) {
    if (err && err.stdout) return String(err.stdout);
    return '';
  }
}

/**
 * @param {string} [platformId]
 * @returns {string|null}
 */
function probeLocalBitcoinCoreVersion (platformId) {
  const bundled = resolveBitcoindPath(platformId);
  const exe = bundled
    || (hostMatchesPlatform(platformId) && commandOnPath(bitcoindName(platformId))
      ? bitcoindName(platformId)
      : null);
  if (!exe) return null;
  return parseBitcoinCoreVersionFromOutput(readProcessOutput(exe, ['-version']));
}

/**
 * @param {string} [platformId]
 * @returns {string|null}
 */
function probeLocalLightningVersion (platformId) {
  const bundled = resolveLightningdPath(platformId);
  const exe = bundled
    || (hostMatchesPlatform(platformId) && commandOnPath(lightningdName(platformId))
      ? lightningdName(platformId)
      : null);
  if (!exe) return null;
  return parseLightningVersionFromOutput(readProcessOutput(exe, ['--version']));
}

/**
 * @param {string} urlString
 * @returns {void}
 */
function assertCheckUrl (urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch (_) {
    throw new Error('Invalid check URL');
  }
  if (u.protocol !== 'https:') throw new Error('Refusing non-HTTPS check URL');
  if (!CHECK_HOSTS[u.hostname]) throw new Error(`Refusing host ${u.hostname}`);
}

function bitcoinSha256SumsUrl (version) {
  const v = String(version || '').trim();
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(v)) {
    throw new Error('Invalid Bitcoin Core version for SHA256SUMS');
  }
  return `https://bitcoincore.org/bin/bitcoin-core-${v}/SHA256SUMS`;
}

function componentReport (opts) {
  const pin = opts.pin;
  const local = opts.local || null;
  const remoteLatest = opts.remoteLatest || null;
  const installed = !!opts.installed;
  const matchesLocal = versionsMatch(local, pin);
  const remoteIsNewer = remoteLatest ? compareVersions(remoteLatest, pin) > 0 : false;
  let status = 'unknown';
  if (!installed) status = 'not_installed';
  else if (matchesLocal) status = 'matches_pin';
  else status = 'local_differs';
  return {
    pin: pin,
    local: local,
    remoteLatest: remoteLatest,
    installed: installed,
    matchesLocal: matchesLocal,
    remoteIsNewer: remoteIsNewer,
    status: status,
    remoteError: opts.remoteError || null
  };
}

/**
 * Fetch publisher latest + official SHA256SUMS for the Hub pin; compare to
 * local `bitcoind` / `lightningd`. Installs the pin only when local is missing.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.bitcoin]
 * @param {boolean} [opts.lightning]
 * @param {string} [opts.platformId]
 * @param {boolean} [opts.installIfMissing]
 * @param {function} [opts.onProgress]
 * @param {function} [opts.getText]
 * @returns {Promise<object>}
 */
async function checkManagedBinariesRemote (opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const getText = typeof opts.getText === 'function' ? opts.getText : httpsGetText;
  const platformId = String(opts.platformId || managedBinaryPlatformId());
  const wantBitcoin = opts.bitcoin !== false;
  const wantLightning = opts.lightning === true;
  const installIfMissing = opts.installIfMissing !== false;
  const artifacts = artifactsForPlatform(platformId);
  const lightning = lightningSupportForPlatform(platformId);
  const status = opts.status || getManagedBinariesStatus({ platformId });

  const fetchAllowed = async (url, meta) => {
    assertCheckUrl(url);
    const extra = meta && typeof meta === 'object' ? meta : {};
    return getText(url, {
      accept: extra.accept,
      onProgress: (p) => onProgress(Object.assign({ phase: 'remote' }, extra, p || {}))
    });
  };

  let bitcoinRemoteLatest = null;
  let bitcoinRemoteError = null;
  onProgress({
    phase: 'remote',
    component: 'bitcoin',
    message: 'Listing Bitcoin Core releases…',
    file: 'bitcoincore.org/bin/'
  });
  try {
    const html = await fetchAllowed(BITCOIN_CORE_BIN_INDEX_URL, {
      component: 'bitcoin',
      message: 'Listing Bitcoin Core releases…',
      file: 'bin/'
    });
    bitcoinRemoteLatest = latestVersion(parseBitcoinCoreVersionsFromBinIndex(html));
  } catch (err) {
    bitcoinRemoteError = err && err.message ? err.message : String(err);
  }

  let pinMatchesOfficial = null;
  let officialSha256 = null;
  let sumsError = null;
  if (artifacts && artifacts.bitcoin) {
    onProgress({
      phase: 'remote',
      component: 'bitcoin',
      message: `Downloading SHA256SUMS for Bitcoin Core ${BITCOIN_CORE_VERSION}…`,
      file: 'SHA256SUMS'
    });
    try {
      const sums = await fetchAllowed(bitcoinSha256SumsUrl(BITCOIN_CORE_VERSION), {
        component: 'bitcoin',
        message: 'Downloading SHA256SUMS…',
        file: 'SHA256SUMS'
      });
      officialSha256 = sha256ForFileName(sums, artifacts.bitcoin.file);
      pinMatchesOfficial = !!(
        officialSha256
        && officialSha256 === String(artifacts.bitcoin.sha256).toLowerCase()
      );
    } catch (err) {
      sumsError = err && err.message ? err.message : String(err);
    }
  }

  let lightningRemoteLatest = null;
  let lightningRemoteError = null;
  onProgress({
    phase: 'remote',
    component: 'lightning',
    message: 'Checking Core Lightning GitHub releases…',
    file: 'releases/latest'
  });
  try {
    const body = await fetchAllowed(LIGHTNING_GITHUB_LATEST_URL, {
      component: 'lightning',
      message: 'Checking Core Lightning GitHub releases…',
      file: 'releases/latest',
      accept: 'application/vnd.github+json'
    });
    lightningRemoteLatest = parseGithubLatestTag(body);
  } catch (err) {
    lightningRemoteError = err && err.message ? err.message : String(err);
  }

  const bitcoinLocal = probeLocalBitcoinCoreVersion(platformId);
  const lightningLocal = probeLocalLightningVersion(platformId);

  const bitcoin = Object.assign(
    componentReport({
      pin: BITCOIN_CORE_VERSION,
      local: bitcoinLocal,
      remoteLatest: bitcoinRemoteLatest,
      installed: !!(status.bitcoin && status.bitcoin.installed),
      remoteError: bitcoinRemoteError
    }),
    {
      artifact: artifacts && artifacts.bitcoin ? artifacts.bitcoin.file : null,
      pinSha256: artifacts && artifacts.bitcoin ? artifacts.bitcoin.sha256 : null,
      officialSha256: officialSha256,
      pinMatchesOfficial: pinMatchesOfficial,
      sumsError: sumsError
    }
  );

  const lightningReport = componentReport({
    pin: CORE_LIGHTNING_VERSION,
    local: lightningLocal,
    remoteLatest: lightningRemoteLatest,
    installed: !!(status.lightning && status.lightning.installed),
    remoteError: lightningRemoteError
  });
  lightningReport.supported = lightning.supported;
  lightningReport.source = lightning.source;
  lightningReport.reason = lightning.reason || null;
  lightningReport.artifact = artifacts && artifacts.lightning ? artifacts.lightning.file : null;

  const report = {
    checkedAt: new Date().toISOString(),
    platform: platformId,
    bitcoin: bitcoin,
    lightning: lightningReport,
    install: null
  };

  const needBitcoin = installIfMissing && wantBitcoin && !(status.bitcoin && status.bitcoin.installed);
  const needLightning = installIfMissing
    && wantLightning
    && lightning.supported
    && !(status.lightning && status.lightning.installed);

  if (needBitcoin || needLightning) {
    onProgress({
      phase: 'download',
      message: 'Downloading Hub-pinned binaries…'
    });
    report.install = await (typeof opts.installManagedBinaries === 'function'
      ? opts.installManagedBinaries
      : installManagedBinaries)({
      platformId: platformId,
      bitcoin: needBitcoin,
      lightning: needLightning,
      onProgress: onProgress
    });
    const after = getManagedBinariesStatus({ platformId });
    report.bitcoin.installed = !!(after.bitcoin && after.bitcoin.installed);
    report.lightning.installed = !!(after.lightning && after.lightning.installed);
    report.bitcoin.local = probeLocalBitcoinCoreVersion(platformId);
    report.lightning.local = probeLocalLightningVersion(platformId);
    report.bitcoin.matchesLocal = versionsMatch(report.bitcoin.local, report.bitcoin.pin);
    report.lightning.matchesLocal = versionsMatch(report.lightning.local, report.lightning.pin);
    report.bitcoin.status = !report.bitcoin.installed
      ? 'not_installed'
      : (report.bitcoin.matchesLocal ? 'matches_pin' : 'local_differs');
    report.lightning.status = !report.lightning.installed
      ? 'not_installed'
      : (report.lightning.matchesLocal ? 'matches_pin' : 'local_differs');
  }

  report.status = getManagedBinariesStatus({ platformId });
  return report;
}

module.exports = {
  BITCOIN_CORE_BIN_INDEX_URL,
  LIGHTNING_GITHUB_LATEST_URL,
  versionParts,
  compareVersions,
  versionsMatch,
  parseBitcoinCoreVersionsFromBinIndex,
  latestVersion,
  sha256ForFileName,
  parseGithubLatestTag,
  parseBitcoinCoreVersionFromOutput,
  parseLightningVersionFromOutput,
  probeLocalBitcoinCoreVersion,
  probeLocalLightningVersion,
  bitcoinSha256SumsUrl,
  checkManagedBinariesRemote
};
