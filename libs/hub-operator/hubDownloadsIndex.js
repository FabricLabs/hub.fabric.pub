'use strict';

/**
 * Build-time listing for Hub `/downloads`.
 * Copies electron-builder artifacts from `dist/` into `assets/downloads/` and writes `index.json`.
 */

const fs = require('fs');
const path = require('path');
const {
  INDEX_META_NAMES,
  normalizeRelativePath
} = require('../../functions/hubDownloadsTree');

const KEEP_DEST_NAMES = new Set(['README.md', '.gitkeep']);

const SKIP_COPY_NAMES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yaml'
]);

function repoRoot () {
  return path.join(__dirname, '..', '..');
}

function defaultPaths () {
  const root = repoRoot();
  return {
    distDir: path.join(root, 'dist'),
    destDir: path.join(root, 'assets', 'downloads')
  };
}

function isSkipCopyName (name) {
  const n = String(name || '');
  if (SKIP_COPY_NAMES.has(n)) return true;
  if (n.endsWith('.blockmap')) return true;
  if (/^latest-.*\.(yml|yaml)$/i.test(n)) return true;
  return false;
}

function isInstallerFile (name) {
  return /\.(dmg|pkg|exe|msi|appimage|deb|rpm|snap|zip)$/i.test(String(name || ''));
}

/**
 * @param {string} name
 * @returns {string}
 */
function classifyPlatformFolder (name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.dmg') || n.endsWith('.pkg')) return 'mac';
  if (n.endsWith('.zip') && /(mac|darwin|osx)/.test(n)) return 'mac';
  if (n.endsWith('.exe') || n.endsWith('.msi')) return 'win';
  if (n.endsWith('.deb') || n.endsWith('.appimage') || n.endsWith('.rpm') || n.endsWith('.snap')) {
    return 'linux';
  }
  return 'other';
}

function shouldSkipDistDir (name) {
  const n = String(name || '');
  if (n.endsWith('.app')) return true;
  if (/-unpacked$/i.test(n)) return true;
  return false;
}

/**
 * @param {string} dir
 * @param {Array<{ abs: string, name: string }>} acc
 */
function collectInstallerFiles (dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    const name = ent.name;
    if (!name || name === '.' || name === '..') continue;
    const abs = path.join(dir, name);
    if (ent.isDirectory()) {
      if (shouldSkipDistDir(name)) continue;
      collectInstallerFiles(abs, acc);
      continue;
    }
    if (!ent.isFile()) continue;
    if (isSkipCopyName(name)) continue;
    if (!isInstallerFile(name)) continue;
    acc.push({ abs, name });
  }
  return acc;
}

function emptyDownloadsDest (destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    if (KEEP_DEST_NAMES.has(ent.name)) continue;
    fs.rmSync(path.join(destDir, ent.name), { recursive: true, force: true });
  }
}

function destRelativeForInstaller (basename) {
  const folder = classifyPlatformFolder(basename);
  const safe = path.basename(String(basename || ''));
  return `${folder}/${safe}`;
}

/**
 * Walk `destDir` into the FileBrowser `files[]` list.
 * @param {string} destDir
 * @param {string} [relBase]
 * @returns {Array<{ path: string, size: number, mtime: string }>}
 */
function walkDownloadFiles (destDir, relBase) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch (_) {
    return files;
  }
  const base = relBase ? String(relBase) : '';
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    const name = ent.name;
    if (!name || name === '.' || name === '..') continue;
    if (INDEX_META_NAMES.has(name)) continue;
    const rel = base ? `${base}/${name}` : name;
    const abs = path.join(destDir, name);
    if (ent.isDirectory()) {
      files.push.apply(files, walkDownloadFiles(abs, rel));
      continue;
    }
    if (!ent.isFile()) continue;
    const st = fs.statSync(abs);
    const p = normalizeRelativePath(rel.replace(/\\/g, '/'), { allowEmpty: false });
    if (!p) continue;
    files.push({
      path: p,
      size: st.size,
      mtime: st.mtime.toISOString()
    });
  }
  return files;
}

function writeDownloadsIndexFile (destDir, files) {
  fs.mkdirSync(destDir, { recursive: true });
  const index = {
    generatedAt: new Date().toISOString(),
    files: Array.isArray(files) ? files : []
  };
  const dest = path.join(destDir, 'index.json');
  fs.writeFileSync(dest, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.distDir]
 * @param {string} [opts.destDir]
 * @param {boolean} [opts.copyDist] Copy installer artifacts from `dist/` (after electron-builder).
 * @returns {{ destDir: string, copied: number, fileCount: number, copiedDist: boolean }}
 */
function syncDownloadsAssets (opts) {
  const defaults = defaultPaths();
  const distDir = opts && opts.distDir ? String(opts.distDir) : defaults.distDir;
  const destDir = opts && opts.destDir ? String(opts.destDir) : defaults.destDir;
  const copyDist = !!(opts && opts.copyDist);
  fs.mkdirSync(destDir, { recursive: true });

  let copied = 0;
  if (copyDist) {
    emptyDownloadsDest(destDir);
    const found = collectInstallerFiles(distDir, []);
    for (let i = 0; i < found.length; i++) {
      const item = found[i];
      const rel = destRelativeForInstaller(item.name);
      const target = path.join(destDir, rel.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(item.abs, target);
      copied += 1;
    }
  }

  const files = walkDownloadFiles(destDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  writeDownloadsIndexFile(destDir, files);
  return {
    destDir,
    copied,
    fileCount: files.length,
    copiedDist: copyDist
  };
}

module.exports = {
  KEEP_DEST_NAMES,
  classifyPlatformFolder,
  collectInstallerFiles,
  destRelativeForInstaller,
  isInstallerFile,
  syncDownloadsAssets,
  walkDownloadFiles,
  writeDownloadsIndexFile
};
